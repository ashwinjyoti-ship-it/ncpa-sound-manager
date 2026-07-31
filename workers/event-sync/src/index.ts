export { EventSyncRoom } from './event-sync-room'

// This Worker exists only to host the EventSyncRoom Durable Object class —
// the main app (a Cloudflare Pages project) binds to it remotely via
// `script_name` in its wrangler.jsonc. It has no routes of its own; nothing
// should ever call this Worker's fetch handler directly.
export default {
  async fetch(): Promise<Response> {
    return new Response('ncpa-event-sync: Durable Object host, no direct routes.', { status: 404 })
  }
}
