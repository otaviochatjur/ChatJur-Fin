import { CLIENT_SHEET_ID, CLIENT_SHEET_TAB } from "./sheets-clients";

export async function readClientSheet(): Promise<unknown[][]> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("A conta de serviço do Google ainda não está disponível neste servidor (GOOGLE_SERVICE_ACCOUNT_JSON).");
  const account = JSON.parse(raw) as { client_email: string; private_key: string };
  const encode = (value: string) => Buffer.from(value).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claim = `${encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${encode(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const key = await crypto.subtle.importKey("pkcs8", Buffer.from(account.private_key.replace(/-----[^-]+-----|\s/g, ""), "base64"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(claim));
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${claim}.${Buffer.from(signature).toString("base64url")}` }) });
  if (!tokenResponse.ok) throw new Error("Não foi possível autenticar a conta de serviço do Google.");
  const token = await tokenResponse.json() as { access_token: string };
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CLIENT_SHEET_ID}/values/${encodeURIComponent(`'${CLIENT_SHEET_TAB}'!A:AL`)}?valueRenderOption=FORMATTED_VALUE`, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!response.ok) throw new Error("Não foi possível ler a aba Base de Clientes. Confira o compartilhamento com a conta de serviço.");
  const data = await response.json() as { values?: unknown[][] };
  return data.values ?? [];
}
