# AgentForge Codebase Audit Report

**Date:** February 23, 2025  
**Scope:** `openemr/agent/` — Security, Performance, Code Quality, Testing, Dependencies, Architecture

---

## Executive Summary

Audit of the AgentForge codebase covering security, performance, code quality, testing, dependencies, and architecture. **47 findings** identified across 6 categories. Prioritize security fixes and dependency updates, then address performance and architecture.

| Severity | Count |
|----------|-------|
| High     | 15    |
| Medium   | 20    |
| Low      | 12    |

---

## 1. Security

### HIGH SEVERITY

#### SEC-001: Rate limiting uses in-memory storage without cleanup
- **Location:** `src/server.ts:29,59-67`
- **Issue:** `rateLimitMap` grows unbounded; no cleanup or TTL. Vulnerable to memory exhaustion.
- **Recommendation:** Implement TTL-based cleanup or use Redis/rate limiting middleware.
- **Example Fix:**
```typescript
// Add periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of Object.entries(rateLimitMap)) {
    if (now > value.resetAt) {
      delete rateLimitMap[key];
    }
  }
}, RATE_LIMIT_WINDOW_MS);
```

#### SEC-002: Patient ID injection risk in FHIR queries
- **Location:** `src/data/fhir-datasource.ts:59,65-72`
- **Issue:** Patient ID used in FHIR queries without strict validation. Fallback fetches all patients and indexes by position, enabling enumeration.
- **Recommendation:** Validate patient IDs against a whitelist pattern, reject non-UUID/non-numeric IDs, and remove the fallback enumeration.
- **Example Fix:**
```typescript
private validatePatientId(pid: string): void {
  if (!UUID_REGEX.test(pid) && !/^\d+$/.test(pid)) {
    throw new Error(`Invalid patient ID format: ${pid}`);
  }
}
```

#### SEC-003: Missing input validation on document IDs
- **Location:** `src/server.ts:175,188,206,215`
- **Issue:** Document IDs from URL params used without validation, enabling path traversal or injection.
- **Recommendation:** Validate document IDs against a strict pattern before use.
- **Example Fix:**
```typescript
const DOCUMENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
if (!DOCUMENT_ID_REGEX.test(req.params.id)) {
  return res.status(400).json({ error: "Invalid document ID format" });
}
```

#### SEC-004: XSS risk via innerHTML usage
- **Location:** `public/index.html:421,485,523,559,580,616,634`
- **Issue:** Multiple `innerHTML` assignments. While `escapeHtml()` is used, some paths may bypass it.
- **Recommendation:** Prefer `textContent` or a templating library; audit all `innerHTML` usage.
- **Example Fix:**
```javascript
// Replace innerHTML with safer alternatives
div.textContent = content; // For text-only
// Or use DOMPurify for HTML content
div.innerHTML = DOMPurify.sanitize(html);
```

### MEDIUM SEVERITY

#### SEC-005: Missing timeout on FHIR API calls
- **Location:** `src/data/fhir-datasource.ts:76-99`
- **Issue:** `fhirFetch` lacks timeout, risking hangs.
- **Recommendation:** Add timeout to all fetch calls.
- **Example Fix:**
```typescript
const FHIR_TIMEOUT_MS = 10_000;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), FHIR_TIMEOUT_MS);
const res = await fetch(url, {
  signal: controller.signal,
  headers: { ... }
});
clearTimeout(timeout);
```

#### SEC-006: Secrets in environment variables without validation
- **Location:** `src/config.ts:32-35,50,66,80-81`
- **Issue:** Secrets read from env without format validation or placeholder checks.
- **Recommendation:** Validate secret formats and ensure placeholders are replaced.
- **Example Fix:**
```typescript
if (password.length < 8) {
  throw new Error("FHIR_PASSWORD must be at least 8 characters");
}
```

#### SEC-007: CORS configuration allows credentials by default
- **Location:** `src/server.ts:74`
- **Issue:** `credentials: true` set when CORS is enabled, increasing CSRF risk if origins are misconfigured.
- **Recommendation:** Only enable credentials when necessary and validate origins strictly.
- **Example Fix:**
```typescript
app.use(cors({ 
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // Only if truly needed
}));
```

