import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";
import { getErrorMessage } from "../utils/errors";

export function getEncounterData(dataSource: DataSource) {
  return tool(
    async ({ patient_id }) => {
      try {
        const encounters = await dataSource.getEncounters(patient_id);
        if (encounters.length === 0) {
          return JSON.stringify({
            encounters: [],
            note: "No encounter records found for this patient",
          });
        }
        return JSON.stringify({
          patient_id,
          encounters,
          total_count: encounters.length,
          active_count: encounters.filter((e) => e.status === "active").length,
        });
      } catch (err) {
        return JSON.stringify({
          error: `Encounter data retrieval failed: ${getErrorMessage(err)}`,
        });
      }
    },
    {
      name: "get_encounter_data",
      description:
        "Retrieve encounter/admission data for a patient including admission reason, diagnoses, procedures, and hospital course notes. Use this when the user asks about a patient's hospital stay, admission, encounter history, or when preparing a discharge summary.",
      schema: z.object({
        patient_id: z
          .string()
          .describe("The patient ID to look up encounters for"),
      }),
    }
  );
}
