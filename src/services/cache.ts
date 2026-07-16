/**
 * R2 durable cache for transformed blobs.
 *
 * Key: `{did}/{cid}/{opsHash}.{ext}`. Because CIDs are content hashes and the
 * transform is fully described by `opsHash`, an entry is immutable forever -
 * no TTL, no invalidation. Serving from R2 is the free-egress fast path that
 * the whole economic model rests on.
 */
import type { Env } from '../env';
import type { ImageOps, OutputFormat } from './params';
import { FORMAT_CONTENT_TYPE, FORMAT_EXTENSION, opsToken } from './params';
import { sha256Hex } from '../utils/crypto';

/** Derives the immutable R2 key for a (did, cid, transform) triple. */
export async function buildCacheKey(did: string, cid: string, ops: ImageOps): Promise<string> {
	const hash = (await sha256Hex(opsToken(ops))).slice(0, 24);
	return `${did}/${cid}/${hash}.${FORMAT_EXTENSION[ops.format]}`;
}

export function contentTypeFor(format: OutputFormat): string {
	return FORMAT_CONTENT_TYPE[format];
}

/** Stores a transformed image, recording its content type for later reads. */
export async function putCached(
	env: Env,
	key: string,
	body: ArrayBuffer,
	contentType: string
): Promise<void> {
	await env.IMAGE_CACHE.put(key, body, {
		httpMetadata: { contentType },
	});
}
