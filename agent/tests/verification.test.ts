import { describe, it, expect } from "vitest";
import { applyVerification } from "../src/verification/verification";

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
    expect(result.response).toContain("⚠️ SAFETY ALERT");
    expect(result.response).toContain("bleeding");
    expect(result.safetyAlerts).toHaveLength(1);
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
  });
});
