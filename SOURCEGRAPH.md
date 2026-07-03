# Sourcegraph Code Graph

This repository is configured for [Sourcegraph](https://sourcegraph.com) code navigation (precise go-to-definition, find references, and cross-repo intelligence).

## Repository

- **GitHub:** https://github.com/ashwinjyoti-ship-it/ncpa-sound-manager
- **Sourcegraph:** https://sourcegraph.com/github.com/ashwinjyoti-ship-it/ncpa-sound-manager

## Configuration

| File | Purpose |
|------|---------|
| `sourcegraph.yaml` | Auto-indexing jobs for Sourcegraph executors |
| `.github/workflows/sourcegraph.yml` | CI upload of SCIP indexes on push/PR to `main` |

## Indexed code units

```mermaid
flowchart TB
  subgraph backend["TypeScript backend (src/)"]
    index["index.tsx — Hono app entry"]
    auth["auth-endpoints.ts"]
    v41["v41-endpoints.ts"]
    crew["crew-assignment-engine.ts"]
    stats["crew-stats-endpoints.ts"]
    rag["rag-endpoint.ts / rag-utils.ts"]
    embed["backfill-embeddings.ts"]
    types["types.ts"]
    render["renderer.tsx"]
  end

  subgraph frontend["Vanilla JS frontend (public/static/)"]
    app["app.js — calendar/table UI"]
    v41js["v41-features.js"]
    authjs["auth.js"]
    style["style.css"]
  end

  subgraph data["Data layer"]
  d1["D1: ncpa-sound-crew-db"]
  crewdb["D1: ncpa-crew-db"]
  vec["Vectorize: ncpa-events-index"]
  end

  index --> auth
  index --> v41
  index --> crew
  index --> stats
  index --> rag
  index --> embed
  index --> render
  rag --> embed
  rag --> types
  crew --> types
  app -->|"fetch /api/*"| index
  v41js -->|"fetch /api/*"| index
  authjs -->|"fetch /api/auth/*"| auth
  index --> d1
  index --> crewdb
  rag --> vec
```

## Local one-off index (optional)

```bash
npm install -g @sourcegraph/scip-typescript @sourcegraph/src
npm install
scip-typescript index
src code-intel upload -github-token=<token>
```

For the frontend:

```bash
cd public/static
scip-typescript index --infer-tsconfig
src code-intel upload -github-token=<token>
```
