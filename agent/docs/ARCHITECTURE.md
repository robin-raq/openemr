# Agent Architecture Documentation

## Domain & Use Cases

**Domain:** Clinical discharge workflow automation for OpenEMR (open-source EHR).

**Problem:** Discharge summaries take clinicians 30-60 minutes to write manually. Medication reconciliation is error-prone — missed changes lead to adverse drug events. Patients leave hospitals confused about their medication changes, follow-up appointments, and warning signs. Existing AI tools lack the draft-then-confirm workflow needed for HIPAA-compatible clinical documentation.

**Specific problems solved:**
- **Discharge summary generation** — AI drafts comprehensive summaries from encounter data, labs, medications, and vitals in seconds instead of 30-60 minutes
- **Medication reconciliation** — Automated comparison of admission vs. discharge medications catches dose changes, new medications, and discontinuations
- **Patient-friendly discharge instructions** — Plain-language instructions with drug education from FDA-approved DailyMed labeling, scheduled follow-up appointments, and condition-specific warning signs
- **Drug interaction safety** — Severity-gated interaction checking with clinical significance and monitoring recommendations
- **Document lifecycle** — Draft-then-confirm pattern where AI drafts and clinicians review, edit, and finalize before chart entry

---

## Agent Architecture

![Architecture Diagram](architecture-diagram.svg)

**Framework:** LangChain.js with `createToolCallingAgent` and `AgentExecutor`. Chosen for native Claude tool-calling support, built-in iteration control (max 10), conversation history management, and callback-based observability hooks.

**LLM:** Claude Sonnet 4 (`claude-sonnet-4-20250514`) at temperature 0 for deterministic clinical responses. Hard 60-second timeout via `Promise.race`.

**Reasoning approach:** The agent implements the ReAct pattern (Think → Act → Observe → Repeat) via Claude's native tool-calling API and LangChain's `AgentExecutor`. Rather than parsing explicit "Thought:/Action:/Observation:" text, the same reasoning loop is handled through structured tool-call messages — more reliable for clinical contexts where deterministic tool selection matters. The system prompt encodes clinical rules: never prescribe, always cite sources, flag critical findings, differentiate clinician-facing vs. patient-facing language. The agent decides which tools to call based on the query, executes them (up to 10 iterations for multi-step workflows), and synthesizes results into a natural-language response.

**Tool design:** All 10 tools use `tool()` from `@langchain/core/tools` with Zod input schemas and return `JSON.stringify(result)`. Tools accept a `DataSource` dependency for testability (mock vs. FHIR). The 5 MVP tools handle core queries; the 5 bounty tools handle discharge workflows:

| Tool | Category | Purpose |
|------|----------|---------|
| `get_patient_summary` | MVP | Demographics, conditions, medications, allergies, vitals |
| `get_medications` | MVP | Active medication list with dose, frequency, prescriber |
| `drug_interaction_check` | MVP | Pairwise interaction check (hardcoded DB + OpenFDA fallback) |
| `allergy_check` | MVP | Direct + cross-reactivity allergy matching |
| `get_lab_results` | MVP | Lab values with normal/abnormal/critical flags |
| `get_encounter_data` | Bounty | Hospital encounters, diagnoses, procedures, course notes |
| `reconcile_medications` | Bounty | Admission vs. discharge med comparison with change reasons |
| `draft_discharge_summary` | Bounty | Multi-source aggregation into structured clinician-facing summary |
| `generate_discharge_instructions` | Bounty | Patient-facing instructions + DailyMed education + appointments |
| `save_to_chart` | Bounty | Stateful CRUD: create draft, read, update, finalize (lock) |

**Data sources:**
- **Mock JSON** — 4 patients with full clinical data for development and testing
- **OpenEMR FHIR R4** — OAuth2 password-grant authentication, FHIR resources (Patient, Condition, MedicationRequest, AllergyIntolerance, Observation, Encounter, Appointment, DocumentReference)
- **DailyMed REST API** (NLM/NIH) — FDA-approved drug labeling: indications, adverse reactions, warnings, contraindications (SPL XML parsed by LOINC section codes)
- **OpenFDA** — Drug interaction label data (3-second timeout fallback)

**Multi-step tool orchestration:** Complex queries like discharge summaries trigger 5+ parallel data fetches (`Promise.all`) — patient demographics, encounter data, admission medications, current medications, and lab results are all gathered concurrently before being composed into the final document.

---

## Verification Strategy

Post-LLM verification runs on every response via `applyVerification(response, toolCalls)`. It parses tool result JSON and extracts safety-critical conditions into a `safetyAlerts` array rendered as yellow/red banners in the UI.

**Safety checks implemented:**

