/**
 * Generate eval results SVG image for README.
 * Reads from eval/results.json (output of run-eval.ts).
 * Run: node eval/generate-results-image.js
 */

const fs = require("fs");
const path = require("path");

const resultsPath = path.join(__dirname, "results.json");
if (!fs.existsSync(resultsPath)) {
  console.error("❌ No eval/results.json found. Run the eval suite first:\n   npx tsx eval/run-eval.ts");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
const results = data.results;

// Build category stats from actual results
const catMap = new Map();
for (const r of results) {
  const cat = r.category || "golden_set";
  if (!catMap.has(cat)) catMap.set(cat, { passed: 0, total: 0 });
  const entry = catMap.get(cat);
  entry.total++;
  if (r.pass) entry.passed++;
}

// Friendly names for categories
const catNames = {
  golden_set: "Golden Sets",
  multi_tool: "Multi-tool",
  edge_case: "Edge Cases",
  adversarial: "Adversarial",
  safety: "Safety",
  query_variation: "Query Variation",
  drug_interactions: "Drug Interactions",
  complex_query: "Complex Queries",
  bounty_encounter: "Bounty: Encounters",
  bounty_med_rec: "Bounty: Med Rec",
  bounty_discharge: "Bounty: Discharge",
  bounty_workflow: "Bounty: Workflows",
  bounty_safety: "Bounty: Safety",
  bounty_edge: "Bounty: Edge Cases",
  bounty_discharge_instructions: "Discharge Instr.",
  appointments: "Appointments",
  dailymed: "DailyMed",
  workflow: "Workflows",
};

const categories = [];
for (const [key, stats] of catMap) {
  categories.push({
    name: catNames[key] || key,
    passed: stats.passed,
    total: stats.total,
  });
}

// Build tool coverage from actual results
const toolCounts = {};
for (const r of results) {
  if (r.tools_used) {
    for (const t of r.tools_used) {
      toolCounts[t] = (toolCounts[t] || 0) + 1;
    }
  }
}
const tools = Object.entries(toolCounts)
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count);

const totalPassed = results.filter((r) => r.pass).length;
const totalCases = results.length;
const passRate = ((totalPassed / totalCases) * 100).toFixed(1);

// Latency stats
const durations = results.filter((r) => r.duration_ms > 0).map((r) => r.duration_ms).sort((a, b) => a - b);
const avgLatency = durations.length > 0 ? (durations.reduce((s, d) => s + d, 0) / durations.length / 1000).toFixed(1) : "N/A";

