/**
 * Admin purge endpoint. `POST /admin/purge`, authenticated with the shared
 * PURGE_TOKEN. Deletes every cached variant for a DID, or for a single DID plus
 * CID. The Jetstream consumer calls this to purge on account deletion, and the
 * Worker's own revalidation calls the same logic when a blob is gone.
 */
import type { Env } from '../env';
import { purgePrefix } from '../services/purge';
import { json, jsonError } from '../utils/response';

const DID_PATTERN = /^did:(plc|web):[a-zA-Z0-9._:%-]+$/;
const CID_PATTERN = /^[a-zA-Z0-9]+$/;

export async function handlePurge(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return jsonError('Method not allowed', 405);
	}

	if (!env.PURGE_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.PURGE_TOKEN}`) {
		return jsonError('Unauthorized', 401);
	}

	let body: { did?: unknown; cid?: unknown };
	try {
		body = await request.json();
	} catch {
		return jsonError('Invalid JSON body', 400);
	}

	const did = typeof body.did === 'string' ? body.did : '';
	if (!DID_PATTERN.test(did)) {
		return jsonError('Invalid or missing DID', 400);
	}

	const cid = typeof body.cid === 'string' ? body.cid : undefined;
	if (cid !== undefined && !CID_PATTERN.test(cid)) {
		return jsonError('Invalid CID', 400);
	}

	const purged = await purgePrefix(env, cid ? `${did}/${cid}/` : `${did}/`);
	return json({ purged });
}
