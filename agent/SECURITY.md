# Security Audit — AgentForge Clinical Agent

> Audit date: 2026-02-24 | Status: MVP with mock data | Pre-production review

## Overview

This document tracks known security issues in the AgentForge codebase. The current MVP runs with **mock data only** — these issues must be resolved before connecting to real OpenEMR patient data or deploying to production with PHI.

---

## Critical

- [ ] **CORS allows all origins** — `cors()` in `server.ts:64` has no config, any website can access patient data
  - Fix: whitelist only OpenEMR origins via `OPENEMR_ORIGINS` env var
- [ ] **No authentication on API endpoints** — `/api/chat` and `/api/feedback` (`server.ts:88,137`) have zero auth
  - Fix: validate bearer tokens from OpenEMR session
- [ ] **No authorization on patient access** — client can request any `patient_id` (`server.ts:110-112`)
  - Fix: verify requesting user is authorized to access the specified patient
- [ ] **TLS validation disabled** — `NODE_TLS_REJECT_UNAUTHORIZED=0` in `.env` enables MITM attacks
  - Fix: remove from production, use proper CA certs
- [ ] **Vulnerable dependencies** — `fast-xml-parser` (XXE/DoS), `langsmith` (SSRF) via transitive deps
  - Fix: `npm audit fix` or pin safe versions

## High

- [ ] **Prompt injection via user message** — raw message passed to LLM without sanitization (`agent.ts:89-112`)
  - Fix: add prompt injection detection/filtering layer
- [ ] **Prompt injection via patient_id** — `patient_id` injected into prompt can contain newlines/instructions (`server.ts:110-112`)
  - Fix: validate patient_id format (numeric only), sanitize before prompt injection
- [ ] **Rate limit bypass** — rate limiting is per client-controlled `session_id` (`server.ts:51-60`)
  - Fix: rate limit by IP address
- [ ] **FHIR patient enumeration** — fallback fetches all patients (`/Patient?_count=100`) to find by index (`fhir-datasource.ts:59-66`)
  - Fix: remove list-all-patients fallback, require exact ID match
- [ ] **FHIR credentials in memory** — password stored indefinitely in `FhirAuthManager` (`fhir-auth.ts:26-36`)
  - Fix: clear password after initial token acquisition, use refresh tokens only
- [ ] **FDA API leaks medication patterns** — external fetch reveals patient drug combinations (`drug-interaction-check.ts:103-107`)
  - Fix: use local drug interaction database or proxy requests

## Medium

- [ ] **Missing security headers** — no `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy` (`server.ts:67-77`)
- [ ] **Error messages leak info** — raw FHIR/OAuth errors returned to client (`agent.ts:161-175`)
- [ ] **No session timeout** — sessions with conversation history persist in memory indefinitely (`server.ts:20-49`)
- [ ] **Predictable session IDs** — `Math.random()` is not cryptographically secure (`index.html:320`)
- [ ] **DOM XSS via URL param** — `?pid=` used in querySelector with string concatenation (`index.html:327-333`)
- [ ] **No audit logging** — no record of who accessed which patient data (HIPAA requirement)
- [ ] **Verification layer trusts LLM output** — safety alerts parsed from unvalidated tool results (`verification.ts:42-92`)
- [ ] **Feedback endpoint unvalidated** — no auth, no input sanitization (`server.ts:137-141`)
- [ ] **Langfuse receives PHI** — patient data flows to third-party observability service (`config.ts:70-97`)
- [ ] **FHIR fetch has no timeout** — can hang indefinitely (`fhir-datasource.ts:71-94`)

## Low

- [ ] **Custom HTML escaping** — fragile `escapeHtml()` function instead of using a library (`index.html:350-354`)
- [ ] **X-Frame-Options fallback** — CSP could be malformed if invalid origin provided (`server.ts:70-74`)

---

## Accepted Risks (MVP with mock data)

The following are acknowledged for the current MVP demo but must be addressed before production:

| Risk | Reason Accepted |
|------|-----------------|
| No auth on endpoints | MVP uses mock data only, no real PHI |
| CORS open | Demo needs to be accessible from multiple origins |
| Mock data in source | Synthetic test data, not real patient records |
| No audit logging | No real PHI access to audit |

---

## Remediation Priority

### Before connecting to real patient data:
1. Lock down CORS to OpenEMR origins only
2. Add authentication (validate OpenEMR session tokens)
3. Add patient-level authorization
4. Remove `NODE_TLS_REJECT_UNAUTHORIZED=0`
5. Update vulnerable dependencies
6. Sanitize patient_id input (numeric-only validation)
7. Add session expiration (15-30 min TTL)
8. Add audit logging for all data access

### Before production deployment:
9. Rate limit by IP address
10. Add prompt injection detection
11. Server-side session generation (crypto.randomUUID)
12. Add comprehensive security headers
13. Sanitize all error messages
14. Use local drug interaction DB (avoid FDA API privacy leak)
15. Review Langfuse data residency for HIPAA compliance
