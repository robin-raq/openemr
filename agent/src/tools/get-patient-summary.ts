import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";
import { getErrorMessage } from "../utils/errors";

export function getPatientSummary(dataSource: DataSource) {
  return tool(
    async ({ patient_id }) => {
      try {
        const patient = await dataSource.getPatient(patient_id);
        return JSON.stringify(patient);
      } catch (err) {
        const message = getErrorMessage(err);
        return JSON.stringify({ error: `Patient not found: ${message}` });
      }
    },
    {
      name: "get_patient_summary",
      description:
        "Retrieve a patient's demographics, conditions, medications, allergies, and vital signs. Use this when the user asks about a patient's overall health status, medical history, or vitals.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID to look up"),
      }),
    }
  );
}
