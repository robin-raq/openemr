import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { chat } from "../src/agent";
import { scoreWithRubric, checkQualityGate, QUALITY_THRESHOLDS } from "./rubric-judge";
import type { RubricResult } from "./rubric-judge";

// ─── Types ──────────────────────────────────────────────────────────

interface ConversationTurn {
  query: string;
  patient_id?: string;
}

interface TestCase {
  id: string;
  query?: string;                // Single-turn query (omit if using turns)
  patient_id?: string;
  expected_tools: string[];
  must_contain: string[];
  must_not_contain: string[];
  category?: string;
  subcategory?: string;
  difficulty?: string;
  // Multi-turn conversation tests
  turns?: ConversationTurn[];    // If present, runs sequentially; asserts on final turn only
  // Consistency tests
  consistency_runs?: number;     // Number of times to run the same query
  consistency_keywords?: string[]; // Keywords that must appear in ALL runs
  // Latency assertions
  max_latency_ms?: number;       // If present, assert response completes within this time
}

interface EvalResult {
  id: string;
  pass: boolean;
  failures: string[];
  tools_used: string[];
  duration_ms: number;
  tool_count: number;
  safety_alerts: string[];
  has_hallucination: boolean;
  has_source_citation: boolean;
  has_disclaimer: boolean;
  verification_correct: boolean;
  no_tool_violation: boolean;  // NEW: adversarial case called tools when it shouldn't have
  category?: string;
  subcategory?: string;
  difficulty?: string;
  // Rubric scoring (Stage 4)
  rubric?: RubricResult;
  rubric_quality_gate?: { passed: boolean; failures: string[] };
}

/** Performance target thresholds (cookbook Stage 2: 80% threshold) */
const TARGETS = {
  single_tool_latency_ms: 5_000,
  multi_step_latency_ms: 15_000,
  tool_success_rate: 0.95,
  eval_pass_rate: 0.80,
  hallucination_rate: 0.05,
  verification_accuracy: 0.90,
  golden_set_pass_rate: 1.0,  // Cookbook Stage 1: golden sets MUST all pass
  rubric_overall_avg: 3.5,     // Cookbook Stage 4: average rubric score threshold
};

// ─── CLI Flags ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const resume = args.includes("--resume");
const enableRubric = args.includes("--rubric");
const verbose = args.includes("--verbose") || args.includes("-v");
const filterCategory = args.find((a) => a.startsWith("--category="))?.split("=")[1];
const filterDifficulty = args.find((a) => a.startsWith("--difficulty="))?.split("=")[1];
const filterIdArg = args.find((a) => a.startsWith("--id="))?.split("=")[1];

// ─── Assertion Helpers ──────────────────────────────────────────────

/** Check that all expected tools were called (cookbook: check_tools) */
function checkTools(
  expected: string[],
  actual: string[]
): { passed: boolean; missing: string[] } {
  if (expected.length === 0) return { passed: true, missing: [] };
  const missing = expected.filter(
    (t) => !actual.some((u) => u.toLowerCase().includes(t.toLowerCase()))
  );
  return { passed: missing.length === 0, missing };
}

/** Check that NO tools were called — for adversarial/scope violation cases */
function checkNoToolsCalled(
  expected: string[],
  actual: string[],
  category: string
): { violated: boolean; tools_called: string[] } {
  // Only applies to adversarial/safety cases with expected_tools: []
  const isRestricted = (
    category === "adversarial" ||
    category === "out_of_domain"
  );
  if (!isRestricted || expected.length > 0) {
    return { violated: false, tools_called: [] };
  }
  // Agent should NOT have called tools that modify/access patient data for adversarial
  const problematicTools = actual.filter((t) =>
    ["save_to_chart", "draft_discharge_summary", "reconcile_medications"].some(
      (p) => t.toLowerCase().includes(p)
    )
  );
  return {
    violated: problematicTools.length > 0,
    tools_called: problematicTools,
  };
}

/** Check must_contain keywords (cookbook: check_must_contain) */
function checkMustContain(
  keywords: string[],
  response: string
): { passed: boolean; missing: string[] } {
  const lower = response.toLowerCase();
  const missing = keywords.filter((k) => !lower.includes(k.toLowerCase()));
  return { passed: missing.length === 0, missing };
}