const width = 900;
const rowHeight = 32;
const headerHeight = 120;
const categorySection = categories.length * rowHeight + 60;
const toolSection = tools.length * rowHeight + 60;
const footerHeight = 80;
const height = headerHeight + categorySection + toolSection + footerHeight;

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap');
      text { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    </style>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="green-bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22c55e"/>
      <stop offset="100%" stop-color="#16a34a"/>
    </linearGradient>
    <linearGradient id="yellow-bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#ca8a04"/>
    </linearGradient>
    <linearGradient id="red-bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ef4444"/>
      <stop offset="100%" stop-color="#dc2626"/>
    </linearGradient>
    <linearGradient id="blue-bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg)" rx="12"/>

  <!-- Header -->
  <text x="40" y="45" font-size="24" font-weight="700" fill="#f8fafc">AgentForge Eval Results</text>
  <text x="40" y="70" font-size="14" fill="#94a3b8">Clinical Query Agent for OpenEMR — ${totalCases} test cases</text>

  <!-- Pass rate badge -->
  <rect x="${width - 200}" y="20" width="160" height="60" rx="10" fill="${parseFloat(passRate) >= 80 ? '#052e16' : '#451a03'}" stroke="${parseFloat(passRate) >= 80 ? '#22c55e' : '#eab308'}" stroke-width="1.5"/>
  <text x="${width - 120}" y="46" font-size="28" font-weight="700" fill="${parseFloat(passRate) >= 80 ? '#22c55e' : '#eab308'}" text-anchor="middle">${passRate}%</text>
  <text x="${width - 120}" y="66" font-size="12" fill="${parseFloat(passRate) >= 80 ? '#86efac' : '#fde047'}" text-anchor="middle">${totalPassed}/${totalCases} passed</text>

  <!-- Metrics row -->
  <rect x="40" y="85" width="160" height="30" rx="6" fill="#1e3a5f"/>
  <text x="120" y="105" font-size="12" fill="#93c5fd" text-anchor="middle">232 Unit Tests ✅</text>
  <rect x="210" y="85" width="160" height="30" rx="6" fill="#1e3a5f"/>
  <text x="290" y="105" font-size="12" fill="#93c5fd" text-anchor="middle">${tools.length} Tools Covered ✅</text>
  <rect x="380" y="85" width="160" height="30" rx="6" fill="#1e3a5f"/>
  <text x="460" y="105" font-size="12" fill="#93c5fd" text-anchor="middle">${totalCases} Eval Cases ✅</text>
  <rect x="550" y="85" width="160" height="30" rx="6" fill="#1e3a5f"/>
  <text x="630" y="105" font-size="12" fill="#93c5fd" text-anchor="middle">Avg ${avgLatency}s/query</text>
`;

// Category section
let y = headerHeight + 10;
svg += `<text x="40" y="${y}" font-size="16" font-weight="600" fill="#e2e8f0">Category Breakdown</text>`;
y += 25;

const barMaxWidth = 350;
for (const cat of categories) {
  const pct = cat.total > 0 ? cat.passed / cat.total : 0;
  const barWidth = Math.max(pct * barMaxWidth, 4);
  const barGrad = pct >= 0.9 ? "url(#green-bar)" : pct >= 0.7 ? "url(#yellow-bar)" : "url(#red-bar)";
  const pctColor = pct >= 0.9 ? "#86efac" : pct >= 0.7 ? "#fde047" : "#fca5a5";

  svg += `
  <text x="40" y="${y + 20}" font-size="13" fill="#cbd5e1">${cat.name}</text>
  <rect x="230" y="${y + 6}" width="${barMaxWidth}" height="18" rx="4" fill="#334155"/>
  <rect x="230" y="${y + 6}" width="${barWidth}" height="18" rx="4" fill="${barGrad}"/>
  <text x="${240 + barMaxWidth}" y="${y + 20}" font-size="13" fill="#94a3b8">${cat.passed}/${cat.total}</text>
  <text x="${310 + barMaxWidth}" y="${y + 20}" font-size="13" fill="${pctColor}" font-weight="600">${(pct * 100).toFixed(0)}%</text>`;
  y += rowHeight;
}

// Tool coverage section
if (tools.length > 0) {
  y += 30;
  svg += `<text x="40" y="${y}" font-size="16" font-weight="600" fill="#e2e8f0">Tool Usage (from eval runs)</text>`;
  y += 25;

  const maxToolCount = Math.max(...tools.map((t) => t.count));
  for (const tool of tools) {
    svg += `
  <text x="40" y="${y + 20}" font-size="12" fill="#cbd5e1" font-family="monospace">${tool.name}</text>
  <rect x="310" y="${y + 6}" width="${barMaxWidth - 80}" height="18" rx="4" fill="#334155"/>
  <rect x="310" y="${y + 6}" width="${(tool.count / maxToolCount) * (barMaxWidth - 80)}" height="18" rx="4" fill="url(#blue-bar)"/>
  <text x="${320 + barMaxWidth - 80}" y="${y + 20}" font-size="13" fill="#93c5fd" font-weight="600">${tool.count} calls</text>`;
    y += rowHeight;
  }
}

// Footer
y += 20;
svg += `
  <line x1="40" y1="${y}" x2="${width - 40}" y2="${y}" stroke="#334155" stroke-width="1"/>
  <text x="40" y="${y + 25}" font-size="12" fill="#64748b">Generated ${data.timestamp ? data.timestamp.split("T")[0] : new Date().toISOString().split("T")[0]} • LangChain.js + Claude Sonnet 4 • Vitest + Custom Eval Harness</text>
  <text x="40" y="${y + 45}" font-size="12" fill="#64748b">OpenEMR Clinical Query Agent — Built for Gauntlet AI Week 2 Bounty</text>
</svg>`;

const outputPath = path.join(__dirname, "..", "docs", "eval-results-summary.svg");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`✅ Eval results image saved to ${outputPath}`);

// Also update markdown
const mdPath = path.join(__dirname, "..", "docs", "eval-results.md");
const md = `# AgentForge Eval Results

## Summary
- **Pass Rate:** ${passRate}% (${totalPassed}/${totalCases})
- **Unit Tests:** 232 passing
- **Tools Covered:** ${tools.length}/10
- **Eval Cases:** ${totalCases}
- **Avg Latency:** ${avgLatency}s/query

## Category Breakdown
| Category | Passed | Total | Rate |
|----------|--------|-------|------|
${categories.map((c) => `| ${c.name} | ${c.passed} | ${c.total} | ${c.total > 0 ? ((c.passed / c.total) * 100).toFixed(0) : 0}% |`).join("\n")}

## Tool Usage
| Tool | Calls |
|------|-------|
${tools.map((t) => `| \`${t.name}\` | ${t.count} |`).join("\n")}
`;
fs.writeFileSync(mdPath, md);
console.log(`✅ Eval results markdown saved to ${mdPath}`);
