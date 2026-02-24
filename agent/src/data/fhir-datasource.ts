import type { DataSource, PatientData, MedicationData, LabResult } from "./datasource";
import { mapFhirPatient, mapFhirMedications, mapFhirLabResults } from "./fhir-mappers";
import { FhirAuthManager } from "./fhir-auth";
import { PatientIdResolver } from "./patient-id-resolver";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const DEFAULT_SCOPE =
  "openid api:oemr api:fhir user/Patient.read user/MedicationRequest.read user/Observation.read user/AllergyIntolerance.read user/Condition.read";

export class FhirDataSource implements DataSource {
  private fhirBaseUrl: string;
  private auth: FhirAuthManager;
  private resolver: PatientIdResolver;

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
      // Last resort: list all patients and match by position (pid=1 → first patient)
      const allBundle = await this.fhirFetch<{ entry?: Array<{ resource: { id: string } }> }>(
        `/Patient?_count=100`
      );
      const idx = parseInt(pid, 10) - 1;
      if (allBundle.entry?.[idx]?.resource?.id) {
        return allBundle.entry[idx].resource.id;
      }
      throw new Error(`Patient not found: ${pid}`);
    }
  }

  private async fhirFetch<T>(path: string): Promise<T> {
    const token = await this.auth.getAccessToken();
    const url = `${this.fhirBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/fhir+json",
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("FHIR authentication failed - token may have expired");
      }
      if (res.status === 404) {
        throw new Error("Resource not found");
      }
      const text = await res.text();
      throw new Error(`FHIR request failed: ${res.status} ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async getPatient(id: string): Promise<PatientData> {
    const uuid = await this.resolveUuid(id);

    const [patient, conditions, meds, allergies] = await Promise.all([
      this.fhirFetch(`/Patient/${uuid}`),
      this.fhirFetch(`/Condition?patient=${uuid}&_count=100`),
      this.fhirFetch(`/MedicationRequest?patient=${uuid}&status=active&_count=100`),
      this.fhirFetch(`/AllergyIntolerance?patient=${uuid}&_count=100`),
    ]);

    return mapFhirPatient(id, patient as Parameters<typeof mapFhirPatient>[1], conditions as Parameters<typeof mapFhirPatient>[2], meds as Parameters<typeof mapFhirPatient>[3], allergies as Parameters<typeof mapFhirPatient>[4]);
  }

  async getMedications(patientId: string): Promise<MedicationData[]> {
    const uuid = await this.resolveUuid(patientId);

    const bundle = await this.fhirFetch(
      `/MedicationRequest?patient=${uuid}&status=active&_count=100`
    );

    return mapFhirMedications(bundle as Parameters<typeof mapFhirMedications>[0]);
  }

  async getLabResults(patientId: string): Promise<LabResult[]> {
    const uuid = await this.resolveUuid(patientId);

    const bundle = await this.fhirFetch(
      `/Observation?patient=${uuid}&category=laboratory&_sort=-date&_count=50`
    );

    return mapFhirLabResults(bundle as Parameters<typeof mapFhirLabResults>[0]);
  }
}
