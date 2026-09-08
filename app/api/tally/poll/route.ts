import { requireUser, sameOrigin } from '@/lib/auth-server';
import { pollTally } from '@/lib/tally-poll';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Origem inválida.' }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: 'Entre novamente.' }, { status: 401 }); }
  try { return Response.json(await pollTally()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Falha ao sincronizar Tally.' }, { status: 400 }); }
}
