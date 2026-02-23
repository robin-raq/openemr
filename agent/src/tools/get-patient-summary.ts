import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";

export function getPatientSummary(dataSource: DataSource) {
  return tool(
    async ({ patient_id }) => {
      try {
        const patient = await dataSource.getPatient(patient_id);
        return JSON.stringify(patient);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return JSON.stringify({ error: `Patient not found: ${message}` });
      }
    },
    {
      name: "get_patient_summary",
      description:
        "Retrieve a patient's demographics, conditions, medications, and allergies. Use this when the user asks about a patient's overall health status or medical history.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID to look up"),
      }),
    }
  );
}
