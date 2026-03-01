/**
 * Centralized constants for the OpenEMR Clinical Agent.
 *
 * All magic numbers, timeout values, and tool set definitions live here
 * so they can be imported from a single source of truth.
 */

// ─── Tool Sets ──────────────────────────────────────────────────────
// Used for source attribution, verification, and response building.

export const PATIENT_TOOLS = new Set([
  "get_patient_summary",
  "get_medications",
  "allergy_check",
  "get_lab_results",
  "get_encounter_data",
  "reconcile_medications",
  "draft_discharge_summary",
  "generate_discharge_instructions",
  "save_to_chart",
]);

export const FDA_TOOLS = new Set(["drug_interaction_check"]);

export const DAILYMED_TOOLS = new Set(["generate_discharge_instructions"]);

/** Tools that produce comprehensive clinical reports (discharge, reconciliation). */
export const COMPREHENSIVE_TOOLS = new Set([
  "draft_discharge_summary",
  "generate_discharge_instructions",
  "reconcile_medications",
]);

// ─── Agent Limits ───────────────────────────────────────────────────

export const AGENT_TIMEOUT_MS = 90_000;
export const MAX_RESPONSE_TOKENS = 2048;
export const MAX_HISTORY_MESSAGES = 20;
/** Cap long assistant messages in history to save context window tokens. */
export const HISTORY_ENTRY_TRUNCATE_CHARS = 1500;

// ─── Server Limits ──────────────────────────────────────────────────

export const MAX_SESSIONS = 1000;
export const MAX_HISTORY_LENGTH = 20;
export const MAX_MESSAGE_LENGTH = 2000;
export const RATE_LIMIT_PER_MINUTE = 10;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── External API Timeouts ──────────────────────────────────────────

export const FDA_API_TIMEOUT_MS = 3_000;
export const MAX_MEDICATIONS_FOR_FDA = 10;
export const DRUG_EDUCATION_TIMEOUT_MS = 5_000;
export const DRUG_EDUCATION_TOTAL_TIMEOUT_MS = 15_000;

// ─── Performance Targets ────────────────────────────────────────────

export const SINGLE_TOOL_TARGET_MS = 5_000;
export const MULTI_STEP_TARGET_MS = 15_000;
