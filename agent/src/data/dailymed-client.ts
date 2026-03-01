/**
 * DailyMed API Client
 *
 * Fetches drug label information from the NLM DailyMed REST API.
 * This is the NEW external data source for the bounty.
 *
 * API docs: https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm
 * Base URL: https://dailymed.nlm.nih.gov/dailymed/services/v2/
 */

import { getErrorMessage } from "../utils/errors";
import { TtlCache } from "../cache";

const DAILYMED_BASE_URL =
  "https://dailymed.nlm.nih.gov/dailymed/services/v2";
const REQUEST_TIMEOUT_MS = 10_000;

/** 24-hour TTL for DailyMed data — drug labels are essentially static. */
const DAILYMED_CACHE_TTL_MS = 86_400_000;
/** Max 200 cached drug entries with LRU eviction. */
const DAILYMED_CACHE_MAX_ENTRIES = 200;

/**
 * Module-level singleton cache for DailyMed lookups.
 * DailyMed data is globally static (not per-patient), so a shared cache is appropriate.
 */
const dailymedSearchCache = new TtlCache<DailyMedSearchResult[]>({
  ttlMs: DAILYMED_CACHE_TTL_MS,
  maxEntries: DAILYMED_CACHE_MAX_ENTRIES,
});

const dailymedEducationCache = new TtlCache<DrugEducationInfo | null>({
  ttlMs: DAILYMED_CACHE_TTL_MS,
  maxEntries: DAILYMED_CACHE_MAX_ENTRIES,
});

/** Clear all DailyMed caches. Useful for testing. */
export function clearDailyMedCache(): void {
  dailymedSearchCache.clear();
  dailymedEducationCache.clear();
}

/** LOINC section codes for SPL label sections */
const SPL_SECTION_CODES = {
  INDICATIONS: "34067-9",
  DOSAGE_ADMIN: "34068-7",
  WARNINGS_PRECAUTIONS: "43685-7",
  ADVERSE_REACTIONS: "34084-4",
  CONTRAINDICATIONS: "34070-3",
  DRUG_INTERACTIONS: "34073-7",
  PATIENT_COUNSELING: "34076-0",
  BOXED_WARNING: "34066-1",
} as const;

export interface DailyMedSearchResult {
  setid: string;
  title: string;
  published_date: string;
  spl_version: number;
}

export interface DrugLabelSection {
  code: string;
  title: string;
  text: string;
}

export interface DrugEducationInfo {
  drug_name: string;
  setid: string;
  title: string;
  indications: string | null;
  warnings: string | null;
  adverse_reactions: string | null;
  dosage_administration: string | null;
  contraindications: string | null;
  drug_interactions: string | null;
  patient_counseling: string | null;
  boxed_warning: string | null;
  source: "DailyMed (NLM/NIH)";
  fetched_at: string;
}

/**
 * Search DailyMed for a drug by name.
 * Returns the top matching SPL entries.
 */
export async function searchDrug(
  drugName: string,
  pageSize = 3
): Promise<DailyMedSearchResult[]> {
  const cacheKey = `${drugName.toLowerCase()}:${pageSize}`;
  const cached = dailymedSearchCache.get(cacheKey);
  if (cached) return cached;

  const url = `${DAILYMED_BASE_URL}/spls.json?drug_name=${encodeURIComponent(drugName)}&pagesize=${pageSize}`;

  const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`DailyMed search failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  const results = (data.data || []).map(
    (entry: {
      setid: string;
      title: string;
      published_date: string;
      spl_version: number;
    }) => ({
      setid: entry.setid,
      title: entry.title,
      published_date: entry.published_date,
      spl_version: entry.spl_version,
    })
  );
  dailymedSearchCache.set(cacheKey, results);
  return results;
}

/**
 * Fetch the full SPL label for a drug by its setid.
 * Parses the XML to extract key patient-relevant sections.
 */
export async function getDrugLabel(
  setid: string
): Promise<DrugLabelSection[]> {
  const url = `${DAILYMED_BASE_URL}/spls/${encodeURIComponent(setid)}.xml`;

  const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`DailyMed label fetch failed: HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseSplSections(xml);
}

