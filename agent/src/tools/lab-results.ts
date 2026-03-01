import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";
import { getErrorMessage } from "../utils/errors";

export function getLabResults(dataSource: DataSource) {
  return tool(
    async ({ patient_id }) => {
      try {
        const results = await dataSource.getLabResults(patient_id);

        const abnormalCount = results.filter((r) => r.flag === "abnormal").length;
        const criticalCount = results.filter((r) => r.flag === "critical").length;

        return JSON.stringify({
          patient_id,
          results,
          total_count: results.length,
          abnormal_count: abnormalCount,
          critical_count: criticalCount,
        });
      } catch (err) {
        const message = getErrorMessage(err);
        return JSON.stringify({ error: `Lab results retrieval failed: ${message}` });
      }
    },
    {
      name: "get_lab_results",
      description:
        "Retrieve recent lab results for a patient, including flagged abnormal and critical values. Use this when the user asks about lab work, blood tests, or specific lab values like INR, HbA1c, creatinine, etc.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID to get lab results for"),
      }),
    }
  );
}
