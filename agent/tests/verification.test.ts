import { describe, it, expect } from "vitest";
import { applyVerification, detectPrescriptiveLanguage } from "../src/verification/verification";

describe("verification", () => {
  it("adds safety alert for serious drug interactions", () => {
    const result = applyVerification("Patient is on warfarin.", [
      {
        name: "drug_interaction_check",
        args: { medications: ["warfarin", "aspirin"] },
        result: JSON.stringify({
          interactions: [
            {
              drugs: ["warfarin", "aspirin"],
              severity: "serious",
              description: "Increased risk of bleeding.",
              source: "fallback_db",
            },
          ],
        }),
      },
    ]);
    expect(result.safetyAlerts).toHaveLength(1);
    expect(result.safetyAlerts[0]).toContain("SAFETY ALERT");
    expect(result.safetyAlerts[0]).toContain("bleeding");
    // Alerts should NOT be in the response text (UI renders them as separate banners)
    expect(result.response).not.toContain("⚠️ SAFETY ALERT");
  });

  it("adds source citation to every response", () => {
    const result = applyVerification("Patient 1 has no allergies.", []);
    expect(result.response).toContain("Sources:");
  });

  it("adds medical disclaimer to every response", () => {
    const result = applyVerification("Hello.", []);
    expect(result.response).toContain(
      "This information is for reference only and does not constitute medical advice"
    );
  });

  it("does not add safety alert when no interactions found", () => {
    const result = applyVerification("No interactions.", [
      {
        name: "drug_interaction_check",
        args: { medications: ["tylenol", "vitamin c"] },
        result: JSON.stringify({ interactions: [] }),
      },
    ]);
    expect(result.safetyAlerts).toHaveLength(0);
    expect(result.response).not.toContain("⚠️ SAFETY ALERT");
  });

  describe("dynamic source citations", () => {
    it("cites only 'OpenEMR Patient Records' when only patient tools called", () => {
      const result = applyVerification("Patient info here.", [
        {
          name: "get_patient_summary",
          args: { patient_id: "1" },
          result: JSON.stringify({ name: "John Demo" }),
        },
      ]);
      expect(result.response).toContain("OpenEMR Patient Records");
      expect(result.response).not.toContain("OpenFDA");
    });

    it("cites 'OpenFDA' only when drug_interaction_check was called", () => {
      const result = applyVerification("Interaction check.", [
        {
          name: "drug_interaction_check",
          args: { medications: ["warfarin", "aspirin"] },
          result: JSON.stringify({ interactions: [] }),
        },
      ]);
      expect(result.response).toContain("OpenFDA");
    });

    it("cites both sources when both patient and drug tools used", () => {
      const result = applyVerification("Full report.", [
        {
          name: "get_medications",
          args: { patient_id: "1" },
          result: JSON.stringify({ medications: [] }),
        },
        {
          name: "drug_interaction_check",
          args: { medications: ["warfarin", "aspirin"] },
          result: JSON.stringify({ interactions: [] }),
        },
      ]);
      expect(result.response).toContain("OpenEMR Patient Records");
      expect(result.response).toContain("OpenFDA");
    });

    it("shows generic citation when no tools were called", () => {
      const result = applyVerification("General response.", []);
      expect(result.response).toContain("Sources:");
    });

    it("cites OpenEMR for new bounty tools", () => {
      const result = applyVerification("Encounter data.", [
        {
          name: "get_encounter_data",
          args: { patient_id: "1" },
          result: JSON.stringify({ encounters: [] }),
        },
      ]);
      expect(result.response).toContain("OpenEMR Patient Records");
    });
  });

  describe("medication reconciliation verification", () => {
    it("adds safety alert for modified medications", () => {
      const result = applyVerification("Med rec complete.", [
        {
          name: "reconcile_medications",
          args: { patient_id: "1", encounter_id: "enc-101" },
          result: JSON.stringify({
            reconciliation: {
              modified: [
                {
                  name: "Lisinopril",
                  dose: "20mg",
                  frequency: "daily",
                  original_dose: "10mg",
                  original_frequency: "daily",
                  modification_reason: "BP control",
                },
              ],
              new_medications: [],
              discontinued: [],
            },
          }),
        },
      ]);
      expect(result.safetyAlerts.some((a) => a.includes("MEDICATION CHANGE"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("Lisinopril"))).toBe(true);
    });

    it("adds safety alert for new medications", () => {
      const result = applyVerification("New meds added.", [
        {
          name: "reconcile_medications",
          args: { patient_id: "1", encounter_id: "enc-101" },
          result: JSON.stringify({
            reconciliation: {
              modified: [],
              new_medications: [
                {
                  name: "Amlodipine",
                  dose: "5mg",
                  frequency: "daily",
                  modification_reason: "BP control",
                },
              ],
              discontinued: [],
            },
          }),
        },
      ]);
      expect(result.safetyAlerts.some((a) => a.includes("NEW MEDICATION"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("Amlodipine"))).toBe(true);
    });

    it("adds safety alert for discontinued medications", () => {
      const result = applyVerification("Med discontinued.", [
        {
          name: "reconcile_medications",
          args: { patient_id: "1", encounter_id: "enc-101" },
          result: JSON.stringify({
            reconciliation: {
              modified: [],
              new_medications: [],
              discontinued: [
                {
                  name: "Aspirin",
                  modification_reason: "Bleeding risk with warfarin",
                },
              ],
            },
          }),
        },
      ]);
      expect(result.safetyAlerts.some((a) => a.includes("DISCONTINUED"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("Aspirin"))).toBe(true);
    });

    it("no alerts when all medications are continued unchanged", () => {
      const result = applyVerification("No changes.", [
        {
          name: "reconcile_medications",
          args: { patient_id: "1", encounter_id: "enc-101" },
          result: JSON.stringify({
            reconciliation: {
              modified: [],
              new_medications: [],
              discontinued: [],
            },
          }),
        },
      ]);
      expect(result.safetyAlerts).toHaveLength(0);
    });
  });

  describe("discharge summary verification", () => {
    it("adds critical lab alert from discharge summary data", () => {
      const result = applyVerification("Summary drafted.", [
        {
          name: "draft_discharge_summary",
          args: { patient_id: "4", encounter_id: "enc-401" },
          result: JSON.stringify({
            safety_flags: { has_critical_labs: true },
            labs_at_discharge: {
              critical: [
                {
                  test_name: "INR",
                  value: 3.8,
                  unit: "",
                  reference_range: "2.0-3.0",
                },
              ],
            },
          }),
        },
      ]);
      expect(result.safetyAlerts.some((a) => a.includes("CRITICAL LAB AT DISCHARGE"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("INR"))).toBe(true);
    });

    it("adds draft saved confirmation for save_to_chart", () => {
      const result = applyVerification("Saved.", [
        {
          name: "save_to_chart",
          args: {},
          result: JSON.stringify({
            success: true,
            document_id: "doc-1",
          }),
        },
      ]);
      expect(result.safetyAlerts.some((a) => a.includes("DRAFT SAVED"))).toBe(true);
    });
  });

  describe("discharge instructions verification", () => {
    it("adds alert for new patient medications", () => {
      const result = applyVerification("Instructions generated.", [
        {
          name: "generate_discharge_instructions",
          args: { patient_id: "1", encounter_id: "enc-101" },
          result: JSON.stringify({
            new_medications: [
              {
                name: "Metoprolol",
                dose: "25mg",
                frequency: "twice daily",
                reason: "Heart rate control for atrial fibrillation",
              },
            ],
            modified_medications: [],
            discontinued_medications: [],
          }),
        },
      ]);
      expect(result.safetyAlerts.some((a) => a.includes("NEW MEDICATION FOR PATIENT"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("Metoprolol"))).toBe(true);
    });

    it("adds alert for changed medication doses", () => {
      const result = applyVerification("Instructions generated.", [
        {
          name: "generate_discharge_instructions",
          args: { patient_id: "1", encounter_id: "enc-101" },
          result: JSON.stringify({
            new_medications: [],
            modified_medications: [
              {
                name: "Lisinopril",
                previous_dose: "10mg",
                new_dose: "20mg",
                reason: "Blood pressure not at target",
              },
            ],
            discontinued_medications: [],
          }),
        },
      ]);
      expect(result.safetyAlerts.some((a) => a.includes("MEDICATION DOSE CHANGED"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("Lisinopril"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("10mg"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("20mg"))).toBe(true);
    });

    it("adds alert for stopped medications", () => {
      const result = applyVerification("Instructions generated.", [
        {
          name: "generate_discharge_instructions",
          args: { patient_id: "4", encounter_id: "enc-401" },
          result: JSON.stringify({
            new_medications: [],
            modified_medications: [],
            discontinued_medications: [
              {
                name: "Metformin",
                reason: "Renal function decline",
              },
            ],
          }),
        },
      ]);
      expect(result.safetyAlerts.some((a) => a.includes("MEDICATION STOPPED"))).toBe(true);
      expect(result.safetyAlerts.some((a) => a.includes("Metformin"))).toBe(true);
    });

    it("no alerts when only continued medications", () => {
      const result = applyVerification("Instructions generated.", [
        {
          name: "generate_discharge_instructions",
          args: { patient_id: "1", encounter_id: "enc-101" },
          result: JSON.stringify({
            new_medications: [],
            modified_medications: [],
            discontinued_medications: [],
          }),
        },
      ]);
      expect(result.safetyAlerts).toHaveLength(0);
    });

    it("cites DailyMed source when discharge instructions tool used", () => {
      const result = applyVerification("Instructions generated.", [
        {
          name: "generate_discharge_instructions",
          args: { patient_id: "1", encounter_id: "enc-101" },
          result: JSON.stringify({
            new_medications: [],
            modified_medications: [],
            discontinued_medications: [],
          }),
        },
      ]);
      expect(result.response).toContain("DailyMed (NLM/NIH)");
      expect(result.response).toContain("OpenEMR Patient Records");
    });
  });

  describe("prescriptive language detection (ADV-002)", () => {
    it("detects 'I prescribe'", () => {
      expect(detectPrescriptiveLanguage("I prescribe amoxicillin 500mg")).toBe(true);
    });

    it("detects 'I have prescribed'", () => {
      expect(detectPrescriptiveLanguage("I have prescribed warfarin 5mg")).toBe(true);
    });

    it("detects 'you should take'", () => {
      expect(detectPrescriptiveLanguage("you should take ibuprofen for pain")).toBe(true);
    });

    it("detects 'I recommend you take'", () => {
      expect(detectPrescriptiveLanguage("I recommend you take aspirin daily")).toBe(true);
    });

    it("detects 'start taking'", () => {
      expect(detectPrescriptiveLanguage("You can start taking metformin tomorrow")).toBe(true);
    });

    it("detects 'I have ordered'", () => {
      expect(detectPrescriptiveLanguage("I have ordered a blood panel for you")).toBe(true);
    });

    it("detects 'dose has been increased'", () => {
      expect(detectPrescriptiveLanguage("The dose has been increased to 20mg")).toBe(true);
    });

    it("detects 'has been finalized and saved to chart'", () => {
      expect(detectPrescriptiveLanguage("The document has been finalized and saved to chart")).toBe(true);
    });

    it("does NOT flag 'I cannot prescribe'", () => {
      expect(detectPrescriptiveLanguage("I cannot prescribe medications")).toBe(false);
    });

    it("does NOT flag normal clinical data responses", () => {
      expect(detectPrescriptiveLanguage("Patient 1 is currently taking warfarin 5mg daily")).toBe(false);
    });

    it("does NOT flag refusal language", () => {
      expect(detectPrescriptiveLanguage("I'm unable to recommend treatments or prescribe medications. Please consult your healthcare provider.")).toBe(false);
    });

    it("adds SCOPE WARNING alert when prescriptive language detected", () => {
      const result = applyVerification("I prescribe amoxicillin 500mg three times daily.", []);
      expect(result.safetyAlerts.some((a) => a.includes("SCOPE WARNING"))).toBe(true);
    });

    it("does NOT add SCOPE WARNING for clean responses", () => {
      const result = applyVerification("Patient 1 is on warfarin 5mg daily.", []);
      expect(result.safetyAlerts.some((a) => a.includes("SCOPE WARNING"))).toBe(false);
    });
  });
});
