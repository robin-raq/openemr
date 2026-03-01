import type {
  PatientData,
  MedicationData,
  LabResult,
  VitalSign,
  EncounterData,
  AdmissionMedication,
  Appointment,
} from "./datasource";

// FHIR R4 types (minimal for mapping)
interface FhirPatient {
  name?: Array<{ family?: string; given?: string[] }>;
  birthDate?: string;
  gender?: string;
}

interface FhirCondition {
  code?: { text?: string; coding?: Array<{ display?: string }> };
}

interface FhirMedicationRequest {
  medicationCodeableConcept?: { text?: string };
  medicationReference?: { display?: string };
  dosageInstruction?: Array<{
    doseAndRate?: Array<{ doseQuantity?: { value?: number; unit?: string } }>;
    timing?: { code?: { text?: string } };
  }>;
  authoredOn?: string;
  requester?: { display?: string };
  status?: string;
}

interface FhirAllergyIntolerance {
  code?: { text?: string; coding?: Array<{ display?: string }> };
}

interface FhirObservation {
  code?: { text?: string };
  valueQuantity?: { value?: number; unit?: string };
  referenceRange?: Array<{
    low?: { value?: number };
    high?: { value?: number };
    text?: string;
  }>;
  interpretation?: Array<{ coding?: Array<{ code?: string }> }>;
  effectiveDateTime?: string;
}

interface FhirVitalSignObservation {
  code?: { text?: string; coding?: Array<{ code?: string; display?: string }> };
  valueQuantity?: { value?: number; unit?: string };
  component?: Array<{
    code?: { coding?: Array<{ code?: string; display?: string }> };
    valueQuantity?: { value?: number; unit?: string };
  }>;
  interpretation?: Array<{ coding?: Array<{ code?: string }> }>;
  effectiveDateTime?: string;
}

interface FhirBundle<T> {
  entry?: Array<{ resource?: T }>;
}

function extractMedicationName(mr: FhirMedicationRequest): string {
  const med = mr.medicationCodeableConcept ?? mr.medicationReference;
  return med?.text ?? med?.display ?? "Unknown medication";
}

function extractDose(mr: FhirMedicationRequest): string {
  const dose = mr.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity;
  if (!dose || dose.value == null) return "";
  const v = dose.value;
  const u = (dose.unit ?? "").trim();
  return u ? `${v}${u}` : String(v);
}

function extractFrequency(mr: FhirMedicationRequest): string {
  return mr.dosageInstruction?.[0]?.timing?.code?.text ?? "";
}

function interpretationToFlag(code: string | undefined): "normal" | "abnormal" | "critical" {
  if (!code) return "normal";
  const c = code.toUpperCase();
  if (c === "N" || c === "NORMAL") return "normal";
  if (c === "HH" || c === "LL") return "critical";
  if (c === "H" || c === "L" || c === "A" || c === "ABNORMAL") return "abnormal";
  return "normal";
}

function formatReferenceRange(ref: FhirObservation["referenceRange"]): string {
  if (!ref?.length) return "";
  const r = ref[0];
  if (r?.text) return r.text;
  const low = r?.low?.value;
  const high = r?.high?.value;
  if (low != null && high != null) return `${low}-${high}`;
  if (high != null) return `<${high}`;
  if (low != null) return `>${low}`;
  return "";
}

export function mapFhirPatient(
  pid: string,
  patient: FhirPatient,
  conditionBundle: FhirBundle<FhirCondition>,
  medicationBundle: FhirBundle<FhirMedicationRequest>,
  allergyBundle: FhirBundle<FhirAllergyIntolerance>,
  vitalsBundle?: FhirBundle<FhirVitalSignObservation>
): PatientData {
  const names = patient.name ?? [];
  const first = names[0];
  const given = first?.given?.join(" ") ?? "";
  const family = first?.family ?? "";
  const name = [given, family].filter(Boolean).join(" ") || "Unknown";

  const conditions: string[] = [];
  for (const e of conditionBundle.entry ?? []) {
    const r = e.resource;
    const text = r?.code?.text ?? r?.code?.coding?.[0]?.display;
    if (text) conditions.push(text);
  }

  const allergies: string[] = [];
  for (const e of allergyBundle.entry ?? []) {
    const r = e.resource;
    const text = r?.code?.text ?? r?.code?.coding?.[0]?.display;
    if (text) allergies.push(text);
  }

  const medications: { name: string; dose: string; frequency: string }[] = [];
  for (const e of medicationBundle.entry ?? []) {
    const r = e.resource;
    if (!r) continue;
    medications.push({
      name: extractMedicationName(r),
      dose: extractDose(r),
      frequency: extractFrequency(r),
    });
  }

  const vitals = vitalsBundle ? mapFhirVitalSigns(vitalsBundle) : [];

  return {
    patient_id: pid,
    name,
    dob: patient.birthDate ?? "",
    gender: patient.gender ?? "unknown",
    conditions,
    medications,
    allergies,
    vitals,
  };
}

