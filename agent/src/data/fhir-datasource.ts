import type {
  DataSource, PatientData, MedicationData, LabResult,
  EncounterData, AdmissionMedication, Appointment, DocumentRecord,
} from "./datasource";
import {
  mapFhirPatient, mapFhirMedications, mapFhirLabResults,
  mapFhirEncounters, mapFhirAdmissionMedications, mapFhirAppointments,
} from "./fhir-mappers";
import { FhirAuthManager, FHIR_SCOPES } from "./fhir-auth";
import { PatientIdResolver } from "./patient-id-resolver";
import { TtlCache } from "../cache";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FHIR_TIMEOUT_MS = 10_000;

/** TTL for FHIR data cache: 60 seconds. Patient data rarely changes within a clinical session. */
const FHIR_CACHE_TTL_MS = 60_000;
/** Max entries in the FHIR data cache. */
const FHIR_CACHE_MAX_ENTRIES = 100;

export interface FhirDataSourceConfig {
  fhirBaseUrl: string;
  apiBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  username: string;
  password: string;
  scope?: string;
}

const DEFAULT_SCOPE = FHIR_SCOPES;

export class FhirDataSource implements DataSource {
  private fhirBaseUrl: string;
  private auth: FhirAuthManager;
  private resolver: PatientIdResolver;
  private readonly cache = new TtlCache<unknown>({
    ttlMs: FHIR_CACHE_TTL_MS,
    maxEntries: FHIR_CACHE_MAX_ENTRIES,
  });

  constructor(config: FhirDataSourceConfig) {
    this.fhirBaseUrl = config.fhirBaseUrl.replace(/\/$/, "");

    this.auth = new FhirAuthManager({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      username: config.username,
      password: config.password,
      scope: config.scope ?? DEFAULT_SCOPE,
    });

    this.resolver = new PatientIdResolver({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken: () => this.auth.getAccessToken(),
    });
  }

  /** Clear the FHIR data cache. Useful for testing or forced refresh. */
  clearCache(): void {
    this.cache.clear();
  }

  private async resolveUuid(pid: string): Promise<string> {
    if (UUID_REGEX.test(pid)) return pid;

    // Try Standard API first, fall back to FHIR Patient search
    try {
      return await this.resolver.resolveToUuid(pid);
    } catch {
      // Standard API may not be accessible; fall back to FHIR search
      const bundle = await this.fhirFetch<{ entry?: Array<{ resource: { id: string } }> }>(
        `/Patient?identifier=${encodeURIComponent(pid)}&_count=1`
      );
      if (bundle.entry?.[0]?.resource?.id) {
        return bundle.entry[0].resource.id;
      }
      // SEC-002: Removed "last resort" all-patients fetch to prevent IDOR/enumeration
      throw new Error(`Patient not found: ${pid}`);
    }
  }

