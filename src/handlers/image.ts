/**
 * Image transformation handler - the core pipeline.
 *
 *   1. Parse `/blob/{did}/{cid}/{params}` and normalize the transform.
 *   2. Look up the immutable R2 cache key.
 *        HIT  -> serve bytes straight from R2 (free-egress fast path).
 *        MISS -> resolve DID -> PDS, transform via a signed imgproxy URL,
 *                store the result in R2, serve it.
 *
 * Because CIDs are content hashes and the transform is fully described by the
 * cache key, results are immutable and served with a one-year immutable header.
 */
import type { Env } from '../env';
import { resolveDid, isValidPdsHost } from '../services/did';
import { parseImageOps } from '../services/params';
import { buildCacheKey, contentTypeFor, putCached } from '../services/cache';
import { buildSignedImgproxyUrl } from '../services/imgproxy';
import { purgePrefix } from '../services/purge';
import { jsonError, CORS_HEADERS } from '../utils/response';

const DID_PATTERN = /^did:(plc|web):[a-zA-Z0-9._:%-]+$/;
const CID_PATTERN = /^[a-zA-Z0-9]+$/;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

// After this long, a served cache entry is rechecked against its PDS, off the
// hot path. Kept below the R2 lifecycle window so a live entry is re-put (which
// resets its age) before lifecycle would evict it.
const REVALIDATE_AFTER_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

/**
 * Maps an imgproxy error status to a clear client-facing error. imgproxy passes
 * the source (PDS) status through, and atproto's `getBlob` returns 400
 * (`BlobNotFound`), or 404 on some PDSes, for a missing blob, so those mean
 * "blob not found", not a transform failure. 422 means the blob exists but
 * isn't a processable image; anything else is a genuine upstream failure.
 */
export function classifyTransformError(imgproxyStatus: number): { message: string; status: number } {
	if (imgproxyStatus === 400 || imgproxyStatus === 404) {
		return { message: 'Blob not found', status: 404 };
	}

	if (imgproxyStatus === 422) {
		return { message: 'Source is not a processable image', status: 422 };
	}

	return { message: `Upstream transform failed (imgproxy ${imgproxyStatus})`, status: 502 };
}

export async function handleImageRequest(
	request: Request,
	url: URL,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	try {
		const pathMatch = url.pathname.match(/^\/blob\/([^/]+)\/([^/]+)\/(.+)$/);
		if (!pathMatch) {
			return jsonError('Invalid URL format. Expected: /blob/{did}/{cid}/{params}', 400);
		}

		const [, didEncoded, cid, paramsString] = pathMatch;
		const did = decodeURIComponent(didEncoded);

		if (!DID_PATTERN.test(did)) {
			return jsonError('Invalid DID format', 400);
		}

		if (!CID_PATTERN.test(cid)) {
			return jsonError('Invalid CID format', 400);
		}

		const ops = parseImageOps(paramsString, request.headers.get('Accept'));
		const cacheKey = await buildCacheKey(did, cid, ops);

		const cached = await env.IMAGE_CACHE.get(cacheKey);
		if (cached) {
			return serveCached(cached, did, cid, cacheKey, ops.format, env, ctx);
		}

		return await handleCacheMiss(did, cid, ops, cacheKey, env, ctx);
	} catch (error) {
		console.error('Image request error:', error);
		return jsonError('Internal server error', 500);
	}
}

/**
 * Serves a cached variant. Within the revalidation window, it streams straight
 * from R2. Older than that, it is served immediately and, off the hot path, the
 * source blob is rechecked: the variant is re-put to reset its age if the blob
 * still exists, or every variant is purged if the blob is gone.
 */
async function serveCached(
	object: R2ObjectBody,
	did: string,
	cid: string,
	cacheKey: string,
	format: Parameters<typeof contentTypeFor>[0],
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	const contentType = object.httpMetadata?.contentType ?? contentTypeFor(format);

	if (Date.now() - object.uploaded.getTime() <= REVALIDATE_AFTER_MS) {
		return serveResponse(object.body, contentType, 'HIT');
	}

	// Buffer so the same bytes serve this request and re-put on revalidation.
	const bytes = await object.arrayBuffer();
	ctx.waitUntil(revalidateBlob(did, cid, cacheKey, bytes, contentType, env));
	return serveResponse(bytes, contentType, 'HIT');
}

function serveResponse(body: BodyInit, contentType: string, xCache: string): Response {
	const headers = new Headers(CORS_HEADERS);
	headers.set('Content-Type', contentType);
	headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
	headers.set('X-Cache', xCache);
	return new Response(body, { headers });
}

function blobSourceUrl(pdsEndpoint: string, did: string, cid: string): string {
	return (
		`${pdsEndpoint}/xrpc/com.atproto.sync.getBlob` +
		`?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
	);
}

/**
 * Rechecks a blob against its PDS. A 400 or 404 means it is gone (atproto
 * returns 400 BlobNotFound, some PDSes 404), so every variant is purged. If it
 * still exists, the served variant is re-put to reset its age. Transient errors
 * are ignored, leaving the entry to be rechecked on a later request.
 */
async function revalidateBlob(
	did: string,
	cid: string,
	cacheKey: string,
	bytes: ArrayBuffer,
	contentType: string,
	env: Env
): Promise<void> {
	const pdsEndpoint = await resolveDid(did, env);
	if (!pdsEndpoint || !isValidPdsHost(pdsEndpoint)) {
		return;
	}

	let res: Response;
	try {
		res = await fetch(blobSourceUrl(pdsEndpoint, did, cid), { headers: { Range: 'bytes=0-0' } });
	} catch {
		return;
	}

	if (res.status === 404 || res.status === 400) {
		await purgePrefix(env, `${did}/${cid}/`);
		return;
	}

	if (res.ok) {
		await env.IMAGE_CACHE.put(cacheKey, bytes, { httpMetadata: { contentType } });
	}
}

async function handleCacheMiss(
	did: string,
	cid: string,
	ops: ReturnType<typeof parseImageOps>,
	cacheKey: string,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	const pdsEndpoint = await resolveDid(did, env);
	if (!pdsEndpoint) {
		return jsonError('Could not resolve DID to PDS', 404);
	}

	if (!isValidPdsHost(pdsEndpoint)) {
		return jsonError('Invalid PDS endpoint', 403);
	}

	const sourceUrl = blobSourceUrl(pdsEndpoint, did, cid);
	const imgproxyUrl = await buildSignedImgproxyUrl(sourceUrl, ops, env);
	const transformed = await fetch(imgproxyUrl);

	if (!transformed.ok) {
		const { message, status } = classifyTransformError(transformed.status);
		return jsonError(message, status);
	}

	const contentType = transformed.headers.get('Content-Type') ?? contentTypeFor(ops.format);
	const bytes = await transformed.arrayBuffer();

	// Cache after responding so the store never adds to this request's latency.
	ctx.waitUntil(putCached(env, cacheKey, bytes, contentType));

	return serveResponse(bytes, contentType, 'MISS');
}