export function mapFhirMedications(
  bundle: FhirBundle<FhirMedicationRequest>
): MedicationData[] {
  const result: MedicationData[] = [];
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    if (!r) continue;
    result.push({
      name: extractMedicationName(r),
      dose: extractDose(r),
      frequency: extractFrequency(r),
      start_date: r.authoredOn ?? "",
      prescriber: r.requester?.display ?? "",
      status: r.status ?? "unknown",
    });
  }
  return result;
}

export function mapFhirLabResults(
  bundle: FhirBundle<FhirObservation>
): LabResult[] {
  const result: LabResult[] = [];
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    if (!r) continue;
    const code = r.interpretation?.[0]?.coding?.[0]?.code;
    result.push({
      test_name: r.code?.text ?? "Unknown",
      value: r.valueQuantity?.value ?? 0,
      unit: r.valueQuantity?.unit ?? "",
      reference_range: formatReferenceRange(r.referenceRange),
      date: r.effectiveDateTime ?? "",
      flag: interpretationToFlag(code),
    });
  }
  return result;
}

const BP_LOINC = "85354-9";
const SYSTOLIC_LOINC = "8480-6";
const DIASTOLIC_LOINC = "8462-4";

export function mapFhirVitalSigns(
  bundle: FhirBundle<FhirVitalSignObservation>
): VitalSign[] {
  const result: VitalSign[] = [];
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    if (!r) continue;

    const loincCode = r.code?.coding?.[0]?.code;
    const name = r.code?.text ?? r.code?.coding?.[0]?.display ?? "Unknown";
    const date = r.effectiveDateTime ?? "";
    const interpCode = r.interpretation?.[0]?.coding?.[0]?.code;
    const status = interpretationToFlag(interpCode);

    // Blood pressure uses FHIR component pattern (systolic + diastolic)
    if (loincCode === BP_LOINC || name.toLowerCase().includes("blood pressure")) {
      const systolic = r.component?.find(
        (c) => c.code?.coding?.[0]?.code === SYSTOLIC_LOINC
      );
      const diastolic = r.component?.find(
        (c) => c.code?.coding?.[0]?.code === DIASTOLIC_LOINC
      );
      const sys = systolic?.valueQuantity?.value ?? 0;
      const dia = diastolic?.valueQuantity?.value ?? 0;
      result.push({
        name: "Blood Pressure",
        value: `${sys}/${dia}`,
        unit: "mmHg",
        date,
        status,
      });
    } else {
      const val = r.valueQuantity?.value;
      result.push({
        name,
        value: val != null ? String(val) : "",
        unit: r.valueQuantity?.unit ?? "",
        date,
        status,
      });
    }
  }
  return result;
}

// --- Encounter + Admission Medication mappers (Bounty) ---

interface FhirEncounter {
  id?: string;
  status?: string;
  class?: { code?: string };
  type?: Array<{ text?: string }>;
  period?: { start?: string; end?: string };
  reasonCode?: Array<{ text?: string; coding?: Array<{ display?: string }> }>;
  diagnosis?: Array<{
    condition?: { display?: string };
    use?: { coding?: Array<{ code?: string }> };
  }>;
  participant?: Array<{
    individual?: { display?: string };
    type?: Array<{ coding?: Array<{ code?: string }> }>;
  }>;
}

function mapEncounterType(classCode: string | undefined): EncounterData["type"] {
  switch (classCode?.toUpperCase()) {
    case "IMP":
    case "ACUTE":
    case "NONAC":
      return "inpatient";
    case "EMER":
      return "emergency";
    default:
      return "outpatient";
  }
}

