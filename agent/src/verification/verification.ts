const MEDICAL_DISCLAIMER =
  "\n\n⚕️ This information is for reference only and does not constitute medical advice. Always consult a healthcare provider.";

const PATIENT_TOOLS = new Set([
  "get_patient_summary",
  "get_medications",
  "allergy_check",
  "get_lab_results",
]);
const FDA_TOOLS = new Set(["drug_interaction_check"]);

function buildSourceCitation(
  toolCalls: Array<{ name: string; args: unknown; result?: string }>
): string {
  const sources: string[] = [];

  const usedPatientTool = toolCalls.some((tc) => PATIENT_TOOLS.has(tc.name));
  const usedFdaTool = toolCalls.some((tc) => FDA_TOOLS.has(tc.name));

  if (usedPatientTool) sources.push("OpenEMR Patient Records");
  if (usedFdaTool) sources.push("OpenFDA");

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
  }

  let finalResponse = response;
  if (safetyAlerts.length > 0) {
    finalResponse = safetyAlerts.join("\n\n") + "\n\n" + finalResponse;
  }
  finalResponse += buildSourceCitation(toolCalls) + MEDICAL_DISCLAIMER;

  return {
    response: finalResponse,
    safetyAlerts,
    toolCalls,
  };
}