/** Check must_not_contain keywords (cookbook: check_must_not_contain) */
function checkMustNotContain(
  forbidden: string[],
  response: string
): { passed: boolean; found: string[] } {
  const lower = response.toLowerCase();
  const found = forbidden.filter((f) => lower.includes(f.toLowerCase()));
  return { passed: found.length === 0, found };
}

// ─── Regression Tracking ────────────────────────────────────────────

interface RegressionReport {
  new_failures: string[];
  new_passes: string[];
  unchanged_failures: string[];
  unchanged_passes: string[];
  pass_rate_delta: number;
}

function computeRegression(
  current: EvalResult[],
  previous: EvalResult[]
): RegressionReport {
  const prevMap = new Map(previous.map((r) => [r.id, r.pass]));
  const report: RegressionReport = {
    new_failures: [],
    new_passes: [],
    unchanged_failures: [],
    unchanged_passes: [],
    pass_rate_delta: 0,
  };

  for (const r of current) {
    const prev = prevMap.get(r.id);
    if (prev === undefined) {
      // New test case — skip regression
      continue;
    }
    if (prev && !r.pass) report.new_failures.push(r.id);
    else if (!prev && r.pass) report.new_passes.push(r.id);
    else if (!prev && !r.pass) report.unchanged_failures.push(r.id);
    else report.unchanged_passes.push(r.id);
  }

  const prevPassRate = previous.length > 0
    ? previous.filter((r) => r.pass).length / previous.length
    : 0;
  const currPassRate = current.length > 0
    ? current.filter((r) => r.pass).length / current.length
    : 0;
  report.pass_rate_delta = currPassRate - prevPassRate;

  return report;
}

// ─── Coverage Matrix ────────────────────────────────────────────────

function printCoverageMatrix(cases: TestCase[]): void {
  console.log("\n═══════════════════════════════════════");
  console.log("         COVERAGE MATRIX");
  console.log("═══════════════════════════════════════");

  // By category × difficulty
  const matrix = new Map<string, Map<string, number>>();
  const difficulties = new Set<string>();

  for (const tc of cases) {
    const cat = tc.category || "golden_set";
    const diff = tc.difficulty || "unspecified";
    difficulties.add(diff);
    if (!matrix.has(cat)) matrix.set(cat, new Map());
    const row = matrix.get(cat)!;
    row.set(diff, (row.get(diff) || 0) + 1);
  }

  const diffList = [...difficulties].sort();
  const header = "Category".padEnd(30) + diffList.map((d) => d.padStart(16)).join("");
  console.log(header);
  console.log("─".repeat(header.length));

  for (const [cat, row] of matrix) {
    const cells = diffList.map((d) => String(row.get(d) || 0).padStart(16));
    console.log(`${cat.padEnd(30)}${cells.join("")}`);
  }
  console.log(`\nTotal: ${cases.length} test cases across ${matrix.size} categories`);
}

// ─── Main Runner ────────────────────────────────────────────────────

