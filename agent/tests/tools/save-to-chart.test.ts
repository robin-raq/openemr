import { describe, it, expect, beforeEach } from "vitest";
import { MockDataSource } from "../../src/data/mock-datasource";
import { saveToChart } from "../../src/tools/save-to-chart";

describe("save_to_chart", () => {
  let toolFn: ReturnType<typeof saveToChart>;

  beforeEach(() => {
    const ds = new MockDataSource();
    toolFn = saveToChart(ds);
  });

  it("saves a discharge summary draft and returns document_id", async () => {
    const result = JSON.parse(
      await toolFn.invoke({
        patient_id: "1",
        encounter_id: "enc-101",
        document_type: "discharge_summary",
        content: "Patient John Demo discharge summary...",
      })
    );
    expect(result.success).toBe(true);
    expect(result.document_id).toMatch(/^doc-/);
  });

  it("saves with status=draft (never final)", async () => {
    const result = JSON.parse(
      await toolFn.invoke({
        patient_id: "1",
        encounter_id: "enc-101",
        document_type: "discharge_summary",
        content: "Draft content",
      })
    );
    expect(result.status).toBe("draft");
  });

  it("returns success message with document_id", async () => {
    const result = JSON.parse(
      await toolFn.invoke({
        patient_id: "4",
        encounter_id: "enc-401",
        document_type: "discharge_summary",
        content: "Summary for Sara Complex",
      })
    );
    expect(result.message).toContain(result.document_id);
    expect(result.message).toContain("review");
  });

  it("saves medication_reconciliation document type", async () => {
    const result = JSON.parse(
      await toolFn.invoke({
        patient_id: "4",
        encounter_id: "enc-401",
        document_type: "medication_reconciliation",
        content: "Med rec report...",
      })
    );
    expect(result.success).toBe(true);
    expect(result.document_id).toBeTruthy();
  });

  it("returns error on datasource failure", async () => {
    // Create a tool with a broken datasource
    const brokenDs = new MockDataSource();
    brokenDs.saveDocument = async () => {
      throw new Error("Database connection failed");
    };
    const brokenTool = saveToChart(brokenDs);
    const result = JSON.parse(
      await brokenTool.invoke({
        patient_id: "1",
        encounter_id: "enc-101",
        document_type: "discharge_summary",
        content: "Test",
      })
    );
    expect(result.error).toContain("Database connection failed");
  });
});
