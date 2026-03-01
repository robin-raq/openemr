import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DataSource } from "../data/datasource";
import { getDrugEducation, DISCHARGE_EDUCATION_SECTIONS } from "../data/dailymed-client";
import { getErrorMessage } from "../utils/errors";
import { DRUG_EDUCATION_TIMEOUT_MS, DRUG_EDUCATION_TOTAL_TIMEOUT_MS } from "../constants";

/**
 * Condition-based warning signs for patients (layman-friendly).
 * These are curated, clinically vetted defaults the LLM can rephrase.
 */
const CONDITION_WARNING_SIGNS: Record<string, string[]> = {
  "Atrial Fibrillation": [
    "Rapid or irregular heartbeat that does not settle",
    "Dizziness, fainting, or feeling lightheaded",
    "Chest pain or pressure",
    "Shortness of breath at rest or with mild activity",
    "Unusual fatigue or weakness",
  ],
  Hypertension: [
    "Severe headache that does not go away",
    "Vision changes or blurred vision",
    "Chest pain",
    "Difficulty breathing",
    "Nosebleeds that are hard to stop",
  ],
  "Type 2 Diabetes": [
    "Blood sugar readings above 300 mg/dL or below 70 mg/dL",
    "Excessive thirst or frequent urination",
    "Nausea, vomiting, or stomach pain",
    "Confusion or difficulty staying awake",
    "Fruity-smelling breath",
  ],
  Hyperlipidemia: [
    "Unexplained muscle pain or weakness (may indicate statin side effect)",
    "Dark-colored urine",
  ],
  GERD: [
    "Difficulty swallowing or pain when swallowing",
    "Vomiting blood or dark, tarry stools",
    "Unintended weight loss",
    "Persistent heartburn not relieved by medication",
  ],
};

/**
 * Condition-based follow-up guidance for patients.
 */
const CONDITION_FOLLOW_UP: Record<string, string[]> = {
  "Atrial Fibrillation": [
    "Follow up with your cardiologist within 1-2 weeks",
    "Have your heart rhythm and rate checked at your follow-up",
    "Get regular blood tests (INR) if taking a blood thinner",
  ],
  Hypertension: [
    "Check your blood pressure at home daily and keep a log",
    "Follow up with your primary care provider within 1 week",
    "Reduce salt intake and maintain a heart-healthy diet",
  ],
  "Type 2 Diabetes": [
    "Check your blood sugar as directed by your doctor",
    "Follow up with your primary care provider within 1-2 weeks",
    "Follow your diabetic diet and monitor carbohydrate intake",
  ],
  Hyperlipidemia: [
    "Follow up for a fasting lipid panel in 4-6 weeks",
    "Maintain a low-fat, low-cholesterol diet",
  ],
  GERD: [
    "Avoid trigger foods (spicy, acidic, fatty foods)",
    "Do not lie down within 2-3 hours of eating",
  ],
};

