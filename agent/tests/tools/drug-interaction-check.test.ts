import { describe, it, expect, beforeEach } from "vitest";
import { drugInteractionCheck } from "../../src/tools/drug-interaction-check";

describe("drug_interaction_check", () => {
  let tool: ReturnType<typeof drugInteractionCheck>;

  beforeEach(() => {
    tool = drugInteractionCheck();
  });

  it("finds interaction between warfarin and aspirin (severity: serious)", async () => {
    const result = await tool.invoke({ medications: ["warfarin", "aspirin"] });
    const data = JSON.parse(result);
    expect(data.interactions).toBeDefined();
    expect(data.interactions.length).toBeGreaterThan(0);
    const interaction = data.interactions.find(
      (i: { drugs: string[] }) =>
        i.drugs?.includes("warfarin") && i.drugs?.includes("aspirin")
    );
    expect(interaction).toBeDefined();
    expect(interaction.severity).toBe("serious");
  });

  it("returns empty interactions for non-interacting drugs", async () => {
    const result = await tool.invoke({
      medications: ["tylenol", "vitamin c"],
    });
    const data = JSON.parse(result);
    expect(data.interactions).toEqual([]);
  });

  it("handles single drug input (nothing to check against)", async () => {
    const result = await tool.invoke({ medications: ["tylenol"] });
    const data = JSON.parse(result);
    expect(data.interactions).toEqual([]);
    expect(data.note).toBeDefined();
  });

  it("uses fallback DB when API is unavailable", async () => {
    const result = await tool.invoke({ medications: ["warfarin", "omeprazole"] });
    const data = JSON.parse(result);
    expect(data.interactions.length).toBeGreaterThan(0);
    const interaction = data.interactions[0];
    expect(interaction.source).toBeDefined();
  });

  it("returns source field indicating data origin", async () => {
    const result = await tool.invoke({ medications: ["warfarin", "aspirin"] });
    const data = JSON.parse(result);
    expect(data.interactions[0].source).toBeDefined();
  });

  it("caps pairs at 10 medications — skips FDA for large lists", async () => {
    // 11 meds = 55 pairs, should skip FDA API and use fallback only
    const manyMeds = [
      "warfarin", "aspirin", "lisinopril", "metformin", "omeprazole",
      "atorvastatin", "amlodipine", "metoprolol", "hydrochlorothiazide",
      "gabapentin", "acetaminophen"
    ];
    const result = await tool.invoke({ medications: manyMeds });
    const data = JSON.parse(result);
    // Should still return fallback interactions (warfarin+aspirin, etc)
    // but should not hang trying 55 FDA API calls
    expect(data.interactions).toBeDefined();
    if (data.note) {
      expect(data.note).toContain("fallback");
    }
  });

  it("does not throw when FDA API fails for non-fallback drug pair", async () => {
    // These drugs are not in the fallback DB, so the tool attempts the FDA API.
    // In test (no network), this exercises the catch block that previously
    // referenced undefined `meds[i]`/`meds[j]` instead of `drug1`/`drug2`.
    const result = await tool.invoke({ medications: ["amlodipine", "gabapentin"] });
    const data = JSON.parse(result);
    expect(data.interactions).toBeDefined();
    // Should gracefully return empty interactions, not throw
    expect(Array.isArray(data.interactions)).toBe(true);
  });

  it("normalizes drug names with dosage suffixes", async () => {
    // "Warfarin 5mg" should match "warfarin" in fallback DB
    const result = await tool.invoke({ medications: ["Warfarin 5mg", "Aspirin 81mg"] });
    const data = JSON.parse(result);
    expect(data.interactions.length).toBeGreaterThan(0);
    expect(data.interactions[0].severity).toBe("serious");
  });
});
