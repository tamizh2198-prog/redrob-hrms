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

function clearSession() {
  // Cookies are httpOnly — nothing for this module to remove itself. This
  // just tells AuthContext (which can't see this module's fetch calls
  // directly) that the session is gone.
  window.dispatchEvent(new Event('auth:logout'));
}

// Section 11: "short-lived access tokens ... refresh-token rotation on
// use." A single in-flight refresh is shared across concurrent 401s
// (instead of each firing its own /auth/refresh, which would race the
// one-time-use rotation and revoke each other's token) so only the
// request that first hits 401 refreshes; the rest just await the result.
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_PREFIX}/auth/refresh`, {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error('refresh failed');
        return true;
      } catch {
        clearSession();
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

// These never warrant a refresh-and-retry on a bare 401: /auth/login's 401
// just means wrong credentials, /auth/refresh's own 401 means the refresh
// token itself is dead (retrying would loop), and /auth/me's 401 on an
// unauthenticated page load is the expected "not logged in" signal, not an
// expired session.
const NO_RETRY_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/me']);

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

  async function send(): Promise<Response> {
    return fetch(url.toString(), {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  }

  let res = await send();

  // Cookies attach automatically, so unlike the old localStorage-based
  // client we can no longer tell "this request carried a token" from the
  // request itself — a 401 on any non-auth endpoint means the access token
  // is missing/expired, which is exactly the refresh-worthy case.
  if (res.status === 401 && !NO_RETRY_PATHS.has(path)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await send();
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
