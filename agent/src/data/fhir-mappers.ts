import type {
  PatientData,
  MedicationData,
  LabResult,
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
  allergyBundle: FhirBundle<FhirAllergyIntolerance>
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

  return {
    patient_id: pid,
    name,
    dob: patient.birthDate ?? "",
    gender: patient.gender ?? "unknown",
    conditions,
    medications,
    allergies,
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
