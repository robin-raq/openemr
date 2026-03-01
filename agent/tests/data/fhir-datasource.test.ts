import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FhirDataSource } from "../../src/data/fhir-datasource";
import * as fs from "fs";
import * as path from "path";

const fixturesDir = path.join(__dirname, "fixtures");

function loadFixture<T>(name: string): T {
  const raw = fs.readFileSync(path.join(fixturesDir, name), "utf-8");
  return JSON.parse(raw) as T;
}

describe("FhirDataSource", () => {
  const config = {
    fhirBaseUrl: "https://localhost:9300/apis/default/fhir",
    apiBaseUrl: "https://localhost:9300/apis/default/api",
    tokenUrl: "https://localhost:9300/oauth2/default/token",
    clientId: "test-client",
    username: "admin",
    password: "pass",
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockPatientLookup(uuid: string) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ uuid }),
    });
  }

  function mockToken() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok-123", expires_in: 3600 }),
    });
  }

  function mockFhirResponses() {
    const patient = loadFixture("patient.json");
    const conditions = loadFixture("condition-bundle.json");
    const meds = loadFixture("medication-request-bundle.json");
    const allergies = loadFixture("allergy-intolerance-bundle.json");
    const vitals = loadFixture("vital-signs-bundle.json");

    mockToken();
    mockPatientLookup("90cde167-511f-4f6d-bc97-b65a78cf1995");

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(patient),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(conditions),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(meds),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(allergies),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(vitals),
      });
  }

  it("getPatient resolves pid to UUID and fetches in parallel", async () => {
    mockFhirResponses();

    const ds = new FhirDataSource(config);
    const result = await ds.getPatient("1");

    expect(result.patient_id).toBe("1");
    expect(result.name).toBe("John Demo");
    expect(result.conditions).toHaveLength(3);
    expect(result.allergies).toContain("Penicillin");
    expect(result.medications).toHaveLength(3);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/patient?pid=1"),
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/Patient/90cde167-511f-4f6d-bc97-b65a78cf1995"),
      expect.any(Object)
    );
  });

  it("getPatient uses UUID directly when pid is already UUID", async () => {
    const patient = loadFixture("patient.json");
    const conditions = loadFixture("condition-bundle.json");
    const meds = loadFixture("medication-request-bundle.json");
    const allergies = loadFixture("allergy-intolerance-bundle.json");

    const vitals = loadFixture("vital-signs-bundle.json");

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("oauth2") && url.includes("token")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ access_token: "tok", expires_in: 3600 }),
        });
      }
      if (url.includes("/Patient/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(patient) });
      }
      if (url.includes("/Condition")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(conditions) });
      }
      if (url.includes("/MedicationRequest")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(meds) });
      }
      if (url.includes("/AllergyIntolerance")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(allergies) });
      }
      if (url.includes("/Observation") && url.includes("vital-signs")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(vitals) });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
    });

    const ds = new FhirDataSource(config);
    const uuid = "90cde167-511f-4f6d-bc97-b65a78cf1995";
    const result = await ds.getPatient(uuid);

    expect(result.patient_id).toBe(uuid);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/patient?pid="),
      expect.any(Object)
    );
  });

  it("getMedications fetches MedicationRequest bundle and maps", async () => {
    mockToken();
    mockPatientLookup("90cde167-511f-4f6d-bc97-b65a78cf1995");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(loadFixture("medication-request-bundle.json")),
    });

    const ds = new FhirDataSource(config);
    const result = await ds.getMedications("1");

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Warfarin");
    expect(result[0].prescriber).toBe("Dr. Smith");
  });

  it("getLabResults fetches Observation bundle and maps", async () => {
    mockToken();
    mockPatientLookup("90cde167-511f-4f6d-bc97-b65a78cf1995");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(loadFixture("observation-bundle.json")),
    });

    const ds = new FhirDataSource(config);
    const result = await ds.getLabResults("1");

    expect(result).toHaveLength(4);
    expect(result.find((r) => r.test_name === "INR")?.flag).toBe("normal");
    expect(result.find((r) => r.test_name === "Potassium")?.flag).toBe("critical");
  });

  it("getPatient throws when patient lookup returns 404", async () => {
    mockToken();
    // Standard API returns 404
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    });
    // FHIR fallback: identifier search returns empty bundle
    // SEC-002: "Last resort" all-patients fetch removed; only 2 mocks needed
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ resourceType: "Bundle", entry: [] }),
    });

    const ds = new FhirDataSource(config);

    await expect(ds.getPatient("99999")).rejects.toThrow("Patient not found");
  });

  it("getPatient throws when FHIR returns 401", async () => {
    mockToken();
    mockPatientLookup("90cde167-511f-4f6d-bc97-b65a78cf1995");
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    const ds = new FhirDataSource(config);

    await expect(ds.getPatient("1")).rejects.toThrow("authentication failed");
  });

  it("getMedications returns empty array when bundle has no entries", async () => {
    mockToken();
    mockPatientLookup("90cde167-511f-4f6d-bc97-b65a78cf1995");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(loadFixture("empty-bundle.json")),
    });

    const ds = new FhirDataSource(config);
    const result = await ds.getMedications("1");

    expect(result).toEqual([]);
  });

  it("getLabResults returns empty array when bundle has no entries", async () => {
    mockToken();
    mockPatientLookup("90cde167-511f-4f6d-bc97-b65a78cf1995");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(loadFixture("empty-bundle.json")),
    });

    const ds = new FhirDataSource(config);
    const result = await ds.getLabResults("1");

    expect(result).toEqual([]);
  });

  it("includes Bearer token in FHIR requests", async () => {
    mockFhirResponses();

    const ds = new FhirDataSource(config);
    await ds.getPatient("1");

    const fhirCalls = fetchMock.mock.calls.filter((c) =>
      c[0].includes("/Patient/") || c[0].includes("/Condition")
    );
    expect(fhirCalls.length).toBeGreaterThan(0);
    expect(fhirCalls[0][1].headers.Authorization).toBe("Bearer tok-123");
  });

  it("getPatient passes original pid to mapFhirPatient for display", async () => {
    mockFhirResponses();

    const ds = new FhirDataSource(config);
    const result = await ds.getPatient("1");

    expect(result.patient_id).toBe("1");
  });

  // SEC-005: FHIR timeout test
  it("throws timeout error when FHIR request takes too long", async () => {
    mockToken();
    mockPatientLookup("90cde167-511f-4f6d-bc97-b65a78cf1995");

    // Mock a fetch that respects AbortSignal
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("oauth2") && url.includes("token")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ access_token: "tok-123", expires_in: 3600 }),
        });
      }
      if (url.includes("/patient?pid=")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ uuid: "90cde167-511f-4f6d-bc97-b65a78cf1995" }),
        });
      }
      // Simulate abort for FHIR requests
      return new Promise((_resolve, reject) => {
        if (options?.signal) {
          const abortError = new Error("The operation was aborted");
          abortError.name = "AbortError";
          options.signal.addEventListener("abort", () => reject(abortError));
        }
      });
    });

    const ds = new FhirDataSource(config);

    // The FHIR timeout is 10s — use vi.useFakeTimers to speed this up
    vi.useFakeTimers();
    const promise = ds.getMedications("1");
    vi.advanceTimersByTime(11_000);
    vi.useRealTimers();

    await expect(promise).rejects.toThrow("FHIR request timed out");
  });

  // SEC-008: Error message sanitization test
  it("does not leak FHIR response body in error messages", async () => {
    mockToken();
    mockPatientLookup("90cde167-511f-4f6d-bc97-b65a78cf1995");

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal FHIR error with sensitive details: user=admin password=secret"),
    });

    const ds = new FhirDataSource(config);

    try {
      await ds.getMedications("1");
    } catch (err: any) {
      // Error message should only contain status code, not response body
      expect(err.message).toBe("FHIR request failed: 500");
      expect(err.message).not.toContain("sensitive");
      expect(err.message).not.toContain("password");
    }

    // But details should be logged internally
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("FHIR error details"),
      expect.stringContaining("sensitive")
    );
    consoleSpy.mockRestore();
  });
});