/** Default sections for patient-facing discharge education (smaller payload). */
export const DISCHARGE_EDUCATION_SECTIONS = new Set([
  SPL_SECTION_CODES.INDICATIONS,
  SPL_SECTION_CODES.ADVERSE_REACTIONS,
  SPL_SECTION_CODES.WARNINGS_PRECAUTIONS,
]);

/**
 * High-level function: search for a drug and return patient-education info.
 * Combines search + label fetch into one call.
 *
 * Pass `onlySections` to limit which SPL sections are returned (saves tokens).
 */
export async function getDrugEducation(
  drugName: string,
  onlySections?: Set<string>
): Promise<DrugEducationInfo | null> {
  // Cache key uses lowercased drug name. onlySections is not included in the
  // key because the full label is always fetched; filtering is done post-fetch.
  const cacheKey = drugName.toLowerCase();
  const cached = dailymedEducationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const results = await searchDrug(drugName, 1);
  if (results.length === 0) {
    dailymedEducationCache.set(cacheKey, null);
    return null;
  }

  const top = results[0];
  const sections = await getDrugLabel(top.setid);

  const findSection = (code: string): string | null => {
    if (onlySections && !onlySections.has(code)) return null;
    const section = sections.find((s) => s.code === code);
    return section ? section.text : null;
  };

  const info: DrugEducationInfo = {
    drug_name: drugName,
    setid: top.setid,
    title: top.title,
    indications: findSection(SPL_SECTION_CODES.INDICATIONS),
    warnings: findSection(SPL_SECTION_CODES.WARNINGS_PRECAUTIONS),
    adverse_reactions: findSection(SPL_SECTION_CODES.ADVERSE_REACTIONS),
    dosage_administration: findSection(SPL_SECTION_CODES.DOSAGE_ADMIN),
    contraindications: findSection(SPL_SECTION_CODES.CONTRAINDICATIONS),
    drug_interactions: findSection(SPL_SECTION_CODES.DRUG_INTERACTIONS),
    patient_counseling: findSection(SPL_SECTION_CODES.PATIENT_COUNSELING),
    boxed_warning: findSection(SPL_SECTION_CODES.BOXED_WARNING),
    source: "DailyMed (NLM/NIH)",
    fetched_at: new Date().toISOString(),
  };

  dailymedEducationCache.set(cacheKey, info);
  return info;
}

/**
 * Parse SPL XML to extract labeled sections with their LOINC codes.
 * Uses simple regex-based extraction (no XML parser dependency needed).
 */
export function parseSplSections(xml: string): DrugLabelSection[] {
  const sections: DrugLabelSection[] = [];
  const targetCodes = new Set(Object.values(SPL_SECTION_CODES));

  // Match <section> blocks containing a <code> with a target LOINC code
  // SPL format: <code code="34067-9" ... /> inside a <section>
  const sectionRegex =
    /<section[^>]*>[\s\S]*?<code\s+code="([^"]+)"[\s\S]*?<\/section>/gi;

  let match;
  while ((match = sectionRegex.exec(xml)) !== null) {
    const code = match[1];
    if (!targetCodes.has(code)) continue;

    const sectionXml = match[0];

    // Extract title from <title> tag
    const titleMatch = sectionXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripXmlTags(titleMatch[1]).trim() : "";

    // Extract text content from <text> tag (may contain HTML-like markup)
    const textMatch = sectionXml.match(/<text[^>]*>([\s\S]*?)<\/text>/i);
    const text = textMatch ? stripXmlTags(textMatch[1]).trim() : "";

    if (text) {
      sections.push({ code, title, text });
    }
  }

  return sections;
}

/** Strip XML/HTML tags and decode common entities */
function stripXmlTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#xA;/g, "\n")
    .replace(/\s+/g, " ");
}

/** Fetch with timeout */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export { SPL_SECTION_CODES, DAILYMED_BASE_URL };
