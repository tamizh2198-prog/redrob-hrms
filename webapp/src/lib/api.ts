// Same-origin now that frontend and backend are one Next.js app — no more
// VITE_API_URL/absolute base. `new URL()` still needs a base for a relative
// path, hence `window.location.origin`.
const API_PREFIX = '/api/v1';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getAccessToken(): string | null {
  return localStorage.getItem('accessToken');
}

function getRefreshToken(): string | null {
  return localStorage.getItem('refreshToken');
}

function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('authUser');
  // AuthContext can't see this module's localStorage writes on its own —
  // it listens for this to clear its in-memory user when a refresh fails
  // out from under it (e.g. the refresh token itself expired/was revoked).
  window.dispatchEvent(new Event('auth:logout'));
}

// Section 11: "short-lived access tokens ... refresh-token rotation on
// use." A single in-flight refresh is shared across concurrent 401s
// (instead of each firing its own /auth/refresh, which would race the
// one-time-use rotation and revoke each other's token) so only the
// request that first hits 401 refreshes; the rest just await the result.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_PREFIX}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) throw new Error('refresh failed');
        const body = (await res.json()) as {
          accessToken: string;
          refreshToken: string;
        };
        localStorage.setItem('accessToken', body.accessToken);
        localStorage.setItem('refreshToken', body.refreshToken);
        return body.accessToken;
      } catch {
        clearSession();
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(`${API_PREFIX}${path}`, window.location.origin);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  async function send(token: string | null): Promise<Response> {
    return fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  }

  const originalToken = getAccessToken();
  let res = await send(originalToken);

  // Only worth a refresh-and-retry if this request actually carried an
  // (expired) access token — a 401 with no token at all just means the
  // request itself was rejected (e.g. a wrong-password /auth/login call),
  // not an expired session.
  if (res.status === 401 && originalToken && path !== '/auth/refresh') {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await send(newToken);
    }
  }

  if (!res.ok) {
    const errorText = await res.text();
    const body = errorText ? JSON.parse(errorText) : { message: res.statusText };
    throw new ApiError(body.message ?? 'Request failed', res.status);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
