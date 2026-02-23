import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";

export function getMedications(dataSource: DataSource) {
  return tool(
    async ({ patient_id }) => {
      try {
        const medications = await dataSource.getMedications(patient_id);
        if (medications.length === 0) {
          return JSON.stringify({
            medications: [],
            note: "No active medications",
          });
        }
        return JSON.stringify({ medications });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return JSON.stringify({ error: `Patient not found: ${message}` });
      }
    },
    {
      name: "get_medications",
      description:
        "Retrieve the current medication list for a patient including drug names, dosages, frequency, and prescribers. Use this when the user asks about what medications a patient is taking.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID to look up medications for"),
      }),
    }
  );
}
