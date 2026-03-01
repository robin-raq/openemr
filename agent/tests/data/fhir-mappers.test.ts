import { describe, it, expect } from "vitest";
import {
  mapFhirPatient,
  mapFhirMedications,
  mapFhirLabResults,
  mapFhirVitalSigns,
  mapFhirEncounters,
  mapFhirAdmissionMedications,
  mapFhirAppointments,
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

    it("includes vitals when vitals bundle is provided", () => {
      const patient = loadFixture("patient.json");
      const conditions = loadFixture("condition-bundle.json");
      const meds = loadFixture("medication-request-bundle.json");
      const allergies = loadFixture("allergy-intolerance-bundle.json");
      const vitals = loadFixture("vital-signs-bundle.json");

      const result = mapFhirPatient("1", patient, conditions, meds, allergies, vitals);

      expect(result.vitals).toBeDefined();
      expect(result.vitals!.length).toBe(4);
      const bp = result.vitals!.find((v) => v.name === "Blood Pressure");
      expect(bp?.value).toBe("145/92");
      expect(bp?.unit).toBe("mmHg");
    });

    it("returns empty vitals when no vitals bundle provided", () => {
      const patient = loadFixture("patient.json");
      const conditions = loadFixture("condition-bundle.json");
      const meds = loadFixture("medication-request-bundle.json");
      const allergies = loadFixture("allergy-intolerance-bundle.json");

      const result = mapFhirPatient("1", patient, conditions, meds, allergies);

      expect(result.vitals).toEqual([]);
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

  describe("mapFhirVitalSigns", () => {
    it("maps vital signs bundle with BP component pattern", () => {
      const bundle = loadFixture("vital-signs-bundle.json");

      const result = mapFhirVitalSigns(bundle);

      expect(result).toHaveLength(4);
      const bp = result.find((v) => v.name === "Blood Pressure");
      expect(bp).toBeDefined();
      expect(bp!.value).toBe("145/92");
      expect(bp!.unit).toBe("mmHg");
      expect(bp!.status).toBe("abnormal");
      expect(bp!.date).toBe("2024-01-10");
    });

    it("maps simple vital signs (HR, Temp, SpO2)", () => {
      const bundle = loadFixture("vital-signs-bundle.json");

      const result = mapFhirVitalSigns(bundle);

      const hr = result.find((v) => v.name === "Heart Rate");
      expect(hr!.value).toBe("78");
      expect(hr!.unit).toBe("bpm");
      expect(hr!.status).toBe("normal");

      const spo2 = result.find((v) => v.name === "SpO2");
      expect(spo2!.value).toBe("98");
      expect(spo2!.unit).toBe("%");
    });

    it("handles empty bundle", () => {
      const empty = loadFixture("empty-bundle.json");

      const result = mapFhirVitalSigns(empty);

      expect(result).toEqual([]);
    });
  });

  describe("mapFhirEncounters", () => {
    it("maps FHIR Encounter bundle to EncounterData[]", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              id: "enc-1",
              status: "finished",
              class: { code: "IMP" },
              period: { start: "2024-01-05", end: "2024-01-10" },
              reasonCode: [{ text: "Atrial Fibrillation with RVR" }],
              diagnosis: [
                { condition: { display: "AFib" } },
                { condition: { display: "Hypertension" } },
              ],
              participant: [
                {
                  individual: { display: "Dr. Smith" },
                  type: [{ coding: [{ code: "ATND" }] }],
                },
              ],
            },
          },
        ],
      };

      const result = mapFhirEncounters("1", bundle);

      expect(result).toHaveLength(1);
      expect(result[0].encounter_id).toBe("enc-1");
      expect(result[0].patient_id).toBe("1");
      expect(result[0].type).toBe("inpatient");
      expect(result[0].status).toBe("discharged");
      expect(result[0].attending_provider).toBe("Dr. Smith");
      expect(result[0].admission_reason).toBe("Atrial Fibrillation with RVR");
      expect(result[0].diagnoses).toEqual(["AFib", "Hypertension"]);
    });

    it("maps encounter class codes to types correctly", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          { resource: { id: "e1", class: { code: "IMP" }, period: {} } },
          { resource: { id: "e2", class: { code: "EMER" }, period: {} } },
          { resource: { id: "e3", class: { code: "AMB" }, period: {} } },
        ],
      };

      const result = mapFhirEncounters("1", bundle);

      expect(result[0].type).toBe("inpatient");
      expect(result[1].type).toBe("emergency");
      expect(result[2].type).toBe("outpatient");
    });

    it("maps encounter status correctly", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          { resource: { id: "e1", status: "in-progress", period: {} } },
          { resource: { id: "e2", status: "finished", period: {} } },
          { resource: { id: "e3", status: "arrived", period: {} } },
        ],
      };

      const result = mapFhirEncounters("1", bundle);

      expect(result[0].status).toBe("active");
      expect(result[1].status).toBe("discharged");
      expect(result[2].status).toBe("active");
    });

    it("handles empty bundle", () => {
      const result = mapFhirEncounters("1", { entry: [] });

      expect(result).toEqual([]);
    });
  });

  describe("mapFhirAdmissionMedications", () => {
    it("maps MedicationRequest statuses to admission medication categories", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              medicationCodeableConcept: { text: "Lisinopril" },
              dosageInstruction: [{ doseAndRate: [{ doseQuantity: { value: 10, unit: "mg" } }], timing: { code: { text: "daily" } } }],
              status: "active",
            },
          },
          {
            resource: {
              medicationCodeableConcept: { text: "Metformin" },
              dosageInstruction: [{ doseAndRate: [{ doseQuantity: { value: 500, unit: "mg" } }], timing: { code: { text: "BID" } } }],
              status: "stopped",
            },
          },
          {
            resource: {
              medicationCodeableConcept: { text: "Metoprolol" },
              dosageInstruction: [{ doseAndRate: [{ doseQuantity: { value: 25, unit: "mg" } }], timing: { code: { text: "BID" } } }],
              status: "draft",
            },
          },
        ],
      };

      const result = mapFhirAdmissionMedications(bundle);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ name: "Lisinopril", status: "continued" });
      expect(result[1]).toMatchObject({ name: "Metformin", status: "discontinued" });
      expect(result[2]).toMatchObject({ name: "Metoprolol", status: "new" });
    });

    it("maps cancelled status to discontinued", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              medicationCodeableConcept: { text: "Drug A" },
              dosageInstruction: [],
              status: "cancelled",
            },
          },
        ],
      };

      const result = mapFhirAdmissionMedications(bundle);

      expect(result[0].status).toBe("discontinued");
    });

    it("handles empty bundle", () => {
      const result = mapFhirAdmissionMedications({ entry: [] });

      expect(result).toEqual([]);
    });
  });

  describe("mapFhirAppointments", () => {
    it("maps FHIR Appointment bundle to Appointment[]", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              id: "appt-1",
              status: "booked",
              start: "2024-01-24T10:00:00Z",
              serviceType: [{ text: "Cardiology" }],
              reasonCode: [{ text: "Atrial fibrillation follow-up" }],
              participant: [
                {
                  actor: { reference: "Practitioner/123", display: "Dr. Patel" },
                  type: [{ coding: [{ code: "ATND" }] }],
                },
                {
                  actor: { reference: "Location/456", display: "Heart Center, Suite 200" },
                },
              ],
            },
          },
        ],
      };

      const result = mapFhirAppointments("1", bundle);

      expect(result).toHaveLength(1);
      expect(result[0].appointment_id).toBe("appt-1");
      expect(result[0].patient_id).toBe("1");
      expect(result[0].provider).toBe("Dr. Patel");
      expect(result[0].specialty).toBe("Cardiology");
      expect(result[0].date).toBe("2024-01-24");
      expect(result[0].reason).toBe("Atrial fibrillation follow-up");
      expect(result[0].status).toBe("scheduled");
      expect(result[0].location).toBe("Heart Center, Suite 200");
    });

    it("maps appointment statuses correctly", () => {
      const bundle = {
        resourceType: "Bundle",
        entry: [
          { resource: { id: "a1", status: "booked", start: "2024-01-20T10:00:00Z" } },
          { resource: { id: "a2", status: "cancelled", start: "2024-01-21T10:00:00Z" } },
          { resource: { id: "a3", status: "fulfilled", start: "2024-01-22T10:00:00Z" } },
        ],
      };

      const result = mapFhirAppointments("1", bundle);

      expect(result[0].status).toBe("scheduled");
      expect(result[1].status).toBe("cancelled");
      expect(result[2].status).toBe("completed");
    });

    it("handles empty bundle", () => {
      const result = mapFhirAppointments("1", { entry: [] });

      expect(result).toEqual([]);
    });
  });
});