export function generateDischargeInstructions(dataSource: DataSource) {
  return tool(
    async ({ patient_id, encounter_id }) => {
      try {
        const [patient, encounters, admissionMeds, appointments] = await Promise.all([
          dataSource.getPatient(patient_id),
          dataSource.getEncounters(patient_id),
          dataSource.getAdmissionMedications(encounter_id),
          dataSource.getAppointments(patient_id),
        ]);

        const encounter = encounters.find(
          (e) => e.encounter_id === encounter_id
        );
        if (!encounter) {
          return JSON.stringify({
            error: `Encounter not found: ${encounter_id}`,
          });
        }

        // Categorize medications
        const newMeds = admissionMeds
          .filter((m) => m.status === "new")
          .map((m) => ({
            name: m.name,
            dose: m.dose,
            frequency: m.frequency,
            reason: m.modification_reason ?? "Prescribed during hospital stay",
          }));

        const modifiedMeds = admissionMeds
          .filter((m) => m.status === "modified")
          .map((m) => ({
            name: m.name,
            previous_dose: m.original_dose,
            previous_frequency: m.original_frequency,
            new_dose: m.dose,
            new_frequency: m.frequency,
            reason: m.modification_reason ?? "Adjusted during hospital stay",
          }));

        const continuedMeds = admissionMeds
          .filter((m) => m.status === "continued")
          .map((m) => ({
            name: m.name,
            dose: m.dose,
            frequency: m.frequency,
          }));

        const discontinuedMeds = admissionMeds
          .filter((m) => m.status === "discontinued")
          .map((m) => ({
            name: m.name,
            reason: m.modification_reason ?? "Stopped during hospital stay",
          }));

        // Fetch DailyMed drug education for new and modified medications
        const medNamesForEducation = [
          ...newMeds.map((m) => m.name),
          ...modifiedMeds.map((m) => m.name),
        ];
        const drugEducation: Record<string, {
          indications: string | null;
          adverse_reactions: string | null;
          warnings: string | null;
        }> = {};

        // Truncate long DailyMed text to save context window tokens
        const truncateText = (s: string | null, max = 300): string | null =>
          s && s.length > max ? s.slice(0, max) + "..." : s;

        // Fetch in parallel with per-drug timeout circuit breaker

        const educationPromises = medNamesForEducation.map(async (name) => {
          try {
            const result = await Promise.race([
              getDrugEducation(name, DISCHARGE_EDUCATION_SECTIONS),
              new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), DRUG_EDUCATION_TIMEOUT_MS)
              ),
            ]);
            if (result) {
              drugEducation[name] = {
                indications: truncateText(result.indications),
                adverse_reactions: truncateText(result.adverse_reactions),
                warnings: truncateText(result.warnings),
              };
            }
          } catch {
            // DailyMed unavailable for this drug — continue without it
            console.warn(`DailyMed education lookup failed for ${name}`);
          }
        });

        // Overall timeout for all drug education lookups
        await Promise.race([
          Promise.all(educationPromises),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              console.warn("DailyMed education lookups exceeded total timeout, continuing without remaining");
              resolve();
            }, DRUG_EDUCATION_TOTAL_TIMEOUT_MS)
          ),
        ]);

        // Build warning signs from conditions + diagnoses
        const allConditions = [
          ...new Set([
            ...patient.conditions,
            ...encounter.diagnoses.map((d) => {
              for (const key of Object.keys(CONDITION_WARNING_SIGNS)) {
                if (d.toLowerCase().includes(key.toLowerCase())) {
                  return key;
                }
              }
              return d;
            }),
          ]),
        ];

        const warningSignSet = new Set<string>();
        for (const condition of allConditions) {
          const signs = CONDITION_WARNING_SIGNS[condition];
          if (signs) signs.forEach((s) => warningSignSet.add(s));
        }
        warningSignSet.add("Fever above 101.5\u00B0F (38.6\u00B0C)");
        warningSignSet.add("New or worsening symptoms that concern you");

        const followUpSet = new Set<string>();
        for (const condition of allConditions) {
          const guidance = CONDITION_FOLLOW_UP[condition];
          if (guidance) guidance.forEach((g) => followUpSet.add(g));
        }
        followUpSet.add(
          "Call 911 or go to the emergency room if you experience a medical emergency"
        );
        followUpSet.add(
          "Contact your primary care provider if you have questions about your medications"
        );

        // Filter out cancelled appointments and sort by date
        const scheduledAppointments = appointments
          .filter((a) => a.status !== "cancelled")
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((a) => ({
            provider: a.provider,
            specialty: a.specialty,
            date: a.date,
            time: a.time,
            location: a.location,
            reason: a.reason,
          }));

        return JSON.stringify({
          type: "discharge_instructions",
          patient: {
            name: patient.name,
            patient_id: patient.patient_id,
            conditions: patient.conditions,
          },
          encounter: {
            encounter_id: encounter.encounter_id,
            admission_reason: encounter.admission_reason,
            admission_date: encounter.admission_date,
            discharge_date: encounter.discharge_date ?? "Pending",
            attending_provider: encounter.attending_provider,
            diagnoses: encounter.diagnoses,
          },
          new_medications: newMeds,
          modified_medications: modifiedMeds,
          continued_medications: continuedMeds,
          discontinued_medications: discontinuedMeds,
          drug_education: drugEducation,
          allergy_reminders: patient.allergies,
          warning_signs: [...warningSignSet],
          follow_up_guidance: [...followUpSet],
          scheduled_appointments: scheduledAppointments,
          safety_flags: {
            has_new_medications: newMeds.length > 0,
            has_modified_medications: modifiedMeds.length > 0,
            has_discontinued_medications: discontinuedMeds.length > 0,
            total_discharge_medications: admissionMeds.filter(
              (m) => m.status !== "discontinued"
            ).length,
          },
          data_source: "OpenEMR + DailyMed",
        });
      } catch (err) {
        return JSON.stringify({
          error: `Discharge instructions generation failed: ${getErrorMessage(err)}`,
        });
      }
    },
    {
      name: "generate_discharge_instructions",
      description:
        "Generate patient-friendly discharge instructions in layman's terms for a specific encounter. Returns medication changes (new, modified, continued, discontinued) with drug education from DailyMed, follow-up guidance, warning signs, and allergy reminders. Use this when a user asks for patient discharge instructions, follow-up care in plain language, or take-home medication instructions.",
      schema: z.object({
        patient_id: z.string().describe("The patient ID"),
        encounter_id: z
          .string()
          .describe(
            "The encounter/admission ID to generate discharge instructions for"
          ),
      }),
    }
  );
}
