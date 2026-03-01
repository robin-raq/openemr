import * as fs from "fs";
import * as path from "path";
import type {
  DataSource,
  PatientData,
  MedicationData,
  LabResult,
  EncounterData,
  AdmissionMedication,
  Appointment,
  DocumentRecord,
} from "./datasource";

interface MockData {
  patients: Record<string, PatientData>;
  medications: Record<string, MedicationData[]>;
  lab_results: Record<string, LabResult[]>;
  encounters: Record<string, EncounterData[]>;
  admission_medications: Record<string, AdmissionMedication[]>;
  appointments: Record<string, Appointment[]>;
  documents: Record<string, DocumentRecord>;
}

export class MockDataSource implements DataSource {
  private data: MockData;
  private nextDocId = 1;

  constructor() {
    const dataPath = path.join(__dirname, "mock-data.json");
    const raw = fs.readFileSync(dataPath, "utf-8");
    this.data = JSON.parse(raw);
  }

  async getPatient(id: string): Promise<PatientData> {
    const patient = this.data.patients[id];
    if (!patient) {
      throw new Error(`Patient not found: ${id}`);
    }
    return patient;
  }

  async getMedications(patientId: string): Promise<MedicationData[]> {
    const patient = this.data.patients[patientId];
    if (!patient) {
      throw new Error(`Patient not found: ${patientId}`);
    }
    return this.data.medications[patientId] ?? [];
  }

  async getLabResults(patientId: string): Promise<LabResult[]> {
    const patient = this.data.patients[patientId];
    if (!patient) {
      throw new Error(`Patient not found: ${patientId}`);
    }
    return this.data.lab_results[patientId] ?? [];
  }

  async getEncounters(patientId: string): Promise<EncounterData[]> {
    const patient = this.data.patients[patientId];
    if (!patient) {
      throw new Error(`Patient not found: ${patientId}`);
    }
    return this.data.encounters[patientId] ?? [];
  }

  async getAdmissionMedications(encounterId: string): Promise<AdmissionMedication[]> {
    return this.data.admission_medications[encounterId] ?? [];
  }

  async getAppointments(patientId: string): Promise<Appointment[]> {
    const patient = this.data.patients[patientId];
    if (!patient) {
      throw new Error(`Patient not found: ${patientId}`);
    }
    return this.data.appointments[patientId] ?? [];
  }

  async saveDocument(
    doc: Omit<DocumentRecord, "document_id" | "created_at">
  ): Promise<DocumentRecord> {
    const document_id = `doc-${this.nextDocId++}`;
    const record: DocumentRecord = {
      ...doc,
      document_id,
      created_at: new Date().toISOString(),
    };
    this.data.documents[document_id] = record;
    return record;
  }

  async getDocument(documentId: string): Promise<DocumentRecord> {
    const doc = this.data.documents[documentId];
    if (!doc) {
      throw new Error(`Document not found: ${documentId}`);
    }
    return doc;
  }

  async updateDocument(
    documentId: string,
    updates: Partial<Pick<DocumentRecord, "content" | "status">>
  ): Promise<DocumentRecord> {
    const doc = this.data.documents[documentId];
    if (!doc) {
      throw new Error(`Document not found: ${documentId}`);
    }
    if (updates.content !== undefined) doc.content = updates.content;
    if (updates.status !== undefined) doc.status = updates.status;
    doc.updated_at = new Date().toISOString();
    return doc;
  }

  async deleteDocument(documentId: string): Promise<{ deleted: boolean }> {
    if (!this.data.documents[documentId]) {
      throw new Error(`Document not found: ${documentId}`);
    }
    delete this.data.documents[documentId];
    return { deleted: true };
  }
}
