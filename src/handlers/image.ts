/**
 * Image transformation handler — the core pipeline.
 *
 *   1. Parse `/i/{did}/{cid}/{params}` and normalize the transform.
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
import { jsonError } from '../utils/response';

const DID_PATTERN = /^did:(plc|web):[a-zA-Z0-9._:%-]+$/;
const CID_PATTERN = /^[a-zA-Z0-9]+$/;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function handleImageRequest(
	request: Request,
	url: URL,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	try {
		const pathMatch = url.pathname.match(/^\/i\/([^/]+)\/([^/]+)\/(.+)$/);
		if (!pathMatch) {
			return jsonError('Invalid URL format. Expected: /i/{did}/{cid}/{params}', 400);
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
			return serveFromR2(cached, ops.format);
		}

		return await handleCacheMiss(did, cid, ops, cacheKey, env, ctx);
	} catch (error) {
		console.error('Image request error:', error);
		return jsonError('Internal server error', 500);
	}
}

function serveFromR2(object: R2ObjectBody, format: Parameters<typeof contentTypeFor>[0]): Response {
	const headers = new Headers();
	headers.set('Content-Type', object.httpMetadata?.contentType ?? contentTypeFor(format));
	headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
	headers.set('X-Cache', 'HIT');
	return new Response(object.body, { headers });
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

	const sourceUrl =
		`${pdsEndpoint}/xrpc/com.atproto.sync.getBlob` +
		`?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;

	const imgproxyUrl = await buildSignedImgproxyUrl(sourceUrl, ops, env);
	const transformed = await fetch(imgproxyUrl);

	if (!transformed.ok) {
		if (transformed.status === 404) {
			return jsonError('Blob not found', 404);
		}
		return jsonError(`Transform failed: ${transformed.status}`, 502);
	}

	const contentType = transformed.headers.get('Content-Type') ?? contentTypeFor(ops.format);
	const bytes = await transformed.arrayBuffer();

	// Cache after responding so the store never adds to this request's latency.
	ctx.waitUntil(putCached(env, cacheKey, bytes, contentType));

	const headers = new Headers();
	headers.set('Content-Type', contentType);
	headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
	headers.set('X-Cache', 'MISS');
	return new Response(bytes, { headers });
}
