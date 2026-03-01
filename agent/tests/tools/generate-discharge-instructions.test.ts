import { describe, it, expect, beforeEach } from "vitest";
import { MockDataSource } from "../../src/data/mock-datasource";
import { generateDischargeInstructions } from "../../src/tools/generate-discharge-instructions";

describe("generate_discharge_instructions", () => {
  let toolFn: ReturnType<typeof generateDischargeInstructions>;

  beforeEach(() => {
    const ds = new MockDataSource();
    toolFn = generateDischargeInstructions(ds);
  });

  it("returns structured discharge instructions for patient 1 enc-101", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.type).toBe("discharge_instructions");
    expect(result.patient).toBeTruthy();
    expect(result.new_medications).toBeDefined();
    expect(result.discontinued_medications).toBeDefined();
    expect(result.modified_medications).toBeDefined();
    expect(result.continued_medications).toBeDefined();
    expect(result.follow_up_guidance).toBeDefined();
    expect(result.warning_signs).toBeDefined();
  });

  it("includes patient name and conditions", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.patient.name).toBe("John Demo");
    expect(result.patient.conditions).toContain("Atrial Fibrillation");
  });

  it("lists new medications with name, dose, frequency, and reason", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.new_medications).toHaveLength(1);
    const metoprolol = result.new_medications[0];
    expect(metoprolol.name).toBe("Metoprolol");
    expect(metoprolol.dose).toBe("25mg");
    expect(metoprolol.frequency).toBe("twice daily");
    expect(metoprolol.reason).toBeTruthy();
  });

  it("lists modified medications with old and new doses", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.modified_medications).toHaveLength(2);
    const lisinopril = result.modified_medications.find(
      (m: { name: string }) => m.name === "Lisinopril"
    );
    expect(lisinopril).toBeTruthy();
    expect(lisinopril.previous_dose).toBe("10mg");
    expect(lisinopril.new_dose).toBe("20mg");
    expect(lisinopril.reason).toBeTruthy();
  });

  it("lists continued medications as keep-taking", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.continued_medications).toHaveLength(1);
    expect(result.continued_medications[0].name).toBe("Warfarin");
    expect(result.continued_medications[0].dose).toBe("5mg");
  });

  it("returns empty discontinued array when none exist", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.discontinued_medications).toHaveLength(0);
  });

  it("handles patient 4 enc-401 with multiple modified and new meds", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "4", encounter_id: "enc-401" })
    );
    expect(result.new_medications).toHaveLength(2); // Amlodipine, Glipizide
    expect(result.modified_medications).toHaveLength(2); // Warfarin, Lisinopril
    expect(result.continued_medications).toHaveLength(3); // Metformin, Atorvastatin, Omeprazole
  });

  it("includes follow-up guidance based on diagnoses", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.follow_up_guidance).toBeInstanceOf(Array);
    expect(result.follow_up_guidance.length).toBeGreaterThan(0);
  });

  it("includes warning signs based on conditions", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.warning_signs).toBeInstanceOf(Array);
    expect(result.warning_signs.length).toBeGreaterThan(0);
  });

  it("includes allergy reminders", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.allergy_reminders).toContain("Penicillin");
  });

  it("includes encounter metadata", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.encounter.admission_reason).toBeTruthy();
    expect(result.encounter.discharge_date).toBe("2024-01-10");
    expect(result.encounter.attending_provider).toBe("Dr. Smith");
  });

  it("returns error for unknown encounter_id", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-999" })
    );
    expect(result.error).toContain("Encounter not found");
  });

  it("returns error for unknown patient_id", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "99999", encounter_id: "enc-101" })
    );
    expect(result.error).toBeTruthy();
  });

  it("includes safety flags for medication changes", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.safety_flags.has_new_medications).toBe(true);
    expect(result.safety_flags.has_modified_medications).toBe(true);
    expect(result.safety_flags.has_discontinued_medications).toBe(false);
    expect(result.safety_flags.total_discharge_medications).toBe(4);
  });

  it("includes data_source field indicating DailyMed", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.data_source).toContain("OpenEMR");
    expect(result.data_source).toContain("DailyMed");
  });

  it("includes scheduled_appointments array in output", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.scheduled_appointments).toBeDefined();
    expect(result.scheduled_appointments).toBeInstanceOf(Array);
  });

  it("patient 1 has non-empty scheduled appointments", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    expect(result.scheduled_appointments.length).toBeGreaterThan(0);
  });

  it("each appointment has provider, specialty, date, time, location, reason", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    for (const appt of result.scheduled_appointments) {
      expect(appt).toHaveProperty("provider");
      expect(appt).toHaveProperty("specialty");
      expect(appt).toHaveProperty("date");
      expect(appt).toHaveProperty("time");
      expect(appt).toHaveProperty("location");
      expect(appt).toHaveProperty("reason");
    }
  });

  it("appointments are sorted by date", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "1", encounter_id: "enc-101" })
    );
    const dates = result.scheduled_appointments.map((a: { date: string }) => a.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("patient 4 has 4 scheduled appointments", async () => {
    const result = JSON.parse(
      await toolFn.invoke({ patient_id: "4", encounter_id: "enc-401" })
    );
    expect(result.scheduled_appointments).toHaveLength(4);
  });
});
