// Durable Object that fans out event-change notifications to every connected
// browser tab in real time, over a single shared WebSocket "room".
//
// Why a Durable Object: Cloudflare Workers/Pages requests are stateless and
// can land on any isolate, so there is no in-memory list of "who's currently
// looking at the calendar" to push updates to. A Durable Object is the one
// Cloudflare-native primitive that pins a single instance (and its socket
// list) to one location, letting us broadcast a DB write to every open tab
// instantly instead of having clients poll for changes.
//
// Uses the WebSocket Hibernation API (`acceptWebSocket`) so idle connections
// don't keep this Durable Object billed/running, and `setWebSocketAutoResponse`
// so client heartbeat pings are answered at the edge without waking it at all.
//
// This lives in its own Worker (workers/event-sync/), separate from the main
// Pages project: Cloudflare Pages' wrangler config doesn't support the
// "migrations" key that Durable Object classes require, and a Durable Object
// binding on a Pages project must point at an external Worker via
// `script_name` rather than defining the class locally (see the main app's
// wrangler.jsonc `durable_objects` binding and src/event-sync.ts, which talks
// to this object with a plain internal `fetch()` call rather than RPC).
const HEARTBEAT_PING = 'ping'
const HEARTBEAT_PONG = 'pong'

export class EventSyncRoom {
  private ctx: DurableObjectState

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG)
    )
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Internal broadcast call from the main worker. Never reachable from
    // outside — this Durable Object has no public route of its own; the
    // only way in is the EVENT_SYNC binding on the calling worker.
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      const payload = await request.text()
      const sockets = this.ctx.getWebSockets()
      for (const ws of sockets) {
        try {
          ws.send(payload)
        } catch {
          // A socket that fails to send is already gone/closing; the
          // hibernation runtime reaps it, nothing more to do here.
        }
      }
      return new Response(JSON.stringify({ delivered: sockets.length }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket upgrade', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Hibernatable accept: the socket is tracked by the runtime, not by any
    // in-memory field on this object, so it survives the DO hibernating.
    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(): Promise<void> {
    // No client-initiated commands are supported yet — this room is
    // read-only from the client's perspective. Heartbeat pings never reach
    // here; they're answered by setWebSocketAutoResponse above.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error')
    } catch {
      // Already closed.
    }
  }
}
