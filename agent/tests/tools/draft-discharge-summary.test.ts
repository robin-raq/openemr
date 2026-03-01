import { describe, it, expect, beforeEach } from "vitest";
import { MockDataSource } from "../../src/data/mock-datasource";
import { draftDischargeSummary } from "../../src/tools/draft-discharge-summary";

describe("draft_discharge_summary", () => {
  let toolFn: ReturnType<typeof draftDischargeSummary>;

  beforeEach(() => {
    const ds = new MockDataSource();
    toolFn = draftDischargeSummary(ds);
  });

  it("returns structured discharge data for patient 1 enc-101", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.type).toBe("discharge_summary_draft");
    expect(result.patient).toBeTruthy();
    expect(result.encounter).toBeTruthy();
    expect(result.medication_reconciliation).toBeTruthy();
    expect(result.labs_at_discharge).toBeTruthy();
  });

  it("includes patient demographics in response", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.patient.name).toBe("John Demo");
    expect(result.patient.dob).toBeTruthy();
    expect(result.patient.gender).toBe("male");
    expect(result.patient.allergies).toContain("Penicillin");
  });

  it("includes encounter details (dates, provider, diagnoses)", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.encounter.admission_date).toBe("2024-01-05");
    expect(result.encounter.discharge_date).toBe("2024-01-10");
    expect(result.encounter.attending_provider).toBe("Dr. Smith");
    expect(result.encounter.diagnoses.length).toBeGreaterThan(0);
  });

  it("includes hospital course notes", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.encounter.hospital_course.length).toBe(5);
    expect(result.encounter.hospital_course[0]).toContain("Day 1");
  });

  it("includes medication reconciliation breakdown", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    const medRec = result.medication_reconciliation;
    expect(medRec.discharge_medications.length).toBeGreaterThan(0);
    expect(medRec.modified.length).toBeGreaterThan(0);
    expect(medRec.new_medications.length).toBeGreaterThan(0);
  });

  it("includes lab results with flag counts", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.labs_at_discharge.total_count).toBeGreaterThan(0);
    expect(result.labs_at_discharge).toHaveProperty("critical");
    expect(result.labs_at_discharge).toHaveProperty("abnormal");
    expect(result.labs_at_discharge).toHaveProperty("normal_count");
  });

  it("sets safety_flags.has_critical_labs correctly for patient 1", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.safety_flags.has_critical_labs).toBe(false); // patient 1 has no critical labs
  });

  it("sets safety_flags.has_medication_changes correctly", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.safety_flags.has_medication_changes).toBe(true);
  });

  it("returns error for unknown encounter_id", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-999" })
    );
    expect(result.error).toContain("Encounter not found");
  });

  it("returns critical labs for patient 4 enc-401", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "4", encounter_id: "enc-401" })
    );
    expect(result.safety_flags.has_critical_labs).toBe(true);
    expect(result.labs_at_discharge.critical.length).toBeGreaterThan(0);
  });
});