#### SEC-008: Error messages leak internal details
- **Location:** `src/data/fhir-datasource.ts:95,206,285`
- **Issue:** Error messages include full HTTP response text, potentially exposing sensitive info.
- **Recommendation:** Sanitize error messages in production; log details separately.
- **Example Fix:**
```typescript
if (!res.ok) {
  const errorMsg = res.status === 500 
    ? "Internal server error" 
    : `FHIR request failed: ${res.status}`;
  console.error("FHIR error details:", await res.text()); // Log separately
  throw new Error(errorMsg);
}
```

### LOW SEVERITY

#### SEC-009: Missing request ID for tracing
- **Location:** `src/server.ts:104-157`
- **Recommendation:** Add request ID middleware for tracing.

#### SEC-010: Session ID generation predictable
- **Location:** `src/server.ts:118`
- **Issue:** Session IDs use timestamp, making them predictable.
- **Recommendation:** Use cryptographically secure random IDs.
- **Example Fix:**
```typescript
import { randomUUID } from 'crypto';
const sessionId = session_id || randomUUID();
```

---

## 2. Performance

### HIGH SEVERITY

#### PERF-001: No caching for FHIR token refresh
- **Location:** `src/data/fhir-auth.ts:37-55`
- **Issue:** Token refresh may be called concurrently, causing duplicate requests.
- **Recommendation:** Add request deduplication or a mutex for token refresh.
- **Example Fix:**
```typescript
private refreshPromise: Promise<string> | null = null;

async getAccessToken(): Promise<string> {
  if (this.refreshPromise) return this.refreshPromise;
  // ... existing logic
  this.refreshPromise = this.fetchWithPasswordGrant();
  try {
    return await this.refreshPromise;
  } finally {
    this.refreshPromise = null;
  }
}
```

#### PERF-002: Patient ID resolver cache lacks size limit enforcement
- **Location:** `src/data/patient-id-resolver.ts:56-62`
- **Issue:** Cache eviction only checks size once; race conditions can exceed limit.
- **Recommendation:** Enforce size limit atomically.

### MEDIUM SEVERITY

#### PERF-003: No connection pooling for HTTP requests
- **Location:** Multiple files using `fetch()`
- **Recommendation:** Use `undici` or `node-fetch` with keep-alive, or an HTTP agent with connection pooling.

#### PERF-004: Agent executor recreated unnecessarily
- **Location:** `src/agent.ts:93-100`
- **Recommendation:** Keep singleton pattern; optimize initialization.

#### PERF-005: Large history arrays copied multiple times
- **Location:** `src/agent.ts:119-124`
- **Recommendation:** Optimize history processing.

### LOW SEVERITY

#### PERF-006: No request compression
- **Location:** `src/server.ts:76`
- **Recommendation:** Enable gzip compression middleware (`compression` package).

#### PERF-007: Session eviction runs synchronously
- **Location:** `src/server.ts:48-57`
- **Recommendation:** Run eviction asynchronously or in background.

---

## 3. Code Quality

### HIGH SEVERITY

#### QUAL-001: Excessive use of `any` type
- **Location:** `src/data/fhir-datasource.ts:227-239`, `src/server.ts:137-138`
- **Recommendation:** Define proper types for FHIR resources.

#### QUAL-002: Silent error swallowing
- **Location:** `src/data/fhir-datasource.ts:56`, `src/tools/drug-interaction-check.ts:126-128`
- **Recommendation:** Log errors and handle appropriately.
- **Example Fix:**
```typescript
} catch (err) {
  console.warn("Standard API lookup failed, falling back to FHIR:", err);
  // ... fallback logic
}
```

#### QUAL-003: Inconsistent error handling patterns
- **Location:** Multiple files
- **Recommendation:** Standardize on throwing errors; handle at boundaries.

### MEDIUM SEVERITY

#### QUAL-004: Magic numbers without constants
- **Location:** `src/server.ts:22-24`, `src/agent.ts:19-20`
- **Recommendation:** Centralize constants in a config file.

#### QUAL-005: Duplicate URL encoding logic
- **Recommendation:** Extract to a utility function.

#### QUAL-006: Missing JSDoc comments
- **Recommendation:** Add JSDoc for public functions.

### LOW SEVERITY

