/**
 * Request-scoped caching wrapper for any DataSource.
 *
 * Wraps an inner DataSource and caches all read-method results
 * for the duration of a single agent request. This prevents
 * redundant fetches when multiple tools query the same patient
 * data within a single chat() invocation.
 *
 * Write methods (save, update, delete) are always passed through.
 * Errors are NOT cached — a failed call will be retried on the next attempt.
 *
 * Usage: create a new CachedDataSource(innerDs) at the start of each
 * agent request. It will be garbage-collected when the request ends.
 */

import type {
  DataSource,
  PatientData,
  MedicationData,
  LabResult,
  EncounterData,
  AdmissionMedication,
  Appointment,
  DocumentRecord,
} from "./datasource";

export class CachedDataSource implements DataSource {
  private readonly inner: DataSource;
  private readonly cache: Map<string, Promise<unknown>> = new Map();

  constructor(inner: DataSource) {
    this.inner = inner;
  }

  /**
   * Build a cache key from method name + args.
   * JSON.stringify is safe here since args are simple strings.
   */
  private cacheKey(method: string, ...args: unknown[]): string {
    return `${method}:${JSON.stringify(args)}`;
  }

  /**
   * Generic cache-or-fetch for read methods.
   * Caches the Promise itself (not the resolved value) to deduplicate
   * concurrent in-flight requests for the same data.
   * Errors are removed from cache so they can be retried.
   */
  private cachedCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.cache.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().catch((err) => {
      // Remove from cache so the next call retries
      this.cache.delete(key);
      throw err;
    });
    this.cache.set(key, promise);
    return promise;
  }

  // ─── Cached read methods ──────────────────────────────────────────

  getPatient(id: string): Promise<PatientData> {
    return this.cachedCall(
      this.cacheKey("getPatient", id),
      () => this.inner.getPatient(id),
    );
  }

  getMedications(patientId: string): Promise<MedicationData[]> {
    return this.cachedCall(
      this.cacheKey("getMedications", patientId),
      () => this.inner.getMedications(patientId),
    );
  }

  getLabResults(patientId: string): Promise<LabResult[]> {
    return this.cachedCall(
      this.cacheKey("getLabResults", patientId),
      () => this.inner.getLabResults(patientId),
    );
  }

  getEncounters(patientId: string): Promise<EncounterData[]> {
    return this.cachedCall(
      this.cacheKey("getEncounters", patientId),
      () => this.inner.getEncounters(patientId),
    );
  }

  getAdmissionMedications(encounterId: string): Promise<AdmissionMedication[]> {
    return this.cachedCall(
      this.cacheKey("getAdmissionMedications", encounterId),
      () => this.inner.getAdmissionMedications(encounterId),
    );
  }

  getAppointments(patientId: string): Promise<Appointment[]> {
    return this.cachedCall(
      this.cacheKey("getAppointments", patientId),
      () => this.inner.getAppointments(patientId),
    );
  }

  getDocument(documentId: string): Promise<DocumentRecord> {
    return this.cachedCall(
      this.cacheKey("getDocument", documentId),
      () => this.inner.getDocument(documentId),
    );
  }

  // ─── Write methods — always pass through, never cached ────────────

  saveDocument(
    doc: Omit<DocumentRecord, "document_id" | "created_at">,
  ): Promise<DocumentRecord> {
    return this.inner.saveDocument(doc);
  }

  updateDocument(
    documentId: string,
    updates: Partial<Pick<DocumentRecord, "content" | "status">>,
  ): Promise<DocumentRecord> {
    return this.inner.updateDocument(documentId, updates);
  }

  deleteDocument(documentId: string): Promise<{ deleted: boolean }> {
    return this.inner.deleteDocument(documentId);
  }
}
