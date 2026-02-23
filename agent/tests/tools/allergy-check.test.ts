import { describe, it, expect, beforeEach } from "vitest";
import { allergyCheck } from "../../src/tools/allergy-check";
import { MockDataSource } from "../../src/data/mock-datasource";

describe("allergy_check", () => {
  let tool: ReturnType<typeof allergyCheck>;

  beforeEach(() => {
    tool = allergyCheck(new MockDataSource());
  });

  it("flags conflict for patient 3 (Penicillin allergy) + amoxicillin", async () => {
    const result = await tool.invoke({ patient_id: "3", proposed_medication: "amoxicillin" });
    const data = JSON.parse(result);
    expect(data.safe).toBe(false);
    expect(data.conflicts.length).toBeGreaterThan(0);
    expect(data.conflicts[0].allergen.toLowerCase()).toContain("penicillin");
  });

  it("returns safe for patient 3 + metformin (no conflict)", async () => {
    const result = await tool.invoke({ patient_id: "3", proposed_medication: "metformin" });
    const data = JSON.parse(result);
    expect(data.safe).toBe(true);
    expect(data.conflicts).toEqual([]);
  });

  it("returns safe for patient 2 (no allergies) + any medication", async () => {
    const result = await tool.invoke({ patient_id: "2", proposed_medication: "amoxicillin" });
    const data = JSON.parse(result);
    expect(data.safe).toBe(true);
    expect(data.allergies).toEqual([]);
  });

  it("returns error for unknown patient", async () => {
    const result = await tool.invoke({ patient_id: "99999", proposed_medication: "aspirin" });
    const data = JSON.parse(result);
    expect(data.error).toBeDefined();
  });

  it("handles case-insensitive matching", async () => {
    const result = await tool.invoke({ patient_id: "3", proposed_medication: "AMOXICILLIN" });
    const data = JSON.parse(result);
    expect(data.safe).toBe(false);
  });

  it("flags codeine cross-reactivity for patient 4 (Codeine allergy) + morphine", async () => {
    const result = await tool.invoke({ patient_id: "4", proposed_medication: "morphine" });
    const data = JSON.parse(result);
    expect(data.safe).toBe(false);
    expect(data.conflicts[0].allergen.toLowerCase()).toContain("codeine");
  });

  it("flags sulfa cross-reactivity for patient 3 (Sulfa allergy) + sulfamethoxazole", async () => {
    const result = await tool.invoke({ patient_id: "3", proposed_medication: "sulfamethoxazole" });
    const data = JSON.parse(result);
    expect(data.safe).toBe(false);
    expect(data.conflicts[0].allergen.toLowerCase()).toContain("sulfa");
  });
});
