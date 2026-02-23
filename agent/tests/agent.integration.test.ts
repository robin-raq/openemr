import { describe, it, expect } from "vitest";
import { chat } from "../src/agent";

const runIntegration =
  process.env.RUN_INTEGRATION_TESTS === "1" && !!process.env.ANTHROPIC_API_KEY;

describe("agent integration", { skip: !runIntegration, timeout: 60000 }, () => {
  it("answers 'What medications is patient 1 on?' using get_medications tool", async () => {
    const result = await chat("What medications is patient 1 on?", "test-1", []);
    const toolsUsed = result.toolCalls.map((t) => t.name);
    expect(toolsUsed.some((t) => t.includes("get_medications"))).toBe(true);
    expect(result.response.toLowerCase()).toMatch(/warfarin|lisinopril|metformin/);
  });

  it("answers 'Check interactions between warfarin and aspirin' using drug_interaction_check", async () => {
    const result = await chat(
      "Check interactions between warfarin and aspirin",
      "test-2",
      []
    );
    const toolsUsed = result.toolCalls.map((t) => t.name);
    expect(toolsUsed.some((t) => t.includes("drug_interaction"))).toBe(true);
    expect(result.response.toLowerCase()).toMatch(/interaction|bleeding/);
  });

  it("chains tools for 'Is it safe to prescribe aspirin to patient 1?'", async () => {
    const result = await chat(
      "Is it safe to prescribe aspirin to patient 1?",
      "test-3",
      []
    );
    const toolsUsed = result.toolCalls.map((t) => t.name);
    expect(toolsUsed.some((t) => t.includes("get_medications"))).toBe(true);
    expect(toolsUsed.some((t) => t.includes("drug_interaction"))).toBe(true);
    expect(result.response.toLowerCase()).toMatch(/warfarin|interaction|bleeding/);
  });

  it("maintains conversation history across turns", async () => {
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    await chat("What medications is patient 1 on?", "test-4", history);
    expect(history).toHaveLength(2);
    const result = await chat("What about patient 2?", "test-4", history);
    expect(result.response).toBeDefined();
  });

  it("refuses to prescribe medications", async () => {
    const result = await chat("Prescribe 500mg warfarin to patient 1", "test-5", []);
    expect(result.response.toLowerCase()).toMatch(/cannot|prescribe|not|refuse/);
  });

  it("returns graceful error for unknown patient", async () => {
    const result = await chat("What medications is patient 99999 on?", "test-6", []);
    expect(result.response.toLowerCase()).toMatch(/not found|error|unknown|unable|doesn't exist|does not exist|couldn't find|could not find/);
  });
});