  private async fhirFetch<T>(path: string): Promise<T> {
    const token = await this.auth.getAccessToken();
    const url = `${this.fhirBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    // SEC-005: AbortController timeout to prevent hanging requests
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FHIR_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/fhir+json",
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("FHIR request timed out");
      }
      throw err;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("FHIR authentication failed - token may have expired");
      }
      if (res.status === 404) {
        throw new Error("Resource not found");
      }
      // SEC-008: Log details internally, throw generic message
      const text = await res.text();
      console.error(`FHIR error details [${res.status}]:`, text);
      throw new Error(`FHIR request failed: ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  async getPatient(id: string): Promise<PatientData> {
    const cacheKey = `patient:${id}`;
    const cached = this.cache.get(cacheKey) as PatientData | undefined;
    if (cached) return cached;

    const uuid = await this.resolveUuid(id);

    const [patient, conditions, meds, allergies, vitals] = await Promise.all([
      this.fhirFetch(`/Patient/${uuid}`),
      this.fhirFetch(`/Condition?patient=${uuid}&_count=100`),
      this.fhirFetch(`/MedicationRequest?patient=${uuid}&status=active&_count=100`),
      this.fhirFetch(`/AllergyIntolerance?patient=${uuid}&_count=100`),
      this.fhirFetch(`/Observation?patient=${uuid}&category=vital-signs&_sort=-date&_count=10`),
    ]);

    const result = mapFhirPatient(id, patient as Parameters<typeof mapFhirPatient>[1], conditions as Parameters<typeof mapFhirPatient>[2], meds as Parameters<typeof mapFhirPatient>[3], allergies as Parameters<typeof mapFhirPatient>[4], vitals as Parameters<typeof mapFhirPatient>[5]);
    this.cache.set(cacheKey, result);
    return result;
  }

  async getMedications(patientId: string): Promise<MedicationData[]> {
    const cacheKey = `medications:${patientId}`;
    const cached = this.cache.get(cacheKey) as MedicationData[] | undefined;
    if (cached) return cached;

    const uuid = await this.resolveUuid(patientId);

    const bundle = await this.fhirFetch(
      `/MedicationRequest?patient=${uuid}&status=active&_count=100`
    );

    const result = mapFhirMedications(bundle as Parameters<typeof mapFhirMedications>[0]);
    this.cache.set(cacheKey, result);
    return result;
  }

  async getLabResults(patientId: string): Promise<LabResult[]> {
    const cacheKey = `labs:${patientId}`;
    const cached = this.cache.get(cacheKey) as LabResult[] | undefined;
    if (cached) return cached;

    const uuid = await this.resolveUuid(patientId);

    const bundle = await this.fhirFetch(
      `/Observation?patient=${uuid}&category=laboratory&_sort=-date&_count=50`
    );

    const result = mapFhirLabResults(bundle as Parameters<typeof mapFhirLabResults>[0]);
    this.cache.set(cacheKey, result);
    return result;
  }

  async getEncounters(patientId: string): Promise<EncounterData[]> {
    const cacheKey = `encounters:${patientId}`;
    const cached = this.cache.get(cacheKey) as EncounterData[] | undefined;
    if (cached) return cached;

    const uuid = await this.resolveUuid(patientId);

    const bundle = await this.fhirFetch(
      `/Encounter?patient=${uuid}&_sort=-date&_count=50`
    );

    const result = mapFhirEncounters(patientId, bundle as Parameters<typeof mapFhirEncounters>[1]);
    this.cache.set(cacheKey, result);
    return result;
  }

  async getAdmissionMedications(encounterId: string): Promise<AdmissionMedication[]> {
    const cacheKey = `admissionMeds:${encounterId}`;
    const cached = this.cache.get(cacheKey) as AdmissionMedication[] | undefined;
    if (cached) return cached;

    const bundle = await this.fhirFetch(
      `/MedicationRequest?encounter=${encounterId}&_count=100`
    );

    const result = mapFhirAdmissionMedications(bundle as Parameters<typeof mapFhirAdmissionMedications>[0]);
    this.cache.set(cacheKey, result);
    return result;
  }

  async getAppointments(patientId: string): Promise<Appointment[]> {
    const cacheKey = `appointments:${patientId}`;
    const cached = this.cache.get(cacheKey) as Appointment[] | undefined;
    if (cached) return cached;

    const uuid = await this.resolveUuid(patientId);

    const bundle = await this.fhirFetch(
      `/Appointment?patient=${uuid}&status=booked,arrived,checked-in,pending&_sort=date&_count=50`
    );

    const result = mapFhirAppointments(patientId, bundle as Parameters<typeof mapFhirAppointments>[1]);
    this.cache.set(cacheKey, result);
    return result;
  }

  // --- Document CRUD via FHIR DocumentReference ---
  // Note: OpenEMR FHIR DocumentReference support varies by version.
  // These methods provide the correct FHIR API calls. In practice,
  // some OpenEMR instances may need the Standard API instead.

  async saveDocument(
    doc: Omit<DocumentRecord, "document_id" | "created_at">
  ): Promise<DocumentRecord> {
    const token = await this.auth.getAccessToken();
    const now = new Date().toISOString();

    const fhirDoc = {
      resourceType: "DocumentReference",
      status: doc.status === "final" ? "current" : "preliminary",
      type: {
        coding: [{ system: "http://loinc.org", code: doc.type === "discharge_summary" ? "18842-5" : "11503-0", display: doc.type.replace("_", " ") }],
      },
      subject: { reference: `Patient/${doc.patient_id}` },
      context: { encounter: [{ reference: `Encounter/${doc.encounter_id}` }] },
      author: [{ display: doc.created_by }],
      date: now,
      content: [
        {
          attachment: {
            contentType: "text/plain",
            data: Buffer.from(doc.content).toString("base64"),
          },
        },
      ],
    };

    const res = await fetch(`${this.fhirBaseUrl}/DocumentReference`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(fhirDoc),
    });

    if (!res.ok) {
      // SEC-008: Log details internally, throw generic message
      const text = await res.text();
      console.error(`FHIR DocumentReference create error [${res.status}]:`, text);
      throw new Error(`FHIR DocumentReference create failed: ${res.status}`);
    }

    const created = (await res.json()) as { id?: string };
    return {
      document_id: created.id ?? `fhir-doc-${Date.now()}`,
      patient_id: doc.patient_id,
      encounter_id: doc.encounter_id,
      type: doc.type,
      status: doc.status,
      content: doc.content,
      created_at: now,
      created_by: doc.created_by,
    };
  }

