/**
 * FHIR integration tests — run against live OpenEMR Docker.
 * Skip unless RUN_FHIR_INTEGRATION_TESTS=1
 */
import { describe, it, expect, beforeAll } from "vitest";
import { FhirDataSource } from "../src/data/fhir-datasource";

const RUN = process.env.RUN_FHIR_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN)("fhir-integration", () => {
  let ds: FhirDataSource;

  beforeAll(() => {
    const baseUrl = process.env.FHIR_BASE_URL || "https://localhost:9300/apis/default/fhir";
    const origin = baseUrl.replace(/\/apis\/default\/fhir.*/, "");
    ds = new FhirDataSource({
      fhirBaseUrl: baseUrl,
      apiBaseUrl: `${origin}/apis/default/api`,
      tokenUrl: `${origin}/oauth2/default/token`,
      clientId: process.env.FHIR_CLIENT_ID!,
      clientSecret: process.env.FHIR_CLIENT_SECRET,
      username: process.env.FHIR_USERNAME || "admin",
      password: process.env.FHIR_PASSWORD || "pass",
    });
  });

  it("fetches patient data from live OpenEMR FHIR API", async () => {
    const patient = await ds.getPatient("1");
    expect(patient.patient_id).toBeDefined();
    expect(patient.name).toBeDefined();
    expect(Array.isArray(patient.conditions)).toBe(true);
    expect(Array.isArray(patient.allergies)).toBe(true);
    expect(Array.isArray(patient.medications)).toBe(true);
  });

  it("fetches medications from live OpenEMR", async () => {
    const meds = await ds.getMedications("1");
    expect(Array.isArray(meds)).toBe(true);
  });

  it("fetches lab results from live OpenEMR", async () => {
    const labs = await ds.getLabResults("1");
    expect(Array.isArray(labs)).toBe(true);
  });
});
