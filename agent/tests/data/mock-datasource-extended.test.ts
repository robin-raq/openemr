import { describe, it, expect, beforeEach } from "vitest";
import { MockDataSource } from "../../src/data/mock-datasource";
import type { DataSource } from "../../src/data/datasource";

describe("MockDataSource — encounters", () => {
  let ds: DataSource;

  beforeEach(() => {
    ds = new MockDataSource();
  });

  it("returns 1 discharged encounter for patient 1", async () => {
    const encounters = await ds.getEncounters("1");
    expect(encounters).toHaveLength(1);
    expect(encounters[0].status).toBe("discharged");
    expect(encounters[0].encounter_id).toBe("enc-101");
  });

  it("returns 1 active encounter for patient 4", async () => {
    const encounters = await ds.getEncounters("4");
    expect(encounters).toHaveLength(1);
    expect(encounters[0].status).toBe("active");
    expect(encounters[0].encounter_id).toBe("enc-401");
  });

  it("returns empty array for patient 2 (no encounters)", async () => {
    const encounters = await ds.getEncounters("2");
    expect(encounters).toEqual([]);
  });

  it("throws for unknown patient ID", async () => {
    await expect(ds.getEncounters("99999")).rejects.toThrow("Patient not found");
  });

  it("each encounter has required fields", async () => {
    const encounters = await ds.getEncounters("1");
    const enc = encounters[0];
    expect(enc).toHaveProperty("encounter_id");
    expect(enc).toHaveProperty("patient_id");
    expect(enc).toHaveProperty("type");
    expect(enc).toHaveProperty("admission_date");
    expect(enc).toHaveProperty("attending_provider");
    expect(enc).toHaveProperty("admission_reason");
    expect(enc).toHaveProperty("diagnoses");
    expect(enc).toHaveProperty("procedures");
    expect(enc).toHaveProperty("hospital_course_notes");
    expect(enc.diagnoses.length).toBeGreaterThan(0);
    expect(enc.hospital_course_notes.length).toBeGreaterThan(0);
  });
});

describe("MockDataSource — admission medications", () => {
  let ds: DataSource;

  beforeEach(() => {
    ds = new MockDataSource();
  });

  it("returns admission medications for encounter enc-101", async () => {
    const meds = await ds.getAdmissionMedications("enc-101");
    expect(meds.length).toBeGreaterThanOrEqual(3);
  });

  it("returns admission medications for encounter enc-401", async () => {
    const meds = await ds.getAdmissionMedications("enc-401");
    expect(meds.length).toBeGreaterThanOrEqual(5);
  });

  it("returns empty array for unknown encounter ID", async () => {
    const meds = await ds.getAdmissionMedications("enc-999");
    expect(meds).toEqual([]);
  });

  it("each admission med has name, dose, frequency, status", async () => {
    const meds = await ds.getAdmissionMedications("enc-101");
    for (const med of meds) {
      expect(med).toHaveProperty("name");
      expect(med).toHaveProperty("dose");
      expect(med).toHaveProperty("frequency");
      expect(med).toHaveProperty("status");
      expect(["continued", "modified", "discontinued", "new"]).toContain(med.status);
    }
  });

  it("modified meds include original_dose and modification_reason", async () => {
    const meds = await ds.getAdmissionMedications("enc-101");
    const modified = meds.filter((m) => m.status === "modified");
    expect(modified.length).toBeGreaterThan(0);
    for (const med of modified) {
      expect(med.modification_reason).toBeTruthy();
      expect(med.original_dose).toBeTruthy();
    }
  });

  it("new meds include modification_reason", async () => {
    const meds = await ds.getAdmissionMedications("enc-101");
    const newMeds = meds.filter((m) => m.status === "new");
    expect(newMeds.length).toBeGreaterThan(0);
    for (const med of newMeds) {
      expect(med.modification_reason).toBeTruthy();
    }
  });
});