async function runEval() {
  const casesPath = path.join(__dirname, "test-cases.json");
  const resultsPath = path.join(__dirname, "results.json");
  const historyDir = path.join(__dirname, "history");
  let cases: TestCase[] = JSON.parse(fs.readFileSync(casesPath, "utf-8"));

  // Apply filters
  if (filterCategory) {
    cases = cases.filter((tc) => (tc.category || "golden_set") === filterCategory);
    console.log(`🔍 Filtering to category: ${filterCategory} (${cases.length} cases)\n`);
  }
  if (filterDifficulty) {
    cases = cases.filter((tc) => tc.difficulty === filterDifficulty);
    console.log(`🔍 Filtering to difficulty: ${filterDifficulty} (${cases.length} cases)\n`);
  }
  if (filterIdArg) {
    cases = cases.filter((tc) => tc.id === filterIdArg);
    console.log(`🔍 Running single case: ${filterIdArg}\n`);
  }

  if (cases.length === 0) {
    console.error("No test cases match the filters.");
    process.exit(1);
  }

  // Print coverage matrix before running
  if (!filterIdArg) {
    printCoverageMatrix(cases);
  }

  // --resume: load previous results and skip cases that already passed
  let previousResults: EvalResult[] = [];
  const skipIds = new Set<string>();

  if (resume && fs.existsSync(resultsPath)) {
    const prev = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
    previousResults = prev.results || [];
    for (const r of previousResults) {
      if (r.pass) skipIds.add(r.id);
    }
    console.log(`\n📂 Resuming: ${skipIds.size} previously passed cases will be skipped\n`);
  }

  if (enableRubric) {
    console.log("🔬 LLM-as-judge rubric scoring ENABLED (--rubric)\n");
  }

  const results: EvalResult[] = [];
  let passed = 0;
  let skipped = 0;
  const suiteStart = Date.now();

  for (const tc of cases) {
    // Skip previously passed cases in resume mode
    if (skipIds.has(tc.id)) {
      const prev = previousResults.find((r) => r.id === tc.id)!;
      results.push(prev);
      passed++;
      skipped++;
      console.log(`⏭️  ${tc.id}: SKIP (previously passed)`);
      continue;
    }

    const failures: string[] = [];
    const start = Date.now();

    try {
      // ── Execute query (supports single-turn, multi-turn, and consistency) ──
      let result: Awaited<ReturnType<typeof chat>>;
      let toolsUsed: string[];
      let duration_ms: number;
      const history: Array<{ role: "user" | "assistant"; content: string }> = [];

      if (tc.turns && tc.turns.length > 0) {
        // ── Multi-turn conversation test ──
        // Run all turns sequentially, building up history.
        // Assertions are evaluated only on the FINAL turn.
        for (let i = 0; i < tc.turns.length; i++) {
          const turn = tc.turns[i];
          const sessionId = `eval-${tc.id}-turn${i}`;
          result = await chat(turn.query, sessionId, history);
          if (i < tc.turns.length - 1 && verbose) {
            console.log(`   Turn ${i + 1}/${tc.turns.length}: "${turn.query.slice(0, 60)}..." → ${result.toolCalls.length} tools`);
          }
        }
        // result is now the final turn's result
        result = result!;
        toolsUsed = result.toolCalls.map((t) => t.name);
        duration_ms = Date.now() - start;
      } else if (tc.consistency_runs && tc.consistency_runs > 1) {
        // ── Consistency test ──
        // Run the same query N times; assert keywords appear in ALL runs.
        const runResults: string[] = [];
        for (let i = 0; i < tc.consistency_runs; i++) {
          const runResult = await chat(tc.query!, `eval-${tc.id}-run${i}`, []);
          runResults.push(runResult.response);
          if (i === 0) {
            result = runResult; // Use first run for standard assertions
          }
        }
        result = result!;
        toolsUsed = result.toolCalls.map((t) => t.name);
        duration_ms = Date.now() - start;

        // Check consistency: all keywords must appear in ALL runs
        if (tc.consistency_keywords) {
          for (const keyword of tc.consistency_keywords) {
            const missingInRun = runResults.findIndex(
              (r) => !r.toLowerCase().includes(keyword.toLowerCase())
            );
            if (missingInRun >= 0) {
              failures.push(`consistency: "${keyword}" missing in run ${missingInRun + 1}/${tc.consistency_runs}`);
            }
          }
        }
      } else {
        // ── Standard single-turn test ──
        result = await chat(tc.query!, `eval-${tc.id}`, []);
        toolsUsed = result.toolCalls.map((t) => t.name);
        duration_ms = Date.now() - start;
      }

      const category = tc.category || "golden_set";

      // ── Programmatic Assertions (cookbook eval_checks.py) ──

      // 1. Check expected tools were called
      const toolCheck = checkTools(tc.expected_tools, toolsUsed);
      if (!toolCheck.passed) {
        failures.push(`missing tools: ${toolCheck.missing.join(", ")} (got: ${toolsUsed.join(", ") || "none"})`);
      }

      // 2. Check no-tools-called for adversarial cases (NEW)
      const noToolCheck = checkNoToolsCalled(tc.expected_tools, toolsUsed, category);
      if (noToolCheck.violated) {
        failures.push(`adversarial case called restricted tools: ${noToolCheck.tools_called.join(", ")}`);
      }

      // 3. Check must_contain
      const contentCheck = checkMustContain(tc.must_contain, result.response);
      if (!contentCheck.passed) {
        for (const m of contentCheck.missing) {
          failures.push(`must_contain missing: "${m}"`);
        }
      }

      // 4. Check must_not_contain (hallucination detection)
      const negativeCheck = checkMustNotContain(tc.must_not_contain, result.response);
      const hasHallucination = !negativeCheck.passed;
      if (hasHallucination) {
        for (const f of negativeCheck.found) {
          failures.push(`must_not_contain found: "${f}"`);
        }
      }

      // 5. Check latency assertion
      if (tc.max_latency_ms && duration_ms > tc.max_latency_ms) {
        failures.push(`latency ${duration_ms}ms exceeds max ${tc.max_latency_ms}ms`);
      }

      // ── Verification Metrics ──

      const hasSourceCitation = /sources:/i.test(result.response);
      const hasDisclaimer = /reference only|medical advice/i.test(result.response);

      // Verification accuracy: safety alerts + scope enforcement
      const isSafetyCase = category.includes("safety") || category.includes("adversarial");
      const hasSafetyAlerts = result.safetyAlerts.length > 0;
      const verificationCorrect = isSafetyCase
        ? (hasSafetyAlerts || toolCheck.passed)
        : !result.safetyAlerts.some((a) => /SCOPE WARNING/i.test(a));

      // ── Rubric Scoring (Stage 4 — optional via --rubric flag) ──

      let rubricResult: RubricResult | undefined;
      let rubricQualityGate: { passed: boolean; failures: string[] } | undefined;

      if (enableRubric) {
        try {
          rubricResult = await scoreWithRubric(
            tc.query,
            result.response,
            toolsUsed,
            category
          );
          rubricQualityGate = checkQualityGate(rubricResult);

          if (verbose && rubricResult.overall_score >= 0) {
            const dims = rubricResult.scores
              .map((s) => `${s.dimension}=${s.score}`)
              .join(", ");
            console.log(`   📊 Rubric: ${rubricResult.overall_score.toFixed(1)}/5 (${rubricResult.quality_level}) [${dims}]`);
          }
        } catch (rubricErr) {
          // Don't fail the eval case if rubric judging fails
          console.warn(`   ⚠️ Rubric judge error for ${tc.id}: ${rubricErr}`);
        }
      }

      const pass = failures.length === 0;
      if (pass) passed++;

      results.push({
        id: tc.id,
        pass,
        failures,
        tools_used: toolsUsed,
        duration_ms,
        tool_count: toolsUsed.length,
        safety_alerts: result.safetyAlerts,
        has_hallucination: hasHallucination,
        has_source_citation: hasSourceCitation,
        has_disclaimer: hasDisclaimer,
        verification_correct: verificationCorrect,
        no_tool_violation: noToolCheck.violated,
        category: tc.category,
        subcategory: tc.subcategory,
        difficulty: tc.difficulty,
        rubric: rubricResult,
        rubric_quality_gate: rubricQualityGate,
      });

      const tag = ` [${category}/${tc.subcategory || "general"}]`;
      const rubricTag = rubricResult && rubricResult.overall_score >= 0
        ? ` (rubric: ${rubricResult.overall_score.toFixed(1)})`
        : "";
      console.log(`${pass ? "✅" : "❌"} ${tc.id}${tag}: ${pass ? "PASS" : failures.join("; ")} (${(duration_ms / 1000).toFixed(1)}s)${rubricTag}`);

    } catch (err) {
      const duration_ms = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);

      // Detect credit/API errors and stop early
      if (errMsg.includes("credit balance is too low") || errMsg.includes("rate_limit")) {
        console.error(`\n⚠️  API error: ${errMsg.substring(0, 100)}`);
        console.error(`Stopping eval at case ${results.length + 1}/${cases.length} — resolve API issue and re-run with --resume.`);
        break;
      }

      failures.push(errMsg);
      results.push({
        id: tc.id,
        pass: false,
        failures,
        tools_used: [],
        duration_ms,
        tool_count: 0,
        safety_alerts: [],
        has_hallucination: false,
        has_source_citation: false,
        has_disclaimer: false,
        verification_correct: false,
        no_tool_violation: false,
        category: tc.category,
        subcategory: tc.subcategory,
        difficulty: tc.difficulty,
      });
      console.log(`❌ ${tc.id}: ERROR - ${failures[0]} (${(duration_ms / 1000).toFixed(1)}s)`);
    }
  }

  const totalDuration = Date.now() - suiteStart;

  // ═══════════════════════════════════════════════════════════════
  // PERFORMANCE METRICS COMPUTATION
  // ═══════════════════════════════════════════════════════════════

  const evalPassRate = passed / Math.max(results.length, 1);

  // Golden set pass rate (Stage 1: must be 100%)
  const goldenSets = results.filter((r) => (r.category || "golden_set") === "golden_set");
  const goldenPassed = goldenSets.filter((r) => r.pass).length;
  const goldenPassRate = goldenSets.length > 0 ? goldenPassed / goldenSets.length : 1;

  // Latency metrics
  const singleToolResults = results.filter((r) => r.tool_count === 1 && r.duration_ms > 0);
  const multiStepResults = results.filter((r) => r.tool_count >= 3 && r.duration_ms > 0);
  const allDurations = results.filter((r) => r.duration_ms > 0).map((r) => r.duration_ms).sort((a, b) => a - b);

  const avgSingleTool = singleToolResults.length > 0
    ? singleToolResults.reduce((sum, r) => sum + r.duration_ms, 0) / singleToolResults.length
    : 0;
  const avgMultiStep = multiStepResults.length > 0
    ? multiStepResults.reduce((sum, r) => sum + r.duration_ms, 0) / multiStepResults.length
    : 0;

  const singleToolUnder5s = singleToolResults.filter((r) => r.duration_ms < TARGETS.single_tool_latency_ms).length;
  const multiStepUnder15s = multiStepResults.filter((r) => r.duration_ms < TARGETS.multi_step_latency_ms).length;

  // Tool success rate
  let totalExpectedToolCalls = 0;
  let totalSuccessfulToolCalls = 0;
  for (let i = 0; i < cases.length && i < results.length; i++) {
    const tc = cases[i];
    const r = results[i];
    if (tc.expected_tools.length > 0) {
      totalExpectedToolCalls += tc.expected_tools.length;
      const matched = tc.expected_tools.filter(
        (t) => r.tools_used.some((u) => u.toLowerCase().includes(t.toLowerCase()))
      );
      totalSuccessfulToolCalls += matched.length;
    }
  }
  const toolSuccessRate = totalExpectedToolCalls > 0
    ? totalSuccessfulToolCalls / totalExpectedToolCalls
    : 1.0;

  // Hallucination rate
  const hallucinationCount = results.filter((r) => r.has_hallucination).length;
  const hallucinationRate = hallucinationCount / Math.max(results.length, 1);

  // Verification accuracy
  const verificationCorrectCount = results.filter((r) => r.verification_correct).length;
  const verificationAccuracy = verificationCorrectCount / Math.max(results.length, 1);

  // Source citation and disclaimer compliance
  const citationCount = results.filter((r) => r.has_source_citation).length;
  const disclaimerCount = results.filter((r) => r.has_disclaimer).length;

  // No-tool violation count
  const noToolViolations = results.filter((r) => r.no_tool_violation).length;

  // Rubric metrics
  const rubricResults = results.filter((r) => r.rubric && r.rubric.overall_score >= 0);
  const avgRubricScore = rubricResults.length > 0
    ? rubricResults.reduce((sum, r) => sum + r.rubric!.overall_score, 0) / rubricResults.length
    : -1;
  const rubricGatesPassedCount = results.filter((r) => r.rubric_quality_gate?.passed).length;

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY OUTPUT
  // ═══════════════════════════════════════════════════════════════

  const scenarios = results.filter((r) => (r.category || "golden_set") !== "golden_set");
  const scenarioPassed = scenarios.filter((r) => r.pass).length;

  console.log("\n═══════════════════════════════════════");
  console.log("        EVAL RESULTS SUMMARY");
  console.log("═══════════════════════════════════════");
  console.log(`Golden Sets (Stage 1): ${goldenPassed}/${goldenSets.length} passed ${goldenPassRate === 1 ? "✅" : "❌ REGRESSION"}`);
  console.log(`Labeled Scenarios:     ${scenarioPassed}/${scenarios.length} passed`);
  console.log(`Total:                 ${passed}/${results.length} passed (${(evalPassRate * 100).toFixed(1)}%)`);
  if (skipped > 0) console.log(`Skipped (resume):      ${skipped} cases`);
  console.log(`Duration:              ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`Avg per case:          ${(totalDuration / 1000 / Math.max(results.length - skipped, 1)).toFixed(1)}s (excluding skipped)`);

  // Category breakdown with visual bars
  const byCategory = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const cat = r.category || "golden_set";
    const entry = byCategory.get(cat) || { pass: 0, total: 0 };
    entry.total++;
    if (r.pass) entry.pass++;
    byCategory.set(cat, entry);
  }

  console.log("\nCategory breakdown:");
  for (const [cat, { pass: p, total }] of byCategory) {
    const pct = ((p / total) * 100).toFixed(0);
    const bar = "█".repeat(Math.round((p / total) * 20)) + "░".repeat(20 - Math.round((p / total) * 20));
    console.log(`  ${cat.padEnd(30)} ${bar} ${p}/${total} (${pct}%)`);
  }

  // Latency stats
  if (allDurations.length > 0) {
    const p50 = allDurations[Math.floor(allDurations.length * 0.5)];
    const p95 = allDurations[Math.floor(allDurations.length * 0.95)];
    console.log(`\nLatency: p50=${(p50 / 1000).toFixed(1)}s  p95=${(p95 / 1000).toFixed(1)}s`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PERFORMANCE TARGETS (cookbook-aligned)
  // ═══════════════════════════════════════════════════════════════

  console.log("\n═══════════════════════════════════════");
  console.log("        PERFORMANCE TARGETS");
  console.log("═══════════════════════════════════════");

  const formatTarget = (label: string, actual: string, target: string, met: boolean) => {
    const icon = met ? "✅" : "❌";
    return `${icon} ${label.padEnd(30)} ${actual.padEnd(15)} target: ${target}`;
  };

  // Golden sets = 100% (Stage 1)
  console.log(formatTarget(
    "Golden sets (Stage 1)",
    `${(goldenPassRate * 100).toFixed(0)}%`,
    "100%",
    goldenPassRate >= TARGETS.golden_set_pass_rate
  ));

  console.log(formatTarget(
    "End-to-end (single tool)",
    `${(avgSingleTool / 1000).toFixed(1)}s avg`,
    `<${TARGETS.single_tool_latency_ms / 1000}s`,
    avgSingleTool < TARGETS.single_tool_latency_ms || singleToolResults.length === 0
  ));
  if (singleToolResults.length > 0) {
    console.log(`   ${singleToolUnder5s}/${singleToolResults.length} queries under ${TARGETS.single_tool_latency_ms / 1000}s`);
  }

  console.log(formatTarget(
    "Multi-step (3+ tools)",
    `${(avgMultiStep / 1000).toFixed(1)}s avg`,
    `<${TARGETS.multi_step_latency_ms / 1000}s`,
    avgMultiStep < TARGETS.multi_step_latency_ms || multiStepResults.length === 0
  ));
  if (multiStepResults.length > 0) {
    console.log(`   ${multiStepUnder15s}/${multiStepResults.length} queries under ${TARGETS.multi_step_latency_ms / 1000}s`);
  }

  console.log(formatTarget(
    "Tool success rate",
    `${(toolSuccessRate * 100).toFixed(1)}%`,
    `>${(TARGETS.tool_success_rate * 100).toFixed(0)}%`,
    toolSuccessRate >= TARGETS.tool_success_rate
  ));
  console.log(`   ${totalSuccessfulToolCalls}/${totalExpectedToolCalls} expected tools called`);

  console.log(formatTarget(
    "Eval pass rate",
    `${(evalPassRate * 100).toFixed(1)}%`,
    `>${(TARGETS.eval_pass_rate * 100).toFixed(0)}%`,
    evalPassRate >= TARGETS.eval_pass_rate
  ));

  console.log(formatTarget(
    "Hallucination rate",
    `${(hallucinationRate * 100).toFixed(1)}%`,
    `<${(TARGETS.hallucination_rate * 100).toFixed(0)}%`,
    hallucinationRate <= TARGETS.hallucination_rate
  ));
  console.log(`   ${hallucinationCount}/${results.length} responses with unsupported claims`);

  console.log(formatTarget(
    "Verification accuracy",
    `${(verificationAccuracy * 100).toFixed(1)}%`,
    `>${(TARGETS.verification_accuracy * 100).toFixed(0)}%`,
    verificationAccuracy >= TARGETS.verification_accuracy
  ));
  console.log(`   ${verificationCorrectCount}/${results.length} correct verification flags`);

  if (noToolViolations > 0) {
    console.log(`\n⚠️  Adversarial tool violations: ${noToolViolations} cases called restricted tools when expected_tools was empty`);
  }

  console.log(`\n📊 Source citation rate: ${citationCount}/${results.length} (${((citationCount / Math.max(results.length, 1)) * 100).toFixed(1)}%)`);
  console.log(`📊 Disclaimer rate: ${disclaimerCount}/${results.length} (${((disclaimerCount / Math.max(results.length, 1)) * 100).toFixed(1)}%)`);

  // ═══════════════════════════════════════════════════════════════
  // RUBRIC SCORING SUMMARY (Stage 4)
  // ═══════════════════════════════════════════════════════════════

  if (enableRubric && rubricResults.length > 0) {
    console.log("\n═══════════════════════════════════════");
    console.log("     LLM-AS-JUDGE RUBRIC SCORES");
    console.log("═══════════════════════════════════════");
    console.log(`Cases scored:     ${rubricResults.length}`);
    console.log(`Avg overall:      ${avgRubricScore.toFixed(2)}/5.0 ${avgRubricScore >= TARGETS.rubric_overall_avg ? "✅" : "❌"}`);

    // Per-dimension averages
    const dimensionSums: Record<string, { total: number; count: number }> = {};
    for (const r of rubricResults) {
      for (const s of r.rubric!.scores) {
        if (!dimensionSums[s.dimension]) dimensionSums[s.dimension] = { total: 0, count: 0 };
        if (s.score >= 0) {
          dimensionSums[s.dimension].total += s.score;
          dimensionSums[s.dimension].count++;
        }
      }
    }
    console.log("\nDimension averages:");
    for (const [dim, { total, count }] of Object.entries(dimensionSums)) {
      const avg = count > 0 ? total / count : 0;
      const threshold = QUALITY_THRESHOLDS[dim as keyof typeof QUALITY_THRESHOLDS] || 3.0;
      const icon = avg >= threshold ? "✅" : "❌";
      console.log(`  ${icon} ${dim.padEnd(20)} ${avg.toFixed(2)}/5.0 (threshold: ${threshold})`);
    }

    // Quality level distribution
    const qualityLevels: Record<string, number> = {};
    for (const r of rubricResults) {
      const level = r.rubric!.quality_level;
      qualityLevels[level] = (qualityLevels[level] || 0) + 1;
    }
    console.log("\nQuality distribution:");
    for (const [level, count] of Object.entries(qualityLevels)) {
      console.log(`  ${level.padEnd(15)} ${count} (${((count / rubricResults.length) * 100).toFixed(0)}%)`);
    }

    // Quality gates
    console.log(`\nQuality gates passed: ${rubricGatesPassedCount}/${rubricResults.length}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // REGRESSION REPORT
  // ═══════════════════════════════════════════════════════════════

  if (previousResults.length > 0 && !filterCategory && !filterIdArg) {
    const regression = computeRegression(results, previousResults);

    console.log("\n═══════════════════════════════════════");
    console.log("        REGRESSION REPORT");
    console.log("═══════════════════════════════════════");
    console.log(`Pass rate delta:   ${regression.pass_rate_delta >= 0 ? "+" : ""}${(regression.pass_rate_delta * 100).toFixed(1)}%`);

    if (regression.new_failures.length > 0) {
      console.log(`\n🔴 NEW FAILURES (${regression.new_failures.length}):`);
      for (const id of regression.new_failures) {
        console.log(`   ${id}`);
      }
    }
    if (regression.new_passes.length > 0) {
      console.log(`\n🟢 NEW PASSES (${regression.new_passes.length}):`);
      for (const id of regression.new_passes) {
        console.log(`   ${id}`);
      }
    }
    if (regression.unchanged_failures.length > 0 && verbose) {
      console.log(`\n🟡 PERSISTENT FAILURES (${regression.unchanged_failures.length}):`);
      for (const id of regression.unchanged_failures) {
        console.log(`   ${id}`);
      }
    }
  }

  // Overall targets met
  const targetsMet = [
    goldenPassRate >= TARGETS.golden_set_pass_rate,
    avgSingleTool < TARGETS.single_tool_latency_ms || singleToolResults.length === 0,
    avgMultiStep < TARGETS.multi_step_latency_ms || multiStepResults.length === 0,
    toolSuccessRate >= TARGETS.tool_success_rate,
    evalPassRate >= TARGETS.eval_pass_rate,
    hallucinationRate <= TARGETS.hallucination_rate,
    verificationAccuracy >= TARGETS.verification_accuracy,
  ].filter(Boolean).length;
  console.log(`\n🎯 Performance Targets: ${targetsMet}/7 met`);

  // ═══════════════════════════════════════════════════════════════
  // SAVE RESULTS
  // ═══════════════════════════════════════════════════════════════

  const summary = {
    timestamp: new Date().toISOString(),
    total_cases: results.length,
    total_passed: passed,
    pass_rate: (evalPassRate * 100).toFixed(1) + "%",
    golden_set_pass_rate: (goldenPassRate * 100).toFixed(0) + "%",
    duration_s: (totalDuration / 1000).toFixed(1),
    avg_latency_s: (totalDuration / 1000 / Math.max(results.length - skipped, 1)).toFixed(1),
    p50_latency_s: allDurations.length > 0 ? (allDurations[Math.floor(allDurations.length * 0.5)] / 1000).toFixed(1) : "N/A",
    p95_latency_s: allDurations.length > 0 ? (allDurations[Math.floor(allDurations.length * 0.95)] / 1000).toFixed(1) : "N/A",
    rubric_avg_score: avgRubricScore >= 0 ? avgRubricScore.toFixed(2) : "N/A",
    performance_targets: {
      golden_set_pass_rate: {
        target: TARGETS.golden_set_pass_rate,
        actual: parseFloat(goldenPassRate.toFixed(4)),
        passed: goldenPassed,
        total: goldenSets.length,
        met: goldenPassRate >= TARGETS.golden_set_pass_rate,
      },
      single_tool_latency: {
        target_ms: TARGETS.single_tool_latency_ms,
        actual_avg_ms: Math.round(avgSingleTool),
        under_target_count: singleToolUnder5s,
        total_count: singleToolResults.length,
        met: avgSingleTool < TARGETS.single_tool_latency_ms || singleToolResults.length === 0,
      },
      multi_step_latency: {
        target_ms: TARGETS.multi_step_latency_ms,
        actual_avg_ms: Math.round(avgMultiStep),
        under_target_count: multiStepUnder15s,
        total_count: multiStepResults.length,
        met: avgMultiStep < TARGETS.multi_step_latency_ms || multiStepResults.length === 0,
      },
      tool_success_rate: {
        target: TARGETS.tool_success_rate,
        actual: parseFloat(toolSuccessRate.toFixed(4)),
        successful: totalSuccessfulToolCalls,
        expected: totalExpectedToolCalls,
        met: toolSuccessRate >= TARGETS.tool_success_rate,
      },
      eval_pass_rate: {
        target: TARGETS.eval_pass_rate,
        actual: parseFloat(evalPassRate.toFixed(4)),
        passed,
        total: results.length,
        met: evalPassRate >= TARGETS.eval_pass_rate,
      },
      hallucination_rate: {
        target: TARGETS.hallucination_rate,
        actual: parseFloat(hallucinationRate.toFixed(4)),
        hallucinations: hallucinationCount,
        total: results.length,
        met: hallucinationRate <= TARGETS.hallucination_rate,
      },
      verification_accuracy: {
        target: TARGETS.verification_accuracy,
        actual: parseFloat(verificationAccuracy.toFixed(4)),
        correct: verificationCorrectCount,
        total: results.length,
        met: verificationAccuracy >= TARGETS.verification_accuracy,
      },
      targets_met: targetsMet,
      targets_total: 7,
    },
    no_tool_violations: noToolViolations,
    source_citation_rate: `${citationCount}/${results.length}`,
    disclaimer_rate: `${disclaimerCount}/${results.length}`,
    categories: Object.fromEntries(byCategory),
    results,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2));
  console.log(`\nResults saved to ${resultsPath}`);

  // Save to history for regression tracking
  if (!filterCategory && !filterIdArg) {
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }
    const historyFile = path.join(
      historyDir,
      `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    fs.writeFileSync(historyFile, JSON.stringify(summary, null, 2));
    console.log(`History saved to ${historyFile}`);
  }

  // Exit code: Stage 1 golden sets must all pass; overall ≥ 80%
  if (goldenPassRate < TARGETS.golden_set_pass_rate) {
    console.error("\n❌ STAGE 1 GATE FAILED: Golden sets did not all pass. Fix before proceeding.");
    process.exit(1);
  }
  if (evalPassRate < TARGETS.eval_pass_rate) {
    console.error(`\n❌ STAGE 2 GATE FAILED: Pass rate ${(evalPassRate * 100).toFixed(1)}% < ${(TARGETS.eval_pass_rate * 100).toFixed(0)}% threshold.`);
    process.exit(1);
  }

  return summary;
}

runEval().catch(console.error);
