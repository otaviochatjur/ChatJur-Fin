import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, authRequest, requireUser, sameOrigin, saveSession } from "@/lib/auth-server";
import { currentTenant } from "@/lib/tenant-server";

export async function GET() {
  try {
    const { user } = await requireUser();
    await currentTenant();
    return Response.json({ user: { id: user.id, email: user.email } }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ user: null }, { status: 401 }); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.email !== "string" || typeof body.password !== "string" || body.email.length > 254 || body.password.length > 256) return Response.json({ error: "Informe e-mail e senha." }, { status: 400 });
  const signup = body.action === "signup";
  if (signup && body.password.length < 8) return Response.json({ error: "Use uma senha com pelo menos 8 caracteres." }, { status: 400 });
  try {
    const response = await authRequest(signup ? "/signup" : "/token?grant_type=password", { email: body.email.trim(), password: body.password });
    const data = await response.json();
    if (!response.ok) return Response.json({ error: signup ? "Não foi possível criar a conta. Confira os dados ou tente novamente mais tarde." : "E-mail ou senha inválidos, ou e-mail ainda não confirmado." }, { status: 400 });
    if (!data.access_token || !data.user?.email_confirmed_at) return Response.json({ confirmationRequired: true });
    await saveSession(data);
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Não foi possível conectar ao serviço de autenticação." }, { status: 503 }); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (token) await authRequest("/logout?scope=local", {}, token).catch(() => null);
  jar.delete(ACCESS_COOKIE); jar.delete(REFRESH_COOKIE);
  return Response.json({ ok: true });
}
