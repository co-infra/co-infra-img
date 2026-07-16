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

4. Set the signing secrets. Use the same key and salt that imgproxy is configured with.

   ```bash
   wrangler secret put IMGPROXY_KEY
   wrangler secret put IMGPROXY_SALT
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
curl -sD - -o /dev/null "https://<your-host>/i/<did>/<cid>/w=512,f=webp" | grep -i x-cache
```

The first request returns `X-Cache: MISS` and stores the result. A second request for the
same URL returns `X-Cache: HIT` and is served from the cache.
