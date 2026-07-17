# co/infra image CDN

A public image CDN for the AT Protocol. Point an image tag at it and get a fast, optimized
image, with no signup and no keys.

The public instance runs at `img.infra.coop` and is free to use. See [Attribution](#attribution).

## What it is

AT Protocol apps store images as blobs. A blob is a raw file, like a JPEG, that lives in a
user's repository on their PDS (the personal data server that hosts that user's data). Each
blob is addressed by a CID, a hash of the file's contents. Each account is identified by a
DID, a stable account id.

To show one of those images you would normally link straight to the blob on the PDS. That
file is full size and unoptimized, so pages load slowly. The co/infra image CDN sits in
front of it and serves a resized, reformatted, edge-cached version instead.

You give it a DID, a CID, and a set of transform options in the URL. It returns the finished
image.

## How it works

1. A browser requests an image from the CDN with a DID, a CID, and transform options.
2. The CDN builds a cache key from those values and checks its cache, which is Cloudflare R2
   object storage. On a hit it returns the stored image right away.
3. On a miss it resolves the DID to find the account's PDS, fetches the blob, and transforms
   it with imgproxy (resize, crop, format conversion, and more).
4. It stores the result in the cache and returns it with long-lived cache headers.

A CID is a content hash, so the bytes behind it never change. A transformed result is
therefore safe to reuse, and a popular image is transformed once and served from cache every
time after that, which keeps the service fast and cheap. The cache follows the source: when a
blob is deleted the cached variants are removed, and variants that go unaccessed for about a
month are evicted.

## Using it

URL format:

```
https://img.infra.coop/blob/{did}/{cid}/{params}
```

- `did` is the account id (`did:plc:...` or `did:web:...`), URL-encoded.
- `cid` is the content hash of the blob.
- `params` is a comma-separated list of transform options.

### Transform options

| Short | Long | What it does | Range |
|---|---|---|---|
| `w` | `width` | Width in pixels | 1 to 4096 |
| `h` | `height` | Height in pixels | 1 to 4096 |
| `q` | `quality` | Compression quality | 1 to 100, default 85 |
| `f` | `format` | Output format | `auto`, `webp`, `avif`, `jpeg`, `png`, `gif` |
| `fit` | | How to fit the target box | `cover`, `contain`, `pad`, `scale-down` |
| `g` | `gravity` | Crop focus | `auto`, `left`, `right`, `top`, `bottom`, or a point like `0.5x0.3` |
| `blur` | | Blur strength | 1 to 250 |
| `rotate` | | Rotation in degrees | 90, 180, 270 |

Values outside a range are clamped rather than rejected. With `f=auto` (or no format set)
the CDN picks the best format the browser accepts, preferring AVIF, then WebP, then JPEG. It
chooses one format per request so each result caches as a single entry.

`fit=pad` fits the image inside the box and pads the rest out to the exact width and height,
so it needs both `w` and `h`. `g=auto` uses content-aware smart cropping that keeps the main
subject in frame. It is not face detection.

### Examples

```html
<!-- 800px wide, best format the browser supports -->
<img src="https://img.infra.coop/blob/did:plc:abc123/bafkrei.../w=800,f=auto" />

<!-- 200 by 200 avatar, smart-cropped to the subject -->
<img src="https://img.infra.coop/blob/did:plc:abc123/bafkrei.../w=200,h=200,fit=cover,g=auto" />

<!-- Tiny blurred placeholder -->
<img src="https://img.infra.coop/blob/did:plc:abc123/bafkrei.../w=20,blur=10,q=30" />
```

### Errors

- `400` for an invalid DID, CID, or URL.
- `404` when the DID does not resolve or the blob does not exist.
- `502` when the transform backend fails.

## Attribution

co/infra is free public infrastructure. If you use it, add a small acknowledgement linking
to `infra.coop` somewhere on your site. An acknowledgements page is fine. This is an
honor-system ask, not something enforced in code. A logo and badge are available at
[infra.coop](https://infra.coop).

## Running your own

The public instance is open to everyone, so most apps do not need their own. To run a
private instance, it is a Cloudflare Worker plus an imgproxy backend. See
[docs/deploying.md](docs/deploying.md) for a full setup from a fresh Cloudflare account.

## Development

```bash
npm install
npm run dev    # local worker via wrangler
npm test       # vitest
```

## License

Licensed under the GNU Affero General Public License, version 3 or later
(`AGPL-3.0-or-later`). See [LICENSE](LICENSE).
