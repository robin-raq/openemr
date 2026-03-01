import { describe, it, expect, beforeEach, vi } from "vitest";
import { CachedDataSource } from "../../src/data/cached-datasource";
import type { DataSource, PatientData, MedicationData, LabResult, EncounterData, AdmissionMedication, Appointment, DocumentRecord } from "../../src/data/datasource";

/**
 * Spy-able mock DataSource that tracks call counts.
 * Each method returns predictable data so we can verify caching behavior.
 */
function createSpyDataSource(): DataSource & { callCounts: Record<string, number> } {
  const callCounts: Record<string, number> = {};

  function track(method: string) {
    callCounts[method] = (callCounts[method] || 0) + 1;
  }

  const mockPatient: PatientData = {
    patient_id: "1",
    name: "John Demo",
    dob: "1965-03-15",
    gender: "male",
    conditions: ["Hypertension"],
    medications: [{ name: "Lisinopril", dose: "10mg", frequency: "daily" }],
    allergies: ["Penicillin"],
  };

  const mockMedications: MedicationData[] = [
    { name: "Lisinopril", dose: "10mg", frequency: "daily", start_date: "2024-01-01", prescriber: "Dr. Smith", status: "active" },
  ];

  const mockLabs: LabResult[] = [
    { test_name: "CBC", value: 12.5, unit: "g/dL", reference_range: "12-16", date: "2024-01-15", flag: "normal" },
  ];

  const mockEncounters: EncounterData[] = [
    {
      encounter_id: "enc-101",
      patient_id: "1",
      type: "inpatient",
      admission_date: "2024-01-10",
      discharge_date: "2024-01-15",
      status: "discharged",
      attending_provider: "Dr. Smith",
      admission_reason: "Chest pain",
      diagnoses: ["Angina"],
      procedures: ["EKG"],
      hospital_course_notes: ["Stable course"],
    },
  ];

  const mockAdmissionMeds: AdmissionMedication[] = [
    { name: "Aspirin", dose: "81mg", frequency: "daily", status: "continued" },
  ];

  const mockAppointments: Appointment[] = [
    {
      appointment_id: "appt-1",
      patient_id: "1",
      provider: "Dr. Smith",
      specialty: "Cardiology",
      date: "2024-02-01",
      time: "10:00",
      location: "Clinic A",
      reason: "Follow-up",
      status: "scheduled",
    },
  ];

  const mockDocument: DocumentRecord = {
    document_id: "doc-1",
    patient_id: "1",
    encounter_id: "enc-101",
    type: "discharge_summary",
    status: "draft",
    content: "Summary content",
    created_at: "2024-01-15T10:00:00Z",
    created_by: "ai-agent",
  };

  return {
    callCounts,
    async getPatient(id: string): Promise<PatientData> {
      track("getPatient");
      return { ...mockPatient, patient_id: id };
    },
    async getMedications(patientId: string): Promise<MedicationData[]> {
      track("getMedications");
      return mockMedications;
    },
    async getLabResults(patientId: string): Promise<LabResult[]> {
      track("getLabResults");
      return mockLabs;
    },
    async getEncounters(patientId: string): Promise<EncounterData[]> {
      track("getEncounters");
      return mockEncounters;
    },
    async getAdmissionMedications(encounterId: string): Promise<AdmissionMedication[]> {
      track("getAdmissionMedications");
      return mockAdmissionMeds;
    },
    async getAppointments(patientId: string): Promise<Appointment[]> {
      track("getAppointments");
      return mockAppointments;
    },
    async saveDocument(doc: Omit<DocumentRecord, "document_id" | "created_at">): Promise<DocumentRecord> {
      track("saveDocument");
      return { ...mockDocument, ...doc, document_id: `doc-${Date.now()}`, created_at: new Date().toISOString() };
    },
    async getDocument(documentId: string): Promise<DocumentRecord> {
      track("getDocument");
      return { ...mockDocument, document_id: documentId };
    },
    async updateDocument(documentId: string, updates: Partial<Pick<DocumentRecord, "content" | "status">>): Promise<DocumentRecord> {
      track("updateDocument");
      return { ...mockDocument, document_id: documentId, ...updates };
    },
    async deleteDocument(documentId: string): Promise<{ deleted: boolean }> {
      track("deleteDocument");
      return { deleted: true };
    },
  };
}

