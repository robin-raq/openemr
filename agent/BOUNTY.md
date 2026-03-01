# AgentForge Bounty: Discharge Summary & Medication Reconciliation

## Customer Problem

A doctor told us: hospital courses are extremely long, discharge summaries are tedious to write, and medication reconciliation at discharge is error-prone. AI integrated into the EMR for these tasks would be "awesome" -- but current tools can't be used because they aren't HIPAA-compliant. Our **draft-then-confirm** pattern solves this: AI drafts, clinician reviews and approves.

Patients also leave the hospital confused about their medications -- what changed, what's new, what was stopped, and what to watch for. A patient-friendly set of discharge instructions, enriched with drug education from authoritative sources, fills this gap.

## What We Built

### New External Data Source: DailyMed (NLM/NIH)

We integrated the **DailyMed REST API** from the National Library of Medicine as a new external data source. DailyMed provides FDA-approved drug labeling (Structured Product Labeling / SPL) for medications.

**API:** `https://dailymed.nlm.nih.gov/dailymed/services/v2/`

**Client:** `src/data/dailymed-client.ts`
- `searchDrug(drugName)` -- searches DailyMed for a drug by name
- `getDrugLabel(setid)` -- fetches full SPL XML and parses key sections
- `getDrugEducation(drugName)` -- high-level: search + parse in one call
- `parseSplSections(xml)` -- extracts sections by LOINC code from SPL XML

**Sections extracted** (by LOINC code):
- Indications & Usage (34067-9)
- Adverse Reactions (34084-4)
- Warnings & Precautions (43685-7)
- Dosage & Administration (34068-7)
- Contraindications (34070-3)
- Drug Interactions (34073-7)
- Patient Counseling (34076-0)
- Boxed Warning (34066-1)

This data enriches the `generate_discharge_instructions` tool output, giving patients FDA-sourced drug education alongside their medication changes.

### Encounter & Admission Medication Data

We added encounter/admission data to the OpenEMR agent including hospital course notes, admission medications with reconciliation status, and a document store for AI-generated clinical documents.

**New interfaces:**
- `EncounterData` -- inpatient/outpatient encounters with diagnoses, procedures, hospital course
- `AdmissionMedication` -- medication status tracking (continued/modified/discontinued/new)
- `DocumentRecord` -- CRUD document store for discharge summaries, med reconciliation, and discharge instructions

### Agent Access via Open Source API

The agent accesses data through multiple paths:
1. **MockDataSource** for development/testing (4 mock patients with realistic clinical scenarios)
2. **FhirDataSource** for production OpenEMR instances via FHIR R4 API with OAuth2 password grant
3. **DailyMed REST API** for FDA drug label data (new external data source)

FHIR resources used:
- `Encounter` -- patient encounter history
- `MedicationRequest` -- admission medication reconciliation
- `DocumentReference` -- document CRUD (create/read/update/delete)

OAuth scope extended to include: `user/Encounter.read user/DocumentReference.read user/DocumentReference.write`

### Stateful CRUD Operations

The agent uses full CRUD operations on a `DocumentRecord` store:

| Operation | Method | Description |
|-----------|--------|-------------|
| **Create** | `saveDocument()` | Agent saves drafted document as "draft" status |
| **Read** | `getDocument()` | Retrieve a document by ID |
| **Update** | `updateDocument()` | Clinician finalizes draft via `POST /api/documents/:id/finalize` |
| **Delete** | `deleteDocument()` | Remove a draft document |

The key architectural decision: **AI never writes directly to the chart**. All documents are saved as "draft" and require explicit clinician approval via the "Finalize & Save to Chart" button in the UI.

### 5 New Tools

| Tool | Purpose |
|------|---------|
| `get_encounter_data` | Retrieves encounter/admission data for a patient |
| `reconcile_medications` | Compares admission vs discharge meds, categorizes changes |
| `draft_discharge_summary` | Gathers all data needed for a discharge summary (clinician-facing) |
| `generate_discharge_instructions` | Generates patient-friendly discharge instructions with drug education from DailyMed (patient-facing) |
| `save_to_chart` | Saves a drafted document to the patient's chart (as draft) |

### Verification Layer Integration

The existing safety verification layer was extended to scan new tool outputs:
- `reconcile_medications` triggers alerts for modified, new, and discontinued medications
- `draft_discharge_summary` flags critical lab values at discharge
- `generate_discharge_instructions` flags new medications, dose changes, and stopped medications for patient awareness
- `save_to_chart` generates a confirmation alert showing the draft was saved

