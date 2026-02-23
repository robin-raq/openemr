import { describe, it, expect, beforeEach } from "vitest";
import { getMedications } from "../../src/tools/get-medications";
import { MockDataSource } from "../../src/data/mock-datasource";

describe("get_medications", () => {
  let tool: ReturnType<typeof getMedications>;

  beforeEach(() => {
    tool = getMedications(new MockDataSource());
  });

  it("returns medication list for patient 1 (3 medications)", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    expect(data.medications).toHaveLength(3);
    expect(data.medications.map((m: { name: string }) => m.name)).toEqual([
      "Warfarin",
      "Lisinopril",
      "Metformin",
    ]);
  });

  it("returns empty array with note for patient 2 (no medications)", async () => {
    const result = await tool.invoke({ patient_id: "2" });
    const data = JSON.parse(result);
    expect(data.medications).toEqual([]);
    expect(data.note).toContain("No active medications");
  });

  it("returns error for unknown patient 99999", async () => {
    const result = await tool.invoke({ patient_id: "99999" });
    const data = JSON.parse(result);
    expect(data.error).toBeDefined();
    expect(data.error).toContain("not found");
  });

  it("each medication has name, dose, frequency, start_date, prescriber, status", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    const med = data.medications[0];
    expect(med).toHaveProperty("name");
    expect(med).toHaveProperty("dose");
    expect(med).toHaveProperty("frequency");
    expect(med).toHaveProperty("start_date");
    expect(med).toHaveProperty("prescriber");
    expect(med).toHaveProperty("status");
  });
});
