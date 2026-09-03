import { cookies } from "next/headers";

// Single place owning cookie attributes for the browser session — tokens
// themselves (JWT/opaque strings) are unchanged, only how they travel to the
// browser changes (httpOnly cookie instead of a JSON body field the client
// stashes in localStorage, where XSS could read it).

const isProd = process.env.NODE_ENV === "production";
const AUTH_PATH = "/api/v1/auth";
const ACCESS_TOKEN_MAX_AGE = 15 * 60; // seconds, mirrors signAccessToken's 15m expiry
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // seconds, mirrors REFRESH_TOKEN_TTL_MS

export async function setSessionCookies(session: { accessToken: string; refreshToken: string }) {
  const store = await cookies();
  store.set("access_token", session.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  store.set("refresh_token", session.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: AUTH_PATH,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
}

export async function setDeviceCookie(deviceToken: string) {
  const store = await cookies();
  store.set("device_token", deviceToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: AUTH_PATH,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
}

// Deliberately does NOT clear device_token — logout ends the session but
// keeps this browser remembered for MFA-skip, matching prior behavior.
export async function clearSessionCookies() {
  const store = await cookies();
  store.set("access_token", "", { path: "/", maxAge: 0 });
  store.set("refresh_token", "", { path: AUTH_PATH, maxAge: 0 });
}
