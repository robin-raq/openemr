import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { chat } from "../src/agent";

interface TestCase {
  id: number;
  category: string;
  input: string;
  expected_tools: string[];
  expected_output_contains: string[];
  pass_criteria: string;
}

async function runEval() {
  const casesPath = path.join(__dirname, "test-cases.json");
  const cases: TestCase[] = JSON.parse(fs.readFileSync(casesPath, "utf-8"));

  let passed = 0;
  const results: Array<{ id: number; pass: boolean; reason: string }> = [];

  for (const tc of cases) {
    try {
      const result = await chat(tc.input, `eval-${tc.id}`, []);
      const toolsUsed = result.toolCalls.map((t) => t.name);
      const responseLower = result.response.toLowerCase();

      let pass = true;
      let reason = "";

      if (tc.expected_tools.length > 0) {
        const toolsMatch = tc.expected_tools.every((t) =>
          toolsUsed.some((u) => u.toLowerCase().includes(t.toLowerCase()))
        );
        if (!toolsMatch) {
          pass = false;
          reason = `Expected tools ${tc.expected_tools.join(", ")}, got ${toolsUsed.join(", ")}`;
        }
      }

      if (pass && tc.expected_output_contains.length > 0) {
        const containsAll = tc.expected_output_contains.every((s) =>
          responseLower.includes(s.toLowerCase())
        );
        if (!containsAll) {
          pass = false;
          reason = `Response missing: ${tc.expected_output_contains.filter((s) => !responseLower.includes(s.toLowerCase())).join(", ")}`;
        }
      }

      if (pass) passed++;
      results.push({ id: tc.id, pass, reason: reason || "OK" });
      console.log(`Case ${tc.id} (${tc.category}): ${pass ? "PASS" : "FAIL"} ${reason}`);
    } catch (err) {
      results.push({
        id: tc.id,
        pass: false,
        reason: err instanceof Error ? err.message : String(err),
      });
      console.log(`Case ${tc.id}: FAIL - ${results[results.length - 1].reason}`);
    }
  }

  console.log(`\n${passed}/${cases.length} passed`);
  return { passed, total: cases.length, results };
}

runEval().catch(console.error);
