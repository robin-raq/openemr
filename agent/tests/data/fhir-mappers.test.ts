import { describe, it, expect } from "vitest";
import {
  mapFhirPatient,
  mapFhirMedications,
  mapFhirLabResults,
} from "../../src/data/fhir-mappers";
import * as fs from "fs";
import * as path from "path";

const fixturesDir = path.join(__dirname, "fixtures");

function loadFixture<T>(name: string): T {
  const raw = fs.readFileSync(path.join(fixturesDir, name), "utf-8");
  return JSON.parse(raw) as T;
}

describe("fhir-mappers", () => {
  describe("mapFhirPatient", () => {
    it("maps Patient + bundles to PatientData with correct name", () => {
      const patient = loadFixture("patient.json");
      const conditions = loadFixture("condition-bundle.json");
      const meds = loadFixture("medication-request-bundle.json");
      const allergies = loadFixture("allergy-intolerance-bundle.json");

      const result = mapFhirPatient("1", patient, conditions, meds, allergies);

      expect(result.patient_id).toBe("1");
      expect(result.name).toBe("John Demo");
      expect(result.dob).toBe("1958-03-15");
      expect(result.gender).toBe("male");
    });

    it("maps conditions from Condition bundle", () => {
      const patient = loadFixture("patient.json");
      const conditions = loadFixture("condition-bundle.json");
      const meds = loadFixture("medication-request-bundle.json");
      const allergies = loadFixture("allergy-intolerance-bundle.json");

      const result = mapFhirPatient("1", patient, conditions, meds, allergies);

      expect(result.conditions).toContain("Atrial Fibrillation");
      expect(result.conditions).toContain("Hypertension");
      expect(result.conditions).toContain("Type 2 Diabetes");
      expect(result.conditions).toHaveLength(3);
    });

    it("maps allergies from AllergyIntolerance bundle", () => {
      const patient = loadFixture("patient.json");
      const conditions = loadFixture("condition-bundle.json");
      const meds = loadFixture("medication-request-bundle.json");
      const allergies = loadFixture("allergy-intolerance-bundle.json");

      const result = mapFhirPatient("1", patient, conditions, meds, allergies);

      expect(result.allergies).toContain("Penicillin");
      expect(result.allergies).toHaveLength(1);
    });

    it("maps medications summary from MedicationRequest bundle", () => {
      const patient = loadFixture("patient.json");
      const conditions = loadFixture("condition-bundle.json");
      const meds = loadFixture("medication-request-bundle.json");
      const allergies = loadFixture("allergy-intolerance-bundle.json");

      const result = mapFhirPatient("1", patient, conditions, meds, allergies);

      expect(result.medications).toHaveLength(3);
      expect(result.medications[0]).toEqual({
        name: "Warfarin",
        dose: "5mg",
        frequency: "daily",
      });
      expect(result.medications[1].name).toBe("Lisinopril");
      expect(result.medications[2].name).toBe("Metformin");
    });

    it("handles empty bundles", () => {
      const patient = loadFixture("patient.json");
      const empty = loadFixture("empty-bundle.json");

      const result = mapFhirPatient("99", patient, empty, empty, empty);

      expect(result.conditions).toEqual([]);
      expect(result.medications).toEqual([]);
      expect(result.allergies).toEqual([]);
    });

    it("handles missing optional fields in Patient", () => {
      const patient = { resourceType: "Patient" } as Parameters<
        typeof mapFhirPatient
      >[1];
      const empty = loadFixture("empty-bundle.json");

      const result = mapFhirPatient("x", patient, empty, empty, empty);

      expect(result.name).toBe("Unknown");
      expect(result.dob).toBe("");
      expect(result.gender).toBe("unknown");
    });
  });

  describe("mapFhirMedications", () => {
    it("maps MedicationRequest bundle to MedicationData[]", () => {
      const bundle = loadFixture("medication-request-bundle.json");

      const result = mapFhirMedications(bundle);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        name: "Warfarin",
        dose: "5mg",
        frequency: "daily",
        start_date: "2023-01-15",
        prescriber: "Dr. Smith",
        status: "active",
      });
      expect(result[1].name).toBe("Lisinopril");
      expect(result[1].prescriber).toBe("Dr. Smith");
      expect(result[2].name).toBe("Metformin");
      expect(result[2].prescriber).toBe("Dr. Johnson");
    });

    it("handles empty bundle", () => {
      const empty = loadFixture("empty-bundle.json");

      const result = mapFhirMedications(empty);

      expect(result).toEqual([]);
    });

    it("handles medicationCodeableConcept with Reference (display fallback)", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "MedicationRequest",
              medicationReference: { display: "Aspirin" },
              dosageInstruction: [],
            },
          },
        ],
      };

      const result = mapFhirMedications(bundle);

      expect(result[0].name).toBe("Aspirin");
    });
  });

  describe("mapFhirLabResults", () => {
    it("maps Observation bundle to LabResult[] with correct flag mapping", () => {
      const bundle = loadFixture("observation-bundle.json");

      const result = mapFhirLabResults(bundle);

      expect(result).toHaveLength(4);

      const inr = result.find((r) => r.test_name === "INR");
      expect(inr?.value).toBe(2.5);
      expect(inr?.unit).toBe("");
      expect(inr?.reference_range).toBe("2-3");
      expect(inr?.flag).toBe("normal");
      expect(inr?.date).toBe("2024-01-10");

      const hba1c = result.find((r) => r.test_name === "HbA1c");
      expect(hba1c?.flag).toBe("abnormal");

      const potassium = result.find((r) => r.test_name === "Potassium");
      expect(potassium?.flag).toBe("critical");
    });

    it("maps interpretation N to normal, H/L to abnormal, HH/LL to critical", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Observation",
              code: { text: "A" },
              valueQuantity: { value: 1, unit: "" },
              interpretation: [{ coding: [{ code: "N" }] }],
            },
          },
          {
            resource: {
              resourceType: "Observation",
              code: { text: "B" },
              valueQuantity: { value: 2, unit: "" },
              interpretation: [{ coding: [{ code: "H" }] }],
            },
          },
          {
            resource: {
              resourceType: "Observation",
              code: { text: "C" },
              valueQuantity: { value: 3, unit: "" },
              interpretation: [{ coding: [{ code: "HH" }] }],
            },
          },
        ],
      };

      const result = mapFhirLabResults(bundle);

      expect(result[0].flag).toBe("normal");
      expect(result[1].flag).toBe("abnormal");
      expect(result[2].flag).toBe("critical");
    });

    it("handles empty bundle", () => {
      const empty = loadFixture("empty-bundle.json");

      const result = mapFhirLabResults(empty);

      expect(result).toEqual([]);
    });

    it("handles missing interpretation (defaults to normal)", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Observation",
              code: { text: "Test" },
              valueQuantity: { value: 42, unit: "mg" },
            },
          },
        ],
      };

      const result = mapFhirLabResults(bundle);

      expect(result[0].flag).toBe("normal");
    });
  });
});
