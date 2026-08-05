const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  return localStorage.getItem('accessToken');
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(`${API_URL}${path}`);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  const token = getToken();
  const res = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text();
    const body = errorText ? JSON.parse(errorText) : { message: res.statusText };
    throw new ApiError(body.message ?? 'Request failed', res.status);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
