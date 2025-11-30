# 🔧 Cloudflare Vectorize Setup Instructions

## Step 1: Create Vectorize Index via Dashboard

Since the API token needs additional permissions, create the index manually:

1. **Go to Cloudflare Dashboard:**
   - URL: https://dash.cloudflare.com/
   - Navigate to: **Workers & Pages** → **Vectorize**

2. **Create New Index:**
   - Click **"Create Index"**
   - **Index Name:** `ncpa-events-index`
   - **Dimensions:** `768` (for BGE-base-en-v1.5 embeddings)
   - **Metric:** `Cosine` (for semantic similarity)
   - Click **Create**

3. **Get Index ID:**
   - After creation, copy the **Index ID** (looks like: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

## Step 2: Update wrangler.jsonc

Add this to your `wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ncpa-sound",
  "compatibility_date": "2025-10-24",
  "pages_build_output_dir": "./dist",
  "compatibility_flags": ["nodejs_compat"],
  
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ncpa-sound-crew-db",
      "database_id": "8dd5bac9-26b7-45d7-94b3-7a013ec3e880"
    }
  ],
  
  "ai": {
    "binding": "AI"
  },
  
  // ADD THIS:
  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "ncpa-events-index"
    }
  ]
}
```

## Step 3: Verify Setup

Run this command to verify:

```bash
npx wrangler vectorize list
```

You should see `ncpa-events-index` in the list.

## Alternative: Update API Token Permissions

If you prefer to use Wrangler CLI:

1. **Go to:** https://dash.cloudflare.com/profile/api-tokens
2. **Edit your existing token** or **Create new token**
3. **Add permissions:**
   - Account → Vectorize → Edit
   - Account → Workers Scripts → Edit
   - Account → Workers R2 Storage → Edit (optional)
4. **Save and update** `CLOUDFLARE_API_TOKEN` environment variable

---

## 🧪 Test Vectorize After Setup

```bash
# Test embedding generation
npx wrangler vectorize insert ncpa-events-index \
  --id="test-1" \
  --values="[0.1, 0.2, ...]" \
  --metadata='{"test": true}'

# Test query
npx wrangler vectorize query ncpa-events-index \
  --values="[0.1, 0.2, ...]" \
  --top-k=5
```

---

**Status:** ⏳ Waiting for manual Vectorize index creation
**Next:** After setup, I'll update TypeScript bindings and implement RAG endpoints