### End-to-End Workflows

**Clinician Workflow: Discharge Summary**
```
Clinician: "Draft a discharge summary for patient 4"

Agent calls get_encounter_data(patient_id: "4")
  -> Finds active encounter enc-401 (Hypertensive Emergency + AKI)

Agent calls draft_discharge_summary(patient_id: "4", encounter_id: "enc-401")
  -> Gathers demographics, hospital course, med changes, labs, vitals

Agent calls save_to_chart(patient_id: "4", encounter_id: "enc-401", ...)
  -> Saves draft document, returns Document ID: doc-1

Verification layer flags:
  - CRITICAL LAB AT DISCHARGE: INR 3.8, K+ 5.3, Creatinine 1.8
  - MEDICATION CHANGE: Lisinopril increased, Insulin Glargine added
  - DISCONTINUED: Metformin (renal function decline)

UI shows: discharge summary + safety alerts + "Finalize & Save to Chart" button

Clinician reviews, clicks Finalize
  -> POST /api/documents/doc-1/finalize -> status: "final"
```

**Patient Workflow: Discharge Instructions**
```
Clinician: "In layman's terms, describe follow-up care for patient 1"

Agent calls get_encounter_data(patient_id: "1")
  -> Finds encounter enc-101

Agent calls generate_discharge_instructions(patient_id: "1", encounter_id: "enc-101")
  -> Fetches DailyMed drug education for new/modified meds
  -> Categorizes medications (new, modified, continued, discontinued)
  -> Builds warning signs and follow-up guidance from patient conditions
  -> Returns patient-friendly instructions with drug education

Verification layer flags:
  - NEW MEDICATION FOR PATIENT: Metoprolol 25mg twice daily
  - MEDICATION DOSE CHANGED: Lisinopril from 10mg to 20mg

Agent presents plain-language instructions the patient can understand
```

## Impact

- **Time saved**: A discharge summary that takes 30-60 minutes to write manually can be drafted in seconds
- **Patient understanding**: Discharge instructions in plain language with drug education help patients understand their care plan
- **Safety improved**: Automated medication reconciliation catches changes that manual review might miss
- **HIPAA-compatible**: Draft-then-confirm pattern means AI assists but doesn't make clinical decisions
- **Integrated**: Works within the OpenEMR workflow via FHIR R4 API + DailyMed API

## Technical Stats

- **200+ unit tests** passing (including DailyMed client tests + discharge instructions tests)
- **63 eval cases** covering all tools and workflows
- **10 tools** total (5 original + 5 bounty)
- **3 new server endpoints** for document CRUD
- **2 data sources**: OpenEMR (FHIR R4) + DailyMed (NLM/NIH REST API)
- **TDD throughout** -- every feature was test-driven

## Files Changed

| File | Change |
|------|--------|
| `src/data/datasource.ts` | +3 interfaces, +6 DataSource methods, +discharge_instructions type |
| `src/data/dailymed-client.ts` | NEW -- DailyMed API client (search, label fetch, SPL parsing) |
| `src/data/mock-data.json` | +encounters, +admission_medications |
| `src/data/mock-datasource.ts` | +6 method implementations |
| `src/tools/get-encounter-data.ts` | NEW |
| `src/tools/reconcile-medications.ts` | NEW |
| `src/tools/draft-discharge-summary.ts` | NEW |
| `src/tools/generate-discharge-instructions.ts` | NEW -- patient-facing instructions with DailyMed integration |
| `src/tools/save-to-chart.ts` | NEW, +discharge_instructions document type |
| `src/verification/verification.ts` | +med rec, discharge, discharge instructions, save alerts, DailyMed source |
| `src/agent.ts` | +5 tools, updated system prompt with patient vs clinician distinction |
| `src/server.ts` | +finalize, get, delete document endpoints |
| `public/index.html` | +quick prompts, tool badges, finalize button, discharge instructions button |
| `src/data/fhir-datasource.ts` | +Encounter, DocumentReference, admission meds |
| `src/data/fhir-mappers.ts` | +mapFhirEncounters, mapFhirAdmissionMedications |
| `src/data/fhir-auth.ts` | +FHIR_SCOPES with Encounter + DocumentReference |
| `tests/data/dailymed-client.test.ts` | NEW -- 11 tests (7 unit + 4 integration) |
| `tests/tools/generate-discharge-instructions.test.ts` | NEW -- 15 tests |
| `eval/test-cases.json` | +16 bounty eval cases (12 original + 4 discharge instructions) |
