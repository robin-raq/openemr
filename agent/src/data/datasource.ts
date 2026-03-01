export interface VitalSign {
  name: string;
  value: string;
  unit: string;
  date: string;
  status: "normal" | "abnormal" | "critical";
}

export interface PatientData {
  patient_id: string;
  name: string;
  dob: string;
  gender: string;
  conditions: string[];
  medications: { name: string; dose: string; frequency: string }[];
  allergies: string[];
  vitals?: VitalSign[];
}

export interface MedicationData {
  name: string;
  dose: string;
  frequency: string;
  start_date: string;
  prescriber: string;
  status: string;
}

export interface LabResult {
  test_name: string;
  value: number;
  unit: string;
  reference_range: string;
  date: string;
  flag: "normal" | "abnormal" | "critical";
}

export interface EncounterData {
  encounter_id: string;
  patient_id: string;
  type: "inpatient" | "outpatient" | "emergency";
  admission_date: string;
  discharge_date?: string;
  status: "active" | "discharged" | "transferred";
  attending_provider: string;
  admission_reason: string;
  diagnoses: string[];
  procedures: string[];
  hospital_course_notes: string[];
}

export interface AdmissionMedication {
  name: string;
  dose: string;
  frequency: string;
  status: "continued" | "modified" | "discontinued" | "new";
  modification_reason?: string;
  original_dose?: string;
  original_frequency?: string;
}

export interface DocumentRecord {
  document_id: string;
  patient_id: string;
  encounter_id: string;
  type: "discharge_summary" | "medication_reconciliation" | "discharge_instructions";
  status: "draft" | "final";
  content: string;
  created_at: string;
  created_by: string;
  updated_at?: string;
}

export interface Appointment {
  appointment_id: string;
  patient_id: string;
  provider: string;
  specialty: string;
  date: string;
  time: string;
  location: string;
  reason: string;
  status: "scheduled" | "confirmed" | "cancelled" | "completed";
}

export interface DataSource {
  getPatient(id: string): Promise<PatientData>;
  getMedications(patientId: string): Promise<MedicationData[]>;
  getLabResults(patientId: string): Promise<LabResult[]>;
  getEncounters(patientId: string): Promise<EncounterData[]>;
  getAdmissionMedications(encounterId: string): Promise<AdmissionMedication[]>;
  getAppointments(patientId: string): Promise<Appointment[]>;
  saveDocument(doc: Omit<DocumentRecord, "document_id" | "created_at">): Promise<DocumentRecord>;
  getDocument(documentId: string): Promise<DocumentRecord>;
  updateDocument(documentId: string, updates: Partial<Pick<DocumentRecord, "content" | "status">>): Promise<DocumentRecord>;
  deleteDocument(documentId: string): Promise<{ deleted: boolean }>;
}
