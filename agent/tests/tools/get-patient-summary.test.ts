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

  it("returns all required fields including vitals", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    expect(data).toHaveProperty("name");
    expect(data).toHaveProperty("dob");
    expect(data).toHaveProperty("gender");
    expect(data).toHaveProperty("conditions");
    expect(data).toHaveProperty("medications");
    expect(data).toHaveProperty("allergies");
    expect(data).toHaveProperty("vitals");
  });

  it("handles empty conditions/medications/allergies (patient 2)", async () => {
    const result = await tool.invoke({ patient_id: "2" });
    const data = JSON.parse(result);
    expect(data.conditions).toEqual([]);
    expect(data.medications).toEqual([]);
    expect(data.allergies).toEqual([]);
  });

  // --- Vitals tests ---

  it("includes vitals array in patient summary", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    expect(Array.isArray(data.vitals)).toBe(true);
    expect(data.vitals.length).toBeGreaterThan(0);
  });

  it("returns realistic vitals for patient 1 (HTN - elevated BP)", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    const bp = data.vitals.find((v: { name: string }) => v.name === "Blood Pressure");
    expect(bp).toBeDefined();
    expect(bp.value).toBe("145/92");
    expect(bp.unit).toBe("mmHg");
    expect(bp.status).toBe("abnormal");

    const hr = data.vitals.find((v: { name: string }) => v.name === "Heart Rate");
    expect(hr).toBeDefined();
    expect(hr.status).toBe("normal");

    expect(data.vitals.length).toBeGreaterThanOrEqual(4);
  });

  it("returns empty vitals for patient 2 (minimal)", async () => {
    const result = await tool.invoke({ patient_id: "2" });
    const data = JSON.parse(result);
    expect(data.vitals).toEqual([]);
  });

  it("returns all-normal vitals for patient 3", async () => {
    const result = await tool.invoke({ patient_id: "3" });
    const data = JSON.parse(result);
    expect(data.vitals.length).toBeGreaterThan(0);
    for (const v of data.vitals) {
      expect(v.status).toBe("normal");
    }
  });

  it("returns critical vitals for patient 4 (Sara Complex)", async () => {
    const result = await tool.invoke({ patient_id: "4" });
    const data = JSON.parse(result);
    const bp = data.vitals.find((v: { name: string }) => v.name === "Blood Pressure");
    expect(bp).toBeDefined();
    expect(bp.value).toBe("168/98");
    expect(bp.status).toBe("critical");

    const spo2 = data.vitals.find((v: { name: string }) => v.name === "SpO2");
    expect(spo2).toBeDefined();
    expect(spo2.value).toBe("93");
    expect(spo2.status).toBe("critical");
  });

  it("each vital has required fields: name, value, unit, date, status", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    for (const v of data.vitals) {
      expect(v).toHaveProperty("name");
      expect(v).toHaveProperty("value");
      expect(v).toHaveProperty("unit");
      expect(v).toHaveProperty("date");
      expect(v).toHaveProperty("status");
      expect(["normal", "abnormal", "critical"]).toContain(v.status);
    }
  });
});
