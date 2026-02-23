import { describe, it, expect, beforeEach } from "vitest";
import { getLabResults } from "../../src/tools/lab-results";
import { MockDataSource } from "../../src/data/mock-datasource";

describe("get_lab_results", () => {
  let tool: ReturnType<typeof getLabResults>;

  beforeEach(() => {
    tool = getLabResults(new MockDataSource());
  });

  it("returns lab results for patient 1 (at least 3 results)", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    expect(data.results.length).toBeGreaterThanOrEqual(3);
    const testNames = data.results.map((r: { test_name: string }) => r.test_name);
    expect(testNames).toContain("INR");
    expect(testNames).toContain("HbA1c");
  });

  it("returns empty results for patient 2 (no labs)", async () => {
    const result = await tool.invoke({ patient_id: "2" });
    const data = JSON.parse(result);
    expect(data.results).toEqual([]);
    expect(data.total_count).toBe(0);
  });

  it("flags critical values for patient 4 (INR 3.8, Potassium 5.3)", async () => {
    const result = await tool.invoke({ patient_id: "4" });
    const data = JSON.parse(result);
    expect(data.critical_count).toBeGreaterThan(0);
    const criticals = data.results.filter((r: { flag: string }) => r.flag === "critical");
    expect(criticals.length).toBeGreaterThan(0);
  });

  it("returns error for unknown patient", async () => {
    const result = await tool.invoke({ patient_id: "99999" });
    const data = JSON.parse(result);
    expect(data.error).toBeDefined();
  });

  it("counts abnormal and critical results correctly", async () => {
    const result = await tool.invoke({ patient_id: "4" });
    const data = JSON.parse(result);
    expect(data.abnormal_count).toBeDefined();
    expect(data.critical_count).toBeDefined();
    expect(data.total_count).toBe(data.results.length);
    const abnormals = data.results.filter((r: { flag: string }) => r.flag === "abnormal" || r.flag === "critical");
    expect(data.abnormal_count + data.critical_count).toBe(abnormals.length);
  });

  it("includes reference_range and flag for each result", async () => {
    const result = await tool.invoke({ patient_id: "1" });
    const data = JSON.parse(result);
    for (const lab of data.results) {
      expect(lab.reference_range).toBeDefined();
      expect(lab.flag).toBeDefined();
      expect(["normal", "abnormal", "critical"]).toContain(lab.flag);
    }
  });
});
