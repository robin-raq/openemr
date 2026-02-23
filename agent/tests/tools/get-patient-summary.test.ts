import { describe, it, expect, beforeEach } from "vitest";
import { getPatientSummary } from "../../src/tools/get-patient-summary";
import { MockDataSource } from "../../src/data/mock-datasource";

describe("get_patient_summary", () => {
  let tool: ReturnType<typeof getPatientSummary>;

  beforeEach(() => {
    tool = getPatientSummary(new MockDataSource());
  });

  it("returns correct patient data for valid ID 1 (John Demo)", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    expect(data.patient_id).toBe("1");
    expect(data.name).toBe("John Demo");
    expect(data.dob).toBe("1958-03-15");
    expect(data.gender).toBe("male");
    expect(data.conditions).toContain("Atrial Fibrillation");
    expect(data.medications).toHaveLength(3);
    expect(data.allergies).toContain("Penicillin");
  });

  it("returns error object for unknown patient ID 99999", async () => {
    const result = await tool.invoke({ patient_id: "99999" });
    const data = JSON.parse(result);
    expect(data.error).toBeDefined();
    expect(data.error).toContain("not found");
  });

  it("returns all required fields: name, dob, gender, conditions, medications, allergies", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    expect(data).toHaveProperty("name");
    expect(data).toHaveProperty("dob");
    expect(data).toHaveProperty("gender");
    expect(data).toHaveProperty("conditions");
    expect(data).toHaveProperty("medications");
    expect(data).toHaveProperty("allergies");
  });

  it("handles empty conditions/medications/allergies (patient 2)", async () => {
    const result = await tool.invoke({ patient_id: "2" });
    const data = JSON.parse(result);
    expect(data.conditions).toEqual([]);
    expect(data.medications).toEqual([]);
    expect(data.allergies).toEqual([]);
  });
});
