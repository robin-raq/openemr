import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";
import { getErrorMessage } from "../utils/errors";

export function draftDischargeSummary(dataSource: DataSource) {
  return tool(
    async ({ patient_id, encounter_id }) => {
      try {
        const [patient, encounters, admissionMeds, currentMeds, labs] =
          await Promise.all([
            dataSource.getPatient(patient_id),
            dataSource.getEncounters(patient_id),
            dataSource.getAdmissionMedications(encounter_id),
            dataSource.getMedications(patient_id),
            dataSource.getLabResults(patient_id),
          ]);

        const encounter = encounters.find(
          (e) => e.encounter_id === encounter_id
        );
        if (!encounter) {
          return JSON.stringify({
            error: `Encounter not found: ${encounter_id}`,
          });
        }

        const dischargeMeds = admissionMeds.filter(
          (m) => m.status !== "discontinued"
        );
        const modifiedMeds = admissionMeds.filter(
          (m) => m.status === "modified"
        );
        const newMeds = admissionMeds.filter((m) => m.status === "new");
        const discontinuedMeds = admissionMeds.filter(
          (m) => m.status === "discontinued"
        );
        const criticalLabs = labs.filter((l) => l.flag === "critical");
        const abnormalLabs = labs.filter((l) => l.flag === "abnormal");

        return JSON.stringify({
          type: "discharge_summary_draft",
          patient: {
            name: patient.name,
            patient_id: patient.patient_id,
            dob: patient.dob,
            gender: patient.gender,
            allergies: patient.allergies,
          },
          encounter: {
            encounter_id: encounter.encounter_id,
            admission_date: encounter.admission_date,
            discharge_date: encounter.discharge_date ?? "Pending",
            attending_provider: encounter.attending_provider,
            admission_reason: encounter.admission_reason,
            diagnoses: encounter.diagnoses,
            procedures: encounter.procedures,
            hospital_course: encounter.hospital_course_notes,
          },
          medication_reconciliation: {
            discharge_medications: dischargeMeds,
            modified: modifiedMeds,
            new_medications: newMeds,
            discontinued: discontinuedMeds,
          },
          labs_at_discharge: {
            critical: criticalLabs,
            abnormal: abnormalLabs,
            // Normal labs omitted to reduce payload — only count provided
            normal_count: labs.filter((l) => !l.flag || l.flag === "normal").length,
            total_count: labs.length,
          },
          conditions: patient.conditions,
          vitals: patient.vitals,
          safety_flags: {
            has_critical_labs: criticalLabs.length > 0,
            has_medication_changes:
              modifiedMeds.length > 0 ||
              newMeds.length > 0 ||
              discontinuedMeds.length > 0,
            allergy_count: patient.allergies.length,
          },
        });
      } catch (err) {
        return JSON.stringify({
          error: `Discharge summary draft failed: ${getErrorMessage(err)}`,
        });
      }
    },
    {
      name: "draft_discharge_summary",
      description:
        "Gather all data needed to draft a discharge summary for a specific encounter: patient demographics, encounter details, hospital course, medication reconciliation, lab results, and safety flags. Use this when the user asks to prepare or draft a discharge summary. The agent should then compose a structured discharge summary from this data.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID"),
        encounter_id: z
          .string()
          .describe(
            "The encounter/admission ID to generate a discharge summary for"
          ),
      }),
    }
  );
}
