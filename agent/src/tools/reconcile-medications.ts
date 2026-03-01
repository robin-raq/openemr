import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";
import { getErrorMessage } from "../utils/errors";

export function reconcileMedications(dataSource: DataSource) {
  return tool(
    async ({ patient_id, encounter_id }) => {
      try {
        const [currentMeds, admissionMeds, patient] = await Promise.all([
          dataSource.getMedications(patient_id),
          dataSource.getAdmissionMedications(encounter_id),
          dataSource.getPatient(patient_id),
        ]);

        const continued = admissionMeds.filter((m) => m.status === "continued");
        const modified = admissionMeds.filter((m) => m.status === "modified");
        const discontinued = admissionMeds.filter(
          (m) => m.status === "discontinued"
        );
        const newMeds = admissionMeds.filter((m) => m.status === "new");

        const changes: string[] = [];
        for (const med of modified) {
          changes.push(
            `${med.name}: ${med.original_dose} ${med.original_frequency} → ${med.dose} ${med.frequency} (${med.modification_reason})`
          );
        }
        for (const med of discontinued) {
          changes.push(
            `${med.name}: DISCONTINUED (${med.modification_reason})`
          );
        }
        for (const med of newMeds) {
          changes.push(
            `${med.name} ${med.dose} ${med.frequency}: NEW (${med.modification_reason})`
          );
        }

        return JSON.stringify({
          patient_id,
          patient_name: patient.name,
          encounter_id,
          reconciliation: {
            continued: continued.map((m) => ({
              name: m.name,
              dose: m.dose,
              frequency: m.frequency,
            })),
            modified,
            discontinued,
            new_medications: newMeds,
          },
          change_summary: changes,
          total_discharge_medications: admissionMeds.filter(
            (m) => m.status !== "discontinued"
          ).length,
          has_changes:
            modified.length > 0 ||
            discontinued.length > 0 ||
            newMeds.length > 0,
          allergies: patient.allergies,
        });
      } catch (err) {
        return JSON.stringify({
          error: `Medication reconciliation failed: ${getErrorMessage(err)}`,
        });
      }
    },
    {
      name: "reconcile_medications",
      description:
        "Compare a patient's pre-admission medications with their current/discharge medications for a specific encounter. Shows which medications were continued, modified, discontinued, or newly added. Use this when preparing a patient for discharge or reviewing medication changes during a hospital stay.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID"),
        encounter_id: z
          .string()
          .describe(
            "The encounter/admission ID to reconcile medications for"
          ),
      }),
    }
  );
}