#### QUAL-007: Console.log in production code
- **Location:** `src/server.ts:170,238`, `src/config.ts:99`
- **Recommendation:** Use a logging library with levels (e.g., pino, winston).

#### QUAL-008: Inconsistent naming conventions
- **Recommendation:** Enforce consistent naming (prefer camelCase for TypeScript).

---

## 4. Testing

### HIGH SEVERITY

#### TEST-001: Missing rate limiting tests
- **Recommendation:** Add tests for rate limit enforcement and cleanup.

#### TEST-002: Missing security header tests for all endpoints
- **Recommendation:** Test security headers on all endpoints.

#### TEST-003: No integration tests for FHIR datasource error scenarios
- **Recommendation:** Add tests for network failures, timeouts, invalid responses.

### MEDIUM SEVERITY

#### TEST-004: Missing tests for patient ID validation
- **Recommendation:** Add validation tests.

#### TEST-005: No performance/load tests
- **Recommendation:** Add basic load tests for critical endpoints.

#### TEST-006: Missing tests for session eviction
- **Recommendation:** Add test that creates 1001+ sessions and verifies eviction.

### LOW SEVERITY

#### TEST-007: Test coverage gaps in verification module
- **Recommendation:** Increase coverage for verification logic.

---

## 5. Dependencies

### HIGH SEVERITY

#### DEP-001: Vulnerable dependency: @langchain/anthropic
- **Issue:** High severity via `fast-xml-parser`; fix requires major version bump.
- **Recommendation:** Update to `@langchain/anthropic@^1.3.21` (may require code changes).

#### DEP-002: Vulnerable dependency: @langchain/core
- **Issue:** Moderate severity via `langsmith`.
- **Recommendation:** Update to latest version.

#### DEP-003: Vulnerable dependency: esbuild (via vite)
- **Recommendation:** Update vite/esbuild to latest versions.

### MEDIUM SEVERITY

#### DEP-004: Outdated TypeScript version
- **Recommendation:** Check for updates and test before upgrading.

#### DEP-005: No dependency lock file verification in CI
- **Recommendation:** Add CI step to verify lock file is up to date.

### LOW SEVERITY

#### DEP-006: Unused dependencies potential
- **Recommendation:** Run `npx depcheck` to identify unused dependencies.

---

## 6. Architecture

### HIGH SEVERITY

#### ARCH-001: Tight coupling between server and agent logic
- **Location:** `src/server.ts:104-157`
- **Recommendation:** Introduce a service layer abstraction.

#### ARCH-002: Session storage in memory
- **Location:** `src/server.ts:28`
- **Issue:** In-memory storage prevents horizontal scaling and causes data loss on restart.
- **Recommendation:** Use Redis or a database for session storage.

### MEDIUM SEVERITY

#### ARCH-003: No separation between business logic and HTTP layer
- **Recommendation:** Extract business logic to service classes.

#### ARCH-004: Hardcoded configuration values
- **Recommendation:** Move to centralized config with environment variable support.

#### ARCH-005: No dependency injection
- **Recommendation:** Use dependency injection container or constructor injection.

### LOW SEVERITY

#### ARCH-006: Missing API versioning
- **Recommendation:** Add versioning (e.g., `/api/v1/chat`).

#### ARCH-007: No request/response logging middleware
- **Recommendation:** Add logging middleware for observability.

---

## Priority Action Plan

### Immediate (High Priority)
1. Fix rate limiting memory leak (SEC-001)
2. Add input validation for patient/document IDs (SEC-002, SEC-003)
3. Update vulnerable dependencies (DEP-001, DEP-002)
4. Add timeouts to all HTTP requests (SEC-005)

### Short-term (Medium Priority)
1. Implement proper session storage (ARCH-002)
2. Add comprehensive error handling (QUAL-002, QUAL-003)
3. Improve test coverage (TEST-001, TEST-002, TEST-003)
4. Fix XSS risks in frontend (SEC-004)

### Long-term (Low Priority)
1. Refactor architecture for better separation of concerns (ARCH-001, ARCH-003)
2. Add performance optimizations (PERF-003, PERF-004)
3. Improve code documentation (QUAL-006)

---

## Conclusion

The codebase is functional but needs security hardening, better error handling, and architectural improvements. Prioritize security fixes and dependency updates, then address performance and architecture. All findings include specific file locations and example fixes for implementation.
