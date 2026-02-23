export interface PatientData {
  patient_id: string;
  name: string;
  dob: string;
  gender: string;
  conditions: string[];
  medications: { name: string; dose: string; frequency: string }[];
  allergies: string[];
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

export interface DataSource {
  getPatient(id: string): Promise<PatientData>;
  getMedications(patientId: string): Promise<MedicationData[]>;
  getLabResults(patientId: string): Promise<LabResult[]>;
}