function mapEncounterStatus(fhirStatus: string | undefined): EncounterData["status"] {
  switch (fhirStatus) {
    case "in-progress":
    case "arrived":
      return "active";
    case "finished":
    case "completed":
      return "discharged";
    default:
      return "active";
  }
}

export function mapFhirEncounters(
  patientId: string,
  bundle: FhirBundle<FhirEncounter>
): EncounterData[] {
  const result: EncounterData[] = [];
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    if (!r) continue;

    const attending = r.participant?.find(
      (p) => p.type?.some((t) => t.coding?.some((c) => c.code === "ATND"))
    )?.individual?.display ?? r.participant?.[0]?.individual?.display ?? "Unknown";

    const reason = r.reasonCode?.[0]?.text ?? r.reasonCode?.[0]?.coding?.[0]?.display ?? "";
    const diagnoses = (r.diagnosis ?? [])
      .map((d) => d.condition?.display)
      .filter((d): d is string => !!d);

    result.push({
      encounter_id: r.id ?? "",
      patient_id: patientId,
      type: mapEncounterType(r.class?.code),
      admission_date: r.period?.start ?? "",
      discharge_date: r.period?.end,
      status: mapEncounterStatus(r.status),
      attending_provider: attending,
      admission_reason: reason,
      diagnoses,
      procedures: [], // FHIR Procedure is a separate resource; fetched separately if needed
      hospital_course_notes: [], // Not standard in FHIR Encounter; added from clinical notes
    });
  }
  return result;
}

export function mapFhirAdmissionMedications(
  bundle: FhirBundle<FhirMedicationRequest>
): AdmissionMedication[] {
  const result: AdmissionMedication[] = [];
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    if (!r) continue;

    // Map FHIR MedicationRequest status to our admission medication categories
    let status: AdmissionMedication["status"] = "continued";
    if (r.status === "stopped" || r.status === "cancelled") {
      status = "discontinued";
    } else if (r.status === "draft") {
      status = "new";
    }

    result.push({
      name: extractMedicationName(r),
      dose: extractDose(r),
      frequency: extractFrequency(r),
      status,
    });
  }
  return result;
}

// --- Appointment mapper ---

interface FhirAppointment {
  id?: string;
  status?: string;
  start?: string;
  end?: string;
  description?: string;
  serviceType?: Array<{ text?: string; coding?: Array<{ display?: string }> }>;
  participant?: Array<{
    actor?: { reference?: string; display?: string };
    type?: Array<{ coding?: Array<{ code?: string }> }>;
  }>;
  reasonCode?: Array<{ text?: string; coding?: Array<{ display?: string }> }>;
}

function mapFhirAppointmentStatus(fhirStatus: string | undefined): Appointment["status"] {
  switch (fhirStatus) {
    case "booked":
    case "pending":
      return "scheduled";
    case "arrived":
    case "checked-in":
      return "confirmed";
    case "cancelled":
    case "noshow":
      return "cancelled";
    case "fulfilled":
      return "completed";
    default:
      return "scheduled";
  }
}

export function mapFhirAppointments(
  patientId: string,
  bundle: FhirBundle<FhirAppointment>
): Appointment[] {
  const result: Appointment[] = [];
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    if (!r) continue;

    const practitioner = r.participant?.find(
      (p) => p.actor?.reference?.startsWith("Practitioner/")
    );
    const provider = practitioner?.actor?.display ?? "Unknown";

    const specialty = r.serviceType?.[0]?.text
      ?? r.serviceType?.[0]?.coding?.[0]?.display
      ?? "";

    const reason = r.reasonCode?.[0]?.text
      ?? r.reasonCode?.[0]?.coding?.[0]?.display
      ?? r.description
      ?? "";

    const startDate = r.start ? new Date(r.start) : null;
    const date = startDate ? startDate.toISOString().split("T")[0] : "";
    const time = startDate
      ? startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      : "";

    // Location from participant with Location reference
    const locationParticipant = r.participant?.find(
      (p) => p.actor?.reference?.startsWith("Location/")
    );
    const location = locationParticipant?.actor?.display ?? "";

    result.push({
      appointment_id: r.id ?? "",
      patient_id: patientId,
      provider,
      specialty,
      date,
      time,
      location,
      reason,
      status: mapFhirAppointmentStatus(r.status),
    });
  }
  return result;
}