describe("MockDataSource — document CRUD", () => {
  let ds: DataSource;

  beforeEach(() => {
    ds = new MockDataSource();
  });

  it("saveDocument creates a document with auto-generated ID", async () => {
    const doc = await ds.saveDocument({
      patient_id: "1",
      encounter_id: "enc-101",
      type: "discharge_summary",
      status: "draft",
      content: "Test discharge summary",
      created_by: "ai-agent",
    });
    expect(doc.document_id).toBeTruthy();
    expect(doc.document_id).toMatch(/^doc-/);
  });

  it("saveDocument sets created_at timestamp", async () => {
    const before = new Date().toISOString();
    const doc = await ds.saveDocument({
      patient_id: "1",
      encounter_id: "enc-101",
      type: "discharge_summary",
      status: "draft",
      content: "Test",
      created_by: "ai-agent",
    });
    expect(doc.created_at).toBeTruthy();
    expect(doc.created_at >= before).toBe(true);
  });

  it("getDocument returns saved document by ID", async () => {
    const saved = await ds.saveDocument({
      patient_id: "4",
      encounter_id: "enc-401",
      type: "medication_reconciliation",
      status: "draft",
      content: "Med rec content",
      created_by: "ai-agent",
    });
    const retrieved = await ds.getDocument(saved.document_id);
    expect(retrieved.document_id).toBe(saved.document_id);
    expect(retrieved.content).toBe("Med rec content");
    expect(retrieved.type).toBe("medication_reconciliation");
  });

  it("getDocument throws for unknown document ID", async () => {
    await expect(ds.getDocument("doc-nonexistent")).rejects.toThrow("Document not found");
  });

  it("updateDocument updates content and sets updated_at", async () => {
    const saved = await ds.saveDocument({
      patient_id: "1",
      encounter_id: "enc-101",
      type: "discharge_summary",
      status: "draft",
      content: "Original",
      created_by: "ai-agent",
    });
    const updated = await ds.updateDocument(saved.document_id, {
      content: "Updated content",
    });
    expect(updated.content).toBe("Updated content");
    expect(updated.updated_at).toBeTruthy();
  });

  it("updateDocument changes status from draft to final", async () => {
    const saved = await ds.saveDocument({
      patient_id: "1",
      encounter_id: "enc-101",
      type: "discharge_summary",
      status: "draft",
      content: "Summary",
      created_by: "ai-agent",
    });
    const updated = await ds.updateDocument(saved.document_id, {
      status: "final",
    });
    expect(updated.status).toBe("final");
  });

  it("updateDocument throws for unknown document ID", async () => {
    await expect(
      ds.updateDocument("doc-nonexistent", { content: "x" })
    ).rejects.toThrow("Document not found");
  });

  it("deleteDocument removes the document", async () => {
    const saved = await ds.saveDocument({
      patient_id: "1",
      encounter_id: "enc-101",
      type: "discharge_summary",
      status: "draft",
      content: "To delete",
      created_by: "ai-agent",
    });
    const result = await ds.deleteDocument(saved.document_id);
    expect(result.deleted).toBe(true);
    await expect(ds.getDocument(saved.document_id)).rejects.toThrow("Document not found");
  });

  it("deleteDocument throws for unknown document ID", async () => {
    await expect(ds.deleteDocument("doc-nonexistent")).rejects.toThrow("Document not found");
  });

  it("multiple documents get unique IDs", async () => {
    const doc1 = await ds.saveDocument({
      patient_id: "1",
      encounter_id: "enc-101",
      type: "discharge_summary",
      status: "draft",
      content: "Doc 1",
      created_by: "ai-agent",
    });
    const doc2 = await ds.saveDocument({
      patient_id: "4",
      encounter_id: "enc-401",
      type: "medication_reconciliation",
      status: "draft",
      content: "Doc 2",
      created_by: "ai-agent",
    });
    expect(doc1.document_id).not.toBe(doc2.document_id);
  });
});

describe("MockDataSource — appointments", () => {
  let ds: DataSource;

  beforeEach(() => {
    ds = new MockDataSource();
  });

  it("returns scheduled appointments for patient 1", async () => {
    const appointments = await ds.getAppointments("1");
    expect(appointments.length).toBeGreaterThan(0);
  });

  it("returns empty array for patient 2 (no appointments)", async () => {
    const appointments = await ds.getAppointments("2");
    expect(appointments).toEqual([]);
  });

  it("returns multiple appointments for patient 4", async () => {
    const appointments = await ds.getAppointments("4");
    expect(appointments.length).toBeGreaterThanOrEqual(4);
  });

  it("throws for unknown patient ID", async () => {
    await expect(ds.getAppointments("99999")).rejects.toThrow("Patient not found");
  });

  it("each appointment has required fields", async () => {
    const appointments = await ds.getAppointments("1");
    for (const appt of appointments) {
      expect(appt).toHaveProperty("appointment_id");
      expect(appt).toHaveProperty("patient_id");
      expect(appt).toHaveProperty("provider");
      expect(appt).toHaveProperty("specialty");
      expect(appt).toHaveProperty("date");
      expect(appt).toHaveProperty("time");
      expect(appt).toHaveProperty("location");
      expect(appt).toHaveProperty("reason");
      expect(appt).toHaveProperty("status");
    }
  });
});
