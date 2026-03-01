import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MAX_MEDICATIONS_FOR_FDA, FDA_API_TIMEOUT_MS } from "../constants";

const KNOWN_INTERACTIONS = [
  {
    drugs: ["warfarin", "aspirin"],
    severity: "serious",
    description:
      "Increased risk of bleeding. Aspirin may enhance the anticoagulant effect of warfarin.",
    source: "fallback_db",
  },
  {
    drugs: ["warfarin", "omeprazole"],
    severity: "moderate",
    description:
      "Omeprazole may increase the anticoagulant effect of warfarin by inhibiting CYP2C19.",
    source: "fallback_db",
  },
  {
    drugs: ["lisinopril", "potassium"],
    severity: "serious",
    description:
      "Risk of hyperkalemia. ACE inhibitors can increase potassium levels.",
    source: "fallback_db",
  },
  {
    drugs: ["metformin", "alcohol"],
    severity: "serious",
    description:
      "Increased risk of lactic acidosis when metformin is combined with alcohol.",
    source: "fallback_db",
  },
];

function normalizeDrug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s*\d+(\.\d+)?\s*(mg|mcg|ml|g|iu|units?|%)\s*/gi, "")
    .trim();
}

function findInteractions(medications: string[]): typeof KNOWN_INTERACTIONS {
  const normalized = medications.map(normalizeDrug);
  return KNOWN_INTERACTIONS.filter((ki) => {
    const match1 = normalized.some((n) => ki.drugs[0] === n || n.includes(ki.drugs[0]));
    const match2 = normalized.some((n) => ki.drugs[1] === n || n.includes(ki.drugs[1]));
    return match1 && match2;
  });
}

export function drugInteractionCheck() {
  return tool(
    async ({ medications }) => {
      if (!medications || medications.length < 2) {
        return JSON.stringify({
          interactions: [],
          note: "Need at least 2 medications to check for interactions",
        });
      }

      const fallbackInteractions = findInteractions(medications).map((ki) => ({
        drugs: ki.drugs,
        drug_pair: ki.drugs.join(" + "),
        severity: ki.severity,
        description: ki.description,
        source: ki.source,
      }));

      // Skip FDA API if too many meds (would generate too many pairs)
      if (medications.length > MAX_MEDICATIONS_FOR_FDA) {
        return JSON.stringify({
          interactions: fallbackInteractions,
          note: fallbackInteractions.length === 0
            ? "No known interactions found (used fallback database — too many medications for live API check)"
            : "Used fallback database — too many medications for live API check",
        });
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FDA_API_TIMEOUT_MS);

        try {
          const pairs: [string, string][] = [];
          for (let i = 0; i < medications.length; i++) {
            for (let j = i + 1; j < medications.length; j++) {
              pairs.push([medications[i], medications[j]]);
            }
          }

          let interactions: Array<{
            drugs: string[];
            drug_pair: string;
            severity: string;
            description: string;
            source: string;
          }> = [...fallbackInteractions];

          if (interactions.length === 0) {
            // Parallelize FDA API calls for all drug pairs
            const fdaResults = await Promise.all(
              pairs.map(async ([drug1, drug2]) => {
                const n1 = normalizeDrug(drug1);
                const n2 = normalizeDrug(drug2);
                const url = `https://api.fda.gov/drug/label.json?search=drug_interactions:"${encodeURIComponent(n1)}"+AND+drug_interactions:"${encodeURIComponent(n2)}"&limit=1`;
                try {
                  const res = await fetch(url, { signal: controller.signal });
                  if (res.ok) {
                    const json = await res.json();
                    if (json.results && json.results.length > 0) {
                      const label = json.results[0];
                      const drugInteractions = label.drug_interactions || [];
                      return drugInteractions.map((di: unknown) => ({
                        drugs: [drug1, drug2],
                        drug_pair: `${drug1} + ${drug2}`,
                        severity: "moderate",
                        description: typeof di === "string" ? di : (di as any).description || String(di),
                        source: "openfda",
                      }));
                    }
                  }
                } catch (err) {
                  console.warn(`OpenFDA lookup failed for pair [${drug1}, ${drug2}]:`, err);
                }
                return [];
              })
            );
            for (const results of fdaResults) {
              interactions.push(...results);
            }
          }

          if (interactions.length === 0) {
            return JSON.stringify({
              interactions: [],
              note: "No known interactions found",
            });
          }

          return JSON.stringify({ interactions });
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        // QUAL-002: Log FDA API unavailability instead of silently swallowing
        console.warn("OpenFDA API unavailable, using fallback DB:", err);
        return JSON.stringify({
          interactions: fallbackInteractions,
          note: fallbackInteractions.length === 0 ? "No known interactions found" : undefined,
        });
      }
    },
    {
      name: "drug_interaction_check",
      description:
        "Check for known drug interactions between two or more medications. Use this when the user asks about drug safety, interactions, or whether it's safe to combine medications.",
      schema: z.object({
        medications: z
          .array(z.string())
          .describe("List of medication names to check for interactions"),
      }),
    }
  );
}
