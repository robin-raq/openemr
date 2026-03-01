export interface FhirAuthConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  username: string;
  password: string;
  scope: string;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
}

/** OpenEMR OAuth scopes — includes Encounter.read + DocumentReference.* + Appointment.read for bounty features */
export const FHIR_SCOPES =
  "openid api:oemr api:fhir " +
  "user/Patient.read user/MedicationRequest.read user/Observation.read " +
  "user/AllergyIntolerance.read user/Condition.read " +
  "user/Encounter.read user/Appointment.read user/DocumentReference.read user/DocumentReference.write";

const DEFAULT_EXPIRY_BUFFER_SEC = 60;
const DEFAULT_EXPIRY_SEC = 3600;

export class FhirAuthManager {
  private config: FhirAuthConfig;
  private accessToken: string | null = null;
  private expiresAt: number = 0;
  private refreshToken: string | null = null;
  // PERF-001: Mutex to deduplicate concurrent token refresh requests
  private refreshPromise: Promise<string> | null = null;

  constructor(config: FhirAuthConfig) {
    this.config = config;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    const bufferMs = DEFAULT_EXPIRY_BUFFER_SEC * 1000;

    if (this.accessToken && this.expiresAt > now + bufferMs) {
      return this.accessToken;
    }

    // PERF-001: If a refresh is already in flight, reuse the same promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this._doTokenRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async _doTokenRefresh(): Promise<string> {
    if (this.refreshToken) {
      try {
        const token = await this.refreshAccessToken();
        if (token) return token;
      } catch {
        // Clear stale refresh token so we go straight to password grant next time
        this.refreshToken = null;
      }
    }

    return this.fetchWithPasswordGrant();
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (!this.refreshToken) return null;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.config.clientId,
    });
    if (this.config.clientSecret) {
      body.append("client_secret", this.config.clientSecret);
    }

    const res = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token ?? this.refreshToken;
    this.expiresAt =
      Date.now() + (data.expires_in ?? DEFAULT_EXPIRY_SEC) * 1000;

    return this.accessToken;
  }

  private async fetchWithPasswordGrant(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: this.config.clientId,
      username: this.config.username,
      password: this.config.password,
      user_role: "users",
      scope: this.config.scope,
    });
    if (this.config.clientSecret) {
      body.append("client_secret", this.config.clientSecret);
    }

    const res = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OAuth2 token request failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token ?? null;
    this.expiresAt =
      Date.now() + (data.expires_in ?? DEFAULT_EXPIRY_SEC) * 1000;

    return this.accessToken;
  }
}