  async getDocument(documentId: string): Promise<DocumentRecord> {
    const resource = await this.fhirFetch<Record<string, unknown>>(
      `/DocumentReference/${documentId}`
    );

    const content = (resource as any).content?.[0]?.attachment?.data
      ? Buffer.from((resource as any).content[0].attachment.data, "base64").toString("utf-8")
      : "";

    return {
      document_id: documentId,
      patient_id: (resource as any).subject?.reference?.replace("Patient/", "") ?? "",
      encounter_id: (resource as any).context?.encounter?.[0]?.reference?.replace("Encounter/", "") ?? "",
      type: (resource as any).type?.coding?.[0]?.code === "18842-5" ? "discharge_summary" : "medication_reconciliation",
      status: (resource as any).status === "current" ? "final" : "draft",
      content,
      created_at: (resource as any).date ?? "",
      created_by: (resource as any).author?.[0]?.display ?? "unknown",
    };
  }

  async updateDocument(
    documentId: string,
    updates: Partial<Pick<DocumentRecord, "content" | "status">>
  ): Promise<DocumentRecord> {
    // Fetch current document, apply updates, PUT back
    const current = await this.getDocument(documentId);
    const merged = { ...current, ...updates, updated_at: new Date().toISOString() };

    const token = await this.auth.getAccessToken();
    const fhirDoc = {
      resourceType: "DocumentReference",
      id: documentId,
      status: merged.status === "final" ? "current" : "preliminary",
      type: {
        coding: [{ system: "http://loinc.org", code: merged.type === "discharge_summary" ? "18842-5" : "11503-0" }],
      },
      subject: { reference: `Patient/${merged.patient_id}` },
      context: { encounter: [{ reference: `Encounter/${merged.encounter_id}` }] },
      author: [{ display: merged.created_by }],
      date: merged.created_at,
      content: [
        {
          attachment: {
            contentType: "text/plain",
            data: Buffer.from(merged.content).toString("base64"),
          },
        },
      ],
    };

    const res = await fetch(`${this.fhirBaseUrl}/DocumentReference/${documentId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(fhirDoc),
    });

    if (!res.ok) {
      // SEC-008: Log details internally, throw generic message
      const text = await res.text();
      console.error(`FHIR DocumentReference update error [${res.status}]:`, text);
      throw new Error(`FHIR DocumentReference update failed: ${res.status}`);
    }

    return merged;
  }

  async deleteDocument(documentId: string): Promise<{ deleted: boolean }> {
    const token = await this.auth.getAccessToken();

    const res = await fetch(`${this.fhirBaseUrl}/DocumentReference/${documentId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/fhir+json",
      },
    });

    if (!res.ok && res.status !== 204) {
      throw new Error(`Document not found: ${documentId}`);
    }

    return { deleted: true };
  }
}
