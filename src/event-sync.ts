// Shared helper for broadcasting event changes to every connected browser
// tab in real time via the EventSyncRoom Durable Object. See
// src/durable-objects/event-sync-room.ts for the "why a Durable Object"
// rationale. Kept separate from index.tsx so route modules (v41-endpoints.ts
// etc.) can call it without a circular import.
export type SyncEventRow = Record<string, unknown> & { id: number }

type SyncBindings = {
  DB: D1Database
  EVENT_SYNC: DurableObjectNamespace
}

export async function broadcastEventSync(
  env: SyncBindings,
  message:
    | { type: 'events:upsert'; events: SyncEventRow[] }
    | { type: 'events:delete'; ids: number[] },
  originId?: string
) {
  try {
    if (!env.EVENT_SYNC) return
    const stub = env.EVENT_SYNC.get(env.EVENT_SYNC.idFromName('global'))
    const payload = JSON.stringify({ ...message, originId: originId || null, ts: Date.now() })
    await stub.fetch('https://event-sync/broadcast', { method: 'POST', body: payload })
  } catch (err) {
    // Real-time sync is best-effort — a broadcast failure must never fail
    // the underlying mutation that already succeeded against the DB.
    console.error('broadcastEventSync failed:', err)
  }
}

export async function broadcastUpsertByIds(
  env: SyncBindings,
  db: D1Database,
  ids: number[],
  originId?: string
) {
  const cleanIds = ids.filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
  if (cleanIds.length === 0) return
  const ph = cleanIds.map(() => '?').join(',')
  const rows = await db.prepare(`SELECT * FROM events WHERE id IN (${ph})`).bind(...cleanIds).all()
  const events = (rows.results || []) as SyncEventRow[]
  if (events.length === 0) return
  await broadcastEventSync(env, { type: 'events:upsert', events }, originId)
}
