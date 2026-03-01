const MEDICAL_DISCLAIMER =
  "\n\n⚕️ This information is for reference only and does not constitute medical advice. Always consult a healthcare provider.";

// ADV-002: Detect prescriptive language that slipped past the system prompt guardrails
const PRESCRIPTIVE_PATTERNS: RegExp[] = [
  /\bI (?:have )?prescribe[d]?\b/i,
  /\bI (?:have )?ordered\b/i,
  /\bI (?:have )?(?:placed an order|submitted an order)\b/i,
  /\byou should (?:take|start|begin|try|use)\b/i,
  /\bI (?:recommend|suggest|advise) (?:you |that you )?(?:take|start|begin|try|use)\b/i,
  /\b(?:start|begin) taking\b/i,
  /\bdose (?:has been|was) (?:increased|decreased|changed|modified)\b/i,
  /\b(?:has been|was) (?:finalized|approved) (?:and saved |to (?:the )?chart)/i,
  /\bI (?:have )?(?:discontinued|stopped|removed) (?:the |your )?(?:medication|warfarin|lisinopril|metformin|insulin|aspirin|metoprolol|amlodipine|heparin)/i,
];

export function detectPrescriptiveLanguage(response: string): boolean {
  return PRESCRIPTIVE_PATTERNS.some((p) => p.test(response));
}

import { PATIENT_TOOLS, FDA_TOOLS, DAILYMED_TOOLS } from "../constants";

function buildSourceCitation(
  toolCalls: Array<{ name: string; args: unknown; result?: string }>
): string {
  const sources: string[] = [];

  const usedPatientTool = toolCalls.some((tc) => PATIENT_TOOLS.has(tc.name));
  const usedFdaTool = toolCalls.some((tc) => FDA_TOOLS.has(tc.name));
  const usedDailyMedTool = toolCalls.some((tc) => DAILYMED_TOOLS.has(tc.name));

  if (usedPatientTool) sources.push("OpenEMR Patient Records");
  if (usedFdaTool) sources.push("OpenFDA");
  if (usedDailyMedTool) sources.push("DailyMed (NLM/NIH)");

  if (sources.length === 0) {
    return "\n\nSources: Clinical knowledge base";
  }

  return `\n\nSources: ${sources.join(", ")}`;
}

export interface VerificationResult {
  response: string;
  safetyAlerts: string[];
  toolCalls: Array<{ name: string; args: unknown; result?: string }>;
}

export function applyVerification(
  response: string,
  toolCalls: Array<{ name: string; args: unknown; result?: string }>
): VerificationResult {
  const safetyAlerts: string[] = [];

  for (const tc of toolCalls) {
    if (tc.name === "drug_interaction_check" && tc.result) {
      try {
        const data = JSON.parse(tc.result);
        const interactions = data.interactions || [];
        for (const i of interactions) {
          if (
            (i.severity === "serious" || i.severity === "critical") &&
            i.description
          ) {
            safetyAlerts.push(
              `⚠️ SAFETY ALERT: ${i.description}`
            );
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (tc.name === "allergy_check" && tc.result) {
      try {
        const data = JSON.parse(tc.result);
        if (data.safe === false && data.conflicts?.length > 0) {
          for (const conflict of data.conflicts) {
            safetyAlerts.push(
              `⚠️ ALLERGY ALERT: ${conflict.allergen} allergy — ${conflict.proposed_medication} may cause cross-reaction (${conflict.reason})`
            );
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (tc.name === "get_lab_results" && tc.result) {
      try {
        const data = JSON.parse(tc.result);
        if (data.critical_count > 0 && data.results) {
          for (const lab of data.results) {
            if (lab.flag === "critical") {
              safetyAlerts.push(
                `⚠️ CRITICAL LAB: ${lab.test_name} = ${lab.value} ${lab.unit} (ref: ${lab.reference_range})`
              );
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (tc.name === "reconcile_medications" && tc.result) {
      try {
        const data = JSON.parse(tc.result);
        if (data.reconciliation?.modified?.length > 0) {
          for (const med of data.reconciliation.modified) {
            safetyAlerts.push(
              `⚠️ MEDICATION CHANGE: ${med.name} changed from ${med.original_dose} ${med.original_frequency} to ${med.dose} ${med.frequency} — ${med.modification_reason}`
            );
          }
        }
        if (data.reconciliation?.new_medications?.length > 0) {
          for (const med of data.reconciliation.new_medications) {
            safetyAlerts.push(
              `⚠️ NEW MEDICATION: ${med.name} ${med.dose} ${med.frequency} — ${med.modification_reason}`
            );
          }
        }
        if (data.reconciliation?.discontinued?.length > 0) {
          for (const med of data.reconciliation.discontinued) {
            safetyAlerts.push(
              `⚠️ DISCONTINUED: ${med.name} — ${med.modification_reason}`
            );
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (tc.name === "draft_discharge_summary" && tc.result) {
      try {
        const data = JSON.parse(tc.result);
        if (data.safety_flags?.has_critical_labs && data.labs_at_discharge?.critical) {
          for (const lab of data.labs_at_discharge.critical) {
            safetyAlerts.push(
              `⚠️ CRITICAL LAB AT DISCHARGE: ${lab.test_name} = ${lab.value} ${lab.unit} (ref: ${lab.reference_range})`
            );
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (tc.name === "generate_discharge_instructions" && tc.result) {
      try {
        const data = JSON.parse(tc.result);
        if (data.new_medications?.length > 0) {
          for (const med of data.new_medications) {
            safetyAlerts.push(
              `⚠️ NEW MEDICATION FOR PATIENT: ${med.name} ${med.dose} ${med.frequency} — ${med.reason}`
            );
          }
        }
        if (data.modified_medications?.length > 0) {
          for (const med of data.modified_medications) {
            safetyAlerts.push(
              `⚠️ MEDICATION DOSE CHANGED: ${med.name} changed from ${med.previous_dose} to ${med.new_dose} — ${med.reason}`
            );
          }
        }
        if (data.discontinued_medications?.length > 0) {
          for (const med of data.discontinued_medications) {
            safetyAlerts.push(
              `⚠️ MEDICATION STOPPED: ${med.name} — ${med.reason}`
            );
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (tc.name === "save_to_chart" && tc.result) {
      try {
        const data = JSON.parse(tc.result);
        if (data.success) {
          safetyAlerts.push(
            `📋 DRAFT SAVED: Document ${data.document_id} saved as draft. Clinician review required before finalizing.`
          );
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // ADV-002: Post-LLM check for prescriptive language that slipped through
  if (detectPrescriptiveLanguage(response)) {
    safetyAlerts.push(
      "⚠️ SCOPE WARNING: Response may contain prescriptive language. This system provides data retrieval only — not medical recommendations."
    );
    console.warn("ADV-002: Prescriptive language detected in response");
  }

  let finalResponse = response;
  // Safety alerts are returned separately in safetyAlerts array
  // and rendered as yellow banners by the UI — don't prepend to response text
  finalResponse += buildSourceCitation(toolCalls) + MEDICAL_DISCLAIMER;

  return {
    response: finalResponse,
    safetyAlerts,
    toolCalls,
  };
}
