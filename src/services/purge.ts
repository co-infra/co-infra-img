/**
 * Deletes cached variants from R2. Because keys are `{did}/{cid}/{hash}.{ext}`,
 * a prefix of `{did}/` removes every variant for an account and `{did}/{cid}/`
 * removes every variant of one blob.
 */
import type { Env } from '../env';

/** Deletes every cached object under a key prefix. Returns how many were removed. */
export async function purgePrefix(env: Env, prefix: string): Promise<number> {
	let cursor: string | undefined;
	let removed = 0;

	do {
		const listing = await env.IMAGE_CACHE.list({ prefix, cursor, limit: 1000 });
		const keys = listing.objects.map((object) => object.key);

		if (keys.length > 0) {
			await env.IMAGE_CACHE.delete(keys);
			removed += keys.length;
		}

		cursor = listing.truncated ? listing.cursor : undefined;
	} while (cursor);

	return removed;
}
