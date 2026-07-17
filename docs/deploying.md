# Deploying the co/infra image CDN

A full setup from a fresh start. The CDN is a Cloudflare Worker that reads and writes a
cache, resolves DIDs, and calls an imgproxy backend to do the image work.

## What you need

- A Cloudflare account with Workers and R2 enabled. R2 is Cloudflare's object storage.
  Turning it on is a one-time step in the dashboard.
- An imgproxy instance reachable over HTTPS and configured to require signed URLs. imgproxy
  does the resizing and format conversion. co/infra runs it on a shared Docker host (see the
  `co-infra-ops` repo), but any imgproxy that accepts signed URLs works.
- Node, npm, and the Wrangler CLI. `npm install` brings Wrangler in as a dev dependency.

## The pieces

The Worker uses three bindings and two secrets, declared in `wrangler.jsonc`:

- `IMAGE_CACHE`, an R2 bucket that stores transformed images.
- `DID_CACHE`, a KV namespace (Cloudflare's key-value store) that caches DID to PDS lookups
  for an hour.
- `IMGPROXY_URL`, the base URL of your imgproxy instance.
- `IMGPROXY_KEY` and `IMGPROXY_SALT`, the signing secrets. They must match the values
  imgproxy is configured with, or every request fails its signature check.
- `PURGE_TOKEN`, a shared secret that authenticates `POST /admin/purge`. The Jetstream
  consumer holds the same value. See Cache invalidation below.

## Steps

1. Clone and install.

   ```bash
   git clone https://github.com/co-infra/co-infra-img.git
   cd co-infra-img
   npm install
   ```

2. Create the storage on your account.

   ```bash
   wrangler r2 bucket create co-infra-img-cache
   wrangler kv namespace create DID_CACHE
   ```

   The KV command prints an id. Put it in `wrangler.jsonc` under the `DID_CACHE` binding. Set
   `account_id` at the top of `wrangler.jsonc` to your account, and set the R2 `bucket_name`
   to the bucket you created.

3. Point the Worker at your imgproxy. Set `IMGPROXY_URL` in `wrangler.jsonc`, for example
   `https://imgproxy.example.com`.

4. Set the secrets. Use the same imgproxy key and salt that imgproxy is configured with, and
   a purge token of your choosing (the Jetstream consumer will hold the same value).

   ```bash
   wrangler secret put IMGPROXY_KEY
   wrangler secret put IMGPROXY_SALT
   wrangler secret put PURGE_TOKEN
   ```

5. Deploy.

   ```bash
   npx wrangler deploy
   ```

   Wrangler prints the deployed URL. By default the Worker is reachable on a `workers.dev`
   subdomain.

6. Serve it from your own domain (optional). Add the domain as a Custom Domain on the Worker
   in the Cloudflare dashboard, or add a route to `wrangler.jsonc`. To make the custom domain
   the only public URL, set `workers_dev` to `false` in `wrangler.jsonc`.

## Automatic deploys (optional)

Two ways to deploy on every push. Pick one.

**GitHub Actions.** The repo ships a workflow that runs `wrangler deploy` on every merge to
`main`. To use it, add a repository secret named `CLOUDFLARE_API_TOKEN` with a token scoped
to your account. The token needs Workers Scripts edit, Workers R2 Storage edit, Workers KV
Storage edit, and Account Settings read. The account id is read from `wrangler.jsonc`, so no
other secret is needed.

**Cloudflare Git connection.** In the Cloudflare dashboard, open the Worker, go to its build
settings, and connect the repository (Workers Builds). Cloudflare builds and deploys on
every push to the branch you choose, using its own GitHub connection, so there is no API
token to manage. If you use this, delete the GitHub Actions deploy workflow so both do not
deploy on the same push.

## Verifying

Request a real image and check the cache header.

```bash
curl -sD - -o /dev/null "https://<your-host>/blob/<did>/<cid>/w=512,f=webp" | grep -i x-cache
```

The first request returns `X-Cache: MISS` and stores the result. A second request for the
same URL returns `X-Cache: HIT` and is served from the cache.

## Cache invalidation

The cache follows the source. Deleted blobs are removed and cold variants are evicted, in
three ways that work together:

- **Account deletion (instant).** A Jetstream consumer watches the firehose for accounts that
  go inactive and calls `POST /admin/purge` with the DID. See the `co-infra-ops` repo for the
  consumer. The endpoint takes `{"did": "..."}` (or `{"did": "...", "cid": "..."}` for one
  blob), authenticated with `Authorization: Bearer $PURGE_TOKEN`, and deletes every cached
  variant under that prefix.
- **Single-blob deletion (on access).** When a cached variant older than 15 days is served,
  the Worker rechecks the source blob against its PDS off the hot path. If the blob is gone it
  purges every variant. If it still exists it re-puts the variant, which resets its age.
- **Cold eviction (storage).** Add an R2 lifecycle rule on the cache bucket to delete objects
  about 30 days after they were last written. Because the re-put above resets the age of live
  content, only genuinely cold variants age out. Set this in the R2 dashboard under the
  bucket's Settings, object lifecycle rules, delete after 30 days.

Keep the lifecycle window (30 days) comfortably larger than the revalidation window (15 days)
so an access always gets the chance to re-put and keep live content from being evicted.
