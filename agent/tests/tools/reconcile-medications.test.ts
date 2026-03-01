import { describe, it, expect, beforeEach } from "vitest";
import { MockDataSource } from "../../src/data/mock-datasource";
import { reconcileMedications } from "../../src/tools/reconcile-medications";

describe("reconcile_medications", () => {
  let toolFn: ReturnType<typeof reconcileMedications>;

  beforeEach(() => {
    const ds = new MockDataSource();
    toolFn = reconcileMedications(ds);
  });

  it("returns reconciliation for enc-101 with correct categorization", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.reconciliation.continued).toHaveLength(1); // Warfarin
    expect(result.reconciliation.modified).toHaveLength(2); // Lisinopril, Metformin
    expect(result.reconciliation.new_medications).toHaveLength(1); // Metoprolol
  });

  it("identifies modified medications with original doses", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    const lisinopril = result.reconciliation.modified.find(
      (m: { name: string }) => m.name === "Lisinopril"
    );
    expect(lisinopril).toBeTruthy();
    expect(lisinopril.original_dose).toBe("10mg");
    expect(lisinopril.dose).toBe("20mg");
  });

  it("identifies newly added medications", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    const metoprolol = result.reconciliation.new_medications.find(
      (m: { name: string }) => m.name === "Metoprolol"
    );
    expect(metoprolol).toBeTruthy();
    expect(metoprolol.modification_reason).toContain("rate control");
  });

  it("identifies continued medications", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.reconciliation.continued[0].name).toBe("Warfarin");
  });

  it("builds change summary strings", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.change_summary.length).toBeGreaterThan(0);
    expect(result.change_summary.some((s: string) => s.includes("Lisinopril"))).toBe(true);
  });

  it("includes patient allergies in response", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.allergies).toContain("Penicillin");
  });

  it("returns error for unknown patient", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "99999", encounter_id: "enc-101" })
    );
    expect(result.error).toBeTruthy();
  });

  it("returns has_changes=true when modifications exist", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.has_changes).toBe(true);
  });

  it("returns total_discharge_medications excluding discontinued", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    // 4 meds total, 0 discontinued = 4
    expect(result.total_discharge_medications).toBe(4);
  });
});
