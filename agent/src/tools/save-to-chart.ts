import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";
import { getErrorMessage } from "../utils/errors";

export function saveToChart(dataSource: DataSource) {
  return tool(
    async ({ patient_id, encounter_id, document_type, content }) => {
      try {
        const document = await dataSource.saveDocument({
          patient_id,
          encounter_id,
          type: document_type,
          status: "draft",
          content,
          created_by: "ai-agent",
        });

        return JSON.stringify({
          success: true,
          document_id: document.document_id,
          status: "draft",
          message: `Draft ${document_type.replace("_", " ")} saved. Document ID: ${document.document_id}. Clinician review and approval required before finalizing.`,
        });
      } catch (err) {
        return JSON.stringify({
          error: `Save to chart failed: ${getErrorMessage(err)}`,
        });
      }
    },
    {
      name: "save_to_chart",
      description:
        "Save a drafted document (discharge summary, medication reconciliation, or discharge instructions) to the patient's chart as a draft. The document will require clinician review and approval before being finalized. Use this after drafting a discharge summary, medication reconciliation, or discharge instructions when the user wants to save it.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID"),
        encounter_id: z.string().describe("The encounter/admission ID"),
        document_type: z
          .enum(["discharge_summary", "medication_reconciliation", "discharge_instructions"])
          .describe("Type of document to save"),
        content: z
          .string()
          .describe("The full text content of the document to save"),
      }),
    }
  );
}