| Check | Trigger | Rationale |
|-------|---------|-----------|
| Drug interaction severity gate | Interaction severity = serious or critical | Prevents dismissal of dangerous drug combinations |
| Allergy conflict detection | `safe === false` with active conflicts | Catches cross-reactivity (e.g., penicillin/cephalosporin) |
| Critical lab flagging | Lab value flag = critical | Ensures abnormal values are surfaced prominently |
| Medication change alerts | Modified/new/discontinued medications | Highlights changes that need clinician review |
| Draft save confirmation | Document saved as draft | Confirms save and reminds clinician review is required |
| Source attribution | Always appended | Every response cites its data source (OpenEMR, OpenFDA, DailyMed) |
| Medical disclaimer | Always appended | Standard "reference only" disclaimer on all clinical content |

**Why these checks:** Clinical AI must never silently pass through dangerous information. Drug interactions and allergy conflicts are the highest-risk conditions in medication management. Critical labs require immediate attention. The verification layer acts as a safety net independent of the LLM's own judgment — even if Claude fails to mention a critical interaction, the verification layer will catch it from the raw tool data.

**Draft-then-confirm pattern:** AI can only save documents as "draft" status. Finalization requires an explicit clinician action via a separate HTTP endpoint (`POST /api/documents/:id/finalize`). Finalized documents are locked — no further edits possible.

---

## Eval Results

**79 eval cases** across 17 categories, testing all 10 tools.

| Metric | Value |
|--------|-------|
| Pass rate | **87.3%** (69/79) |
| p50 latency | 7.2s |
| p95 latency | 28.7s |
| Duration | 719s (~12 min) |

**Category breakdown:**

| Category | Rate | Notes |
|----------|------|-------|
| Golden sets (core routing) | 100% (25/25) | All tools route correctly |
| Drug interactions | 100% (5/5) | Severity gating works |
| DailyMed | 100% (2/2) | FDA labeling integration |
| Workflows | 100% (3/3) | Multi-step tool chains |
| Query variations | 100% (8/8) | Paraphrased queries |
| Bounty categories | 100% (8/8) | Med rec, discharge, safety, workflows |
| Safety | 80% (4/5) | 1 failure: scope boundary edge case |
| Edge cases | 50% (2/4) | Invalid IDs, empty data handling |
| Adversarial | 25% (1/4) | Prompt injection resistance needs improvement |

**Failure analysis:** The 10 failures break down into: 4 adversarial prompt injection cases (agent sometimes follows out-of-scope instructions), 2 edge cases with invalid patient IDs (agent provides generic response instead of error), 2 appointment scheduling edge cases, and 2 encounter data retrieval variations. The adversarial weakness is the highest priority for hardening — the system prompt needs stronger scope-boundary enforcement.

**Eval infrastructure:** Custom harness (`eval/run-eval.ts`) with `must_contain`, `must_not_contain`, and `expected_tools` assertions. Supports `--resume` to skip previously passed cases (saves ~35% on re-runs). Outputs `results.json` with per-case timing, tool usage, and pass/fail status. Auto-generates SVG dashboard and markdown summary.

---

## Observability Setup

**Langfuse integration** via `@langfuse/langchain` callback handler with OpenTelemetry span processing.

**What we're tracking:**
- **Per-request traces** — Full LLM call chain including tool selections, tool inputs/outputs, and final response generation
- **Session-level grouping** — All requests from a session tagged with the same `sessionId` for conversation-level analysis
- **Latency breakdown** — Time spent in LLM reasoning vs. tool execution vs. data source calls
- **Tool usage patterns** — Which tools are called, how often, and in what combinations
- **Feedback correlation** — User thumbs-up/down feedback linked to session traces

**Insights gained:**
- Multi-tool queries (discharge summary, discharge instructions) consistently take 15-25s due to parallel data fetches + LLM synthesis — this is the main latency bottleneck
- Single-tool queries (patient summary, medications) complete in 5-8s
- The agent rarely exceeds 3 iterations; most queries resolve in 1-2 tool calls
- DailyMed API calls add 2-4s when drug education is requested (external HTTP dependency)

**Unit testing:** 232 tests via Vitest covering all tools, data sources, verification logic, server routes, and agent configuration. TDD-driven development throughout.

---

## Open Source Contribution

**Repository:** [github.com/robin-raq/agentforge-openemr](https://github.com/robin-raq/agentforge-openemr)

**What was released:**
- Complete LangChain.js clinical agent with 10 tools for OpenEMR
- DailyMed REST API client for FDA drug labeling data (reusable as standalone module)
- OpenEMR FHIR R4 data source with OAuth2 authentication
- Custom eval harness with `--resume`, timing stats, and SVG report generation
- OpenEMR custom module (`oe-module-ai-clinical-agent`) for iframe embedding
- Draft-then-confirm document workflow pattern (applicable to any clinical AI system)

**Deployed at:** https://agent-production-6f7a.up.railway.app

**Stack:** LangChain.js + Claude Sonnet 4 + Express + Vitest + Langfuse, deployed on Railway.
