import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";
import { getErrorMessage } from "../utils/errors";

// Cross-reactivity map: allergen -> medications that may cause reactions
const CROSS_REACTIVITY: Record<string, string[]> = {
  penicillin: ["amoxicillin", "ampicillin", "piperacillin", "nafcillin", "oxacillin", "dicloxacillin"],
  sulfa: ["sulfamethoxazole", "sulfasalazine", "sulfadiazine", "dapsone"],
  codeine: ["morphine", "hydrocodone", "oxycodone", "tramadol"],
  aspirin: ["ibuprofen", "naproxen", "ketorolac", "diclofenac", "celecoxib"],
  cephalosporin: ["cefazolin", "cephalexin", "ceftriaxone", "cefepime"],
};

function checkCrossReactivity(
  allergies: string[],
  proposedMedication: string
): Array<{ allergen: string; proposed_medication: string; reason: string }> {
  const normalizedMed = proposedMedication.toLowerCase().trim();
  const conflicts: Array<{ allergen: string; proposed_medication: string; reason: string }> = [];

  for (const allergy of allergies) {
    const normalizedAllergy = allergy.toLowerCase().trim();

    // Direct match
    if (normalizedAllergy === normalizedMed) {
      conflicts.push({
        allergen: allergy,
        proposed_medication: proposedMedication,
        reason: `Patient has a documented ${allergy} allergy`,
      });
      continue;
    }

    // Cross-reactivity check
    const crossReactive = CROSS_REACTIVITY[normalizedAllergy];
    if (crossReactive && crossReactive.some((drug) => drug === normalizedMed)) {
      conflicts.push({
        allergen: allergy,
        proposed_medication: proposedMedication,
        reason: `${proposedMedication} has cross-reactivity with ${allergy}`,
      });
    }
  }

  return conflicts;
}

export function allergyCheck(dataSource: DataSource) {
  return tool(
    async ({ patient_id, proposed_medication }) => {
      try {
        const patient = await dataSource.getPatient(patient_id);

        if (patient.allergies.length === 0) {
          return JSON.stringify({
            safe: true,
            patient_name: patient.name,
            allergies: [],
            conflicts: [],
            proposed_medication,
          });
        }

        const conflicts = checkCrossReactivity(patient.allergies, proposed_medication);

        return JSON.stringify({
          safe: conflicts.length === 0,
          patient_name: patient.name,
          allergies: patient.allergies,
          conflicts,
          proposed_medication,
        });
      } catch (err) {
        const message = getErrorMessage(err);
        return JSON.stringify({ error: `Allergy check failed: ${message}` });
      }
    },
    {
      name: "allergy_check",
      description:
        "Check if a proposed medication conflicts with a patient's known allergies, including cross-reactivity. Use this before recommending or discussing any new medication for a patient.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID to check allergies for"),
        proposed_medication: z.string().describe("The medication name to check against patient allergies"),
      }),
    }
  );
}