describe("CachedDataSource", () => {
  let inner: ReturnType<typeof createSpyDataSource>;
  let cached: CachedDataSource;

  beforeEach(() => {
    inner = createSpyDataSource();
    cached = new CachedDataSource(inner);
  });

  describe("read method caching", () => {
    it("caches getPatient — second call with same args returns cached result", async () => {
      const r1 = await cached.getPatient("1");
      const r2 = await cached.getPatient("1");
      expect(r1).toEqual(r2);
      expect(inner.callCounts["getPatient"]).toBe(1);
    });

    it("does not cache across different patient IDs", async () => {
      await cached.getPatient("1");
      await cached.getPatient("2");
      expect(inner.callCounts["getPatient"]).toBe(2);
    });

    it("caches getMedications — second call returns cached result", async () => {
      await cached.getMedications("1");
      await cached.getMedications("1");
      expect(inner.callCounts["getMedications"]).toBe(1);
    });

    it("caches getLabResults — second call returns cached result", async () => {
      await cached.getLabResults("1");
      await cached.getLabResults("1");
      expect(inner.callCounts["getLabResults"]).toBe(1);
    });

    it("caches getEncounters — second call returns cached result", async () => {
      await cached.getEncounters("1");
      await cached.getEncounters("1");
      expect(inner.callCounts["getEncounters"]).toBe(1);
    });

    it("caches getAdmissionMedications — second call returns cached result", async () => {
      await cached.getAdmissionMedications("enc-101");
      await cached.getAdmissionMedications("enc-101");
      expect(inner.callCounts["getAdmissionMedications"]).toBe(1);
    });

    it("caches getAppointments — second call returns cached result", async () => {
      await cached.getAppointments("1");
      await cached.getAppointments("1");
      expect(inner.callCounts["getAppointments"]).toBe(1);
    });

    it("caches getDocument — second call returns cached result", async () => {
      await cached.getDocument("doc-1");
      await cached.getDocument("doc-1");
      expect(inner.callCounts["getDocument"]).toBe(1);
    });
  });

  describe("write methods are NOT cached", () => {
    it("saveDocument always delegates to inner", async () => {
      const doc = {
        patient_id: "1",
        encounter_id: "enc-101",
        type: "discharge_summary" as const,
        status: "draft" as const,
        content: "Test",
        created_by: "ai-agent",
      };
      await cached.saveDocument(doc);
      await cached.saveDocument(doc);
      expect(inner.callCounts["saveDocument"]).toBe(2);
    });

    it("updateDocument always delegates to inner", async () => {
      await cached.updateDocument("doc-1", { content: "v1" });
      await cached.updateDocument("doc-1", { content: "v2" });
      expect(inner.callCounts["updateDocument"]).toBe(2);
    });

    it("deleteDocument always delegates to inner", async () => {
      await cached.deleteDocument("doc-1");
      await cached.deleteDocument("doc-1");
      expect(inner.callCounts["deleteDocument"]).toBe(2);
    });
  });

  describe("error passthrough", () => {
    it("propagates errors from inner datasource", async () => {
      const failingDs = createSpyDataSource();
      const originalGetPatient = failingDs.getPatient;
      failingDs.getPatient = async () => {
        throw new Error("Patient not found: 99999");
      };
      const failCached = new CachedDataSource(failingDs);
      await expect(failCached.getPatient("99999")).rejects.toThrow("Patient not found");
    });

    it("does not cache errors — retries on next call", async () => {
      let shouldFail = true;
      const flakyDs = createSpyDataSource();
      const originalGetPatient = flakyDs.getPatient;
      flakyDs.getPatient = async (id: string) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("Temporary failure");
        }
        return originalGetPatient(id);
      };
      const flakyCached = new CachedDataSource(flakyDs);

      // First call fails
      await expect(flakyCached.getPatient("1")).rejects.toThrow("Temporary failure");
      // Second call succeeds (error was not cached)
      const result = await flakyCached.getPatient("1");
      expect(result.patient_id).toBe("1");
    });
  });

  describe("cache isolation", () => {
    it("different CachedDataSource instances have separate caches", async () => {
      const cached2 = new CachedDataSource(inner);
      await cached.getPatient("1");
      await cached2.getPatient("1");
      // Both should have called the inner datasource
      expect(inner.callCounts["getPatient"]).toBe(2);
    });
  });

  describe("cache key differentiation", () => {
    it("getPatient and getMedications for same ID use separate cache keys", async () => {
      await cached.getPatient("1");
      await cached.getMedications("1");
      expect(inner.callCounts["getPatient"]).toBe(1);
      expect(inner.callCounts["getMedications"]).toBe(1);
    });
  });
});
