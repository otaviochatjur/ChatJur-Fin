import { cookies } from "next/headers";
import { cache } from "react";

export type AppUser = { id: string; email: string; email_confirmed_at?: string; is_anonymous?: boolean };
type Session = { access_token: string; refresh_token: string; expires_in: number; user: AppUser };
export const ACCESS_COOKIE = "nexo-access";
export const REFRESH_COOKIE = "nexo-refresh";

export async function authRequest(path: string, body?: unknown, token?: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Autenticação não configurada.");
  return fetch(`${url}/auth/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
}

export async function saveSession(session: Session) {
  const jar = await cookies();
  const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
  jar.set(ACCESS_COOKIE, session.access_token, { ...options, maxAge: session.expires_in });
  jar.set(REFRESH_COOKIE, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 30 });
}

export const requireUser = cache(async () => {
  const jar = await cookies();
  let accessToken = jar.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    const response = await authRequest("/user", undefined, accessToken);
    if (response.ok) {
      const user: AppUser = await response.json();
      if (user.id && user.email_confirmed_at && !user.is_anonymous) return { user, accessToken };
    }
  }
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    const response = await authRequest("/token?grant_type=refresh_token", { refresh_token: refreshToken });
    if (response.ok) {
      const session: Session = await response.json();
      if (session.user.email_confirmed_at && !session.user.is_anonymous) {
        await saveSession(session);
        accessToken = session.access_token;
        return { user: session.user, accessToken };
      }
    }
  }
  throw new Error("Sessão expirada. Entre novamente.");
});

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}
