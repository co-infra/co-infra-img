# img.infra.coop

**Public, free, at-scale image CDN for the AT Protocol ecosystem.**

The first service in the [infra.coop](https://infra.coop) cooperative — community-owned
public infrastructure for the open social web. This repo is the image CDN specifically;
the `infra.coop` umbrella site (project index, supporters/sponsors, per-project about
pages, membership) is a separate project.

A community-owned image transformation service for ATProto blobs. No signup, no API
keys, no billing — any app can point `<img>` tags at it and get fast, optimized,
edge-cached images pulled straight from users' PDSes.

```
https://img.infra.coop/i/{did}/{cid}/{params}
```

## Why (and how this differs from Refract)

[Refract](../refract-worker) already solves image optimization for ATProto — but it's
built for **app developers who self-host** a worker for their own, small-scope image
needs. It transforms inline at the edge with Cloudflare Image Resizing (`cf.image`),
which bills **per unique transform**.

That model breaks as a **public utility at scale**. The same image (a viral blog cover,
a common avatar) is high-fanout across many apps, and a genuinely public service sees a
long tail of sizes/formats. At ~100M requests/month, `cf.image` runs to **~$50k/mo** —
untenable for something free.

infra.coop keeps Refract's URL contract and DID-resolution logic but swaps the
**transform + cache layer**:

- **imgproxy** on a VPS does the actual transformation (fixed cost, not per-transform).
- **Cloudflare R2** is the durable cache — transform once, store forever (CIDs are
  immutable), **free egress** through Cloudflare's CDN.
- The **Worker** just routes: check R2 → hit serves directly; miss proxies to imgproxy,
  stores the result, serves it.

The same 100M req/mo lands around **~$150/mo**. That's the whole reason this is a
separate project: at public-utility scale, per-transform billing doesn't work, so the
architecture has to change.

| | Refract (self-host) | infra.coop (public utility) |
|---|---|---|
| Audience | One app, self-hosted | Whole ecosystem, hosted |
| Transform | `cf.image` at edge | imgproxy on VPS |
| Cache | CF edge cache (evictable) | R2 (durable) + edge |
| Cost @100M/mo | ~$50k | ~$150 |
| Access control | Referrer allowlist | Attribution (badge) |
| Model | You run it | Community co-op, pay-what-you-want |

## Architecture

```
browser ──▶ Cloudflare Worker (img.infra.coop)
                │
                ├─ 1. parse {did}/{cid}/{params}, build cache key
                ├─ 2. R2 GET  ──▶ HIT: serve bytes (free egress)  ✅
                │
                └─ 3. MISS:
                     ├─ resolve DID ─▶ PDS endpoint (KV cache, 1h)
                     ├─ imgproxy fetches blob from PDS, transforms
                     ├─ R2 PUT the result
                     └─ serve bytes + immutable cache headers
```

- **Worker** — edge router. Reuses Refract's DID resolution, CID/param parsing, URL
  contract.
- **R2** — cache store. Key: `{did}/{cid}/{params_hash}.{format}`. No TTL (CIDs are
  immutable). Free egress is the economic keystone.
- **KV** — DID → PDS endpoint mappings (1h TTL).
- **imgproxy** — transform engine on a cheap VPS (Hetzner). Only touched on cache miss;
  hot content approaches 100% hit ratio and never hits it.

## URL format

```
https://img.infra.coop/i/{did}/{cid}/{params}
```

`params` is a comma-separated list (Refract's vocabulary, so URLs port over). It resolves
to imgproxy processing options internally.

| Short | Long | Description | Notes |
|-------|------|-------------|-------|
| `w` | `width` | Width (px) | 1–4096, clamped |
| `h` | `height` | Height (px) | 1–4096, clamped |
| `q` | `quality` | Quality | 1–100, default 85 |
| `f` | `format` | `auto`/`webp`/`avif`/`jpeg`/`png`/`gif` | `auto` negotiates AVIF > WebP > JPEG from `Accept` |
| `fit` | | `cover`/`crop`/`contain`/`pad`/`scale-down` | `cover`/`crop` → imgproxy `fill`; others → `fit`; only `contain`/`pad`/`cover`/`crop` upscale |
| `g` | `gravity` | `face`/`auto`/`left`/`right`/`top`/`bottom`/`0.5x0.3` | `face`/`auto` → smart gravity; coords → focus point |
| `blur` | | Blur sigma | 1–250 |
| `rotate` | | `90`/`180`/`270` | |

`f=auto` is negotiated into a concrete format *server-side* so each real format is one
deterministic cache entry (no `Vary`-driven cache explosion).

Examples:

- `w=800,f=auto` — 800px wide, best format the client supports
- `w=200,h=200,fit=cover,g=face` — 200×200 face-aware avatar
- `w=20,blur=10,q=30` — tiny blurred placeholder

## POC question

**Is R2 + imgproxy behind a Worker a correct and cheap enough pipeline to serve
transformed ATProto blobs as a free public utility at scale?**

Specifically:
1. Can the Worker ↔ imgproxy ↔ R2 round-trip serve a transformed blob correctly on a
   cold miss, and serve from R2 on a warm hit?
2. Does the cache-key / immutability model hold (same URL → same bytes, forever)?
3. Does the cost model survive contact with real imgproxy throughput on a small VPS?

## Status

🚧 **Pipeline built + unit-tested, not yet deployed.** The Worker (routing, R2 cache,
signed imgproxy URLs) is implemented and green under vitest (27 tests). End-to-end
verification is blocked on standing up the imgproxy box — the cold-miss path can't be
exercised for real until then.

## Roadmap

**Phase 1 — Prove the pipeline**
- [x] Worker: route, R2 cache-key, hit/miss branching
- [x] Signed imgproxy URL construction (HMAC-SHA256, base64url source)
- [x] R2 hit path serves stored bytes (unit-tested)
- [ ] imgproxy: deploy on VPS, signed-URL config, PDS-origin allowance
- [ ] Worker → imgproxy → R2 store → serve on a real cold miss
- [ ] Verify byte-identical warm hit + cache headers against a live box
- [ ] Cost/throughput measurement on a $10–20 VPS

**Phase 2 — Public-ready**
- [ ] Attribution model (badge) replacing referrer allowlist
- [ ] Abuse/hotlink protection appropriate for an open endpoint
- [ ] Integration docs + attribution badge assets
- [ ] Announce to ATProto community

> The `infra.coop` umbrella site (project index, supporters/sponsors, about pages),
> Stripe pay-what-you-want membership, and future services (relay, labeler) live in
> **separate projects**, not this repo. This repo is scoped to the image CDN.

## Development

```bash
npm install
npm run dev    # wrangler dev
npm test       # vitest
```

## License

MIT
