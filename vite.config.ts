import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    build({
      // The Hono cloudflare-pages preset only re-exports the app's default
      // export from the generated _worker.js entry, so a plain
      // `export { EventSyncRoom } from './durable-objects/...'` in
      // src/index.tsx would be dropped by the build. This hook appends a
      // named export to the generated entry module itself, which is what
      // Pages needs to find the Durable Object class at deploy time.
      entryContentAfterHooks: [
        () => `export { EventSyncRoom } from '/src/durable-objects/event-sync-room.ts'`
      ]
    }),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
