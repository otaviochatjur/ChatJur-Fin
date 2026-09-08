import { requireUser, sameOrigin } from '@/lib/auth-server';
import { supabaseRequest } from '@/lib/supabase-server';
import { scheduleSchema } from '@/lib/collection-schedule';
import { advanceSchedule, readSchedule, type ScheduleJob } from '@/lib/collection-schedule-server';
export async function GET() {
  try { await requireUser(); } catch { return Response.json({ error: 'Entre novamente.' }, { status: 401 }); }
  try {
    const [config, jobs] = await Promise.all([readSchedule(), supabaseRequest<ScheduleJob[]>('/rest/v1/collection_schedule_jobs?select=run_date,status,instance_id,cursor,sent,skipped,error,updated_at&order=run_date.desc&limit=15')]);
    return Response.json({ config, jobs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Falha ao consultar programação.' }, { status: 400 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Origem inválida.' }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: 'Entre novamente.' }, { status: 401 }); }
  try {
    const body = await request.json();
    if (body.action === 'tick') return Response.json(await advanceSchedule());
    const parsed = scheduleSchema.safeParse(body.config);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Informe um horário válido e as opções de envio.' }, { status: 400 });
    await supabaseRequest('/rest/v1/collection_schedule?on_conflict=tenant_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { config: parsed.data, updated_at: new Date().toISOString() } });
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Falha na programação.' }, { status: 400 }); }
}
