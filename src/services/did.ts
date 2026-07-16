/**
 * DID resolution with KV caching.
 *
 * Resolves an AT Protocol DID to its PDS endpoint via plc.directory
 * (did:plc) or a .well-known document (did:web), caching the result for
 * one hour so PDS migrations are picked up without a deploy.
 *
 * Ported verbatim from Refract - this logic is identical across both services.
 */
import type { Env } from '../env';

interface DidDocument {
	id: string;
	service?: Array<{
		id: string;
		type: string;
		serviceEndpoint: string;
	}>;
}

const CACHE_TTL_SECONDS = 3600; // 1 hour

export async function resolveDid(did: string, env: Env): Promise<string | null> {
	const cacheKey = `did:${did}`;
	const cached = await env.DID_CACHE.get(cacheKey);

	if (cached) {
		return cached;
	}

	const pdsEndpoint = await resolveFromNetwork(did);

	if (pdsEndpoint) {
		await env.DID_CACHE.put(cacheKey, pdsEndpoint, { expirationTtl: CACHE_TTL_SECONDS });
	}

	return pdsEndpoint;
}

async function resolveFromNetwork(did: string): Promise<string | null> {
	if (did.startsWith('did:plc:')) {
		return resolvePlcDid(did);
	}

	if (did.startsWith('did:web:')) {
		return resolveWebDid(did);
	}

	console.error('Unknown DID method:', did);
	return null;
}

async function resolvePlcDid(did: string): Promise<string | null> {
	try {
		const response = await fetch(`https://plc.directory/${did}`, {
			headers: { Accept: 'application/json' },
		});

		if (!response.ok) {
			console.error(`PLC resolution failed for ${did}: ${response.status}`);
			return null;
		}

		const doc = (await response.json()) as DidDocument;
		return extractPdsEndpoint(doc);
	} catch (error) {
		console.error(`PLC resolution error for ${did}:`, error);
		return null;
	}
}

async function resolveWebDid(did: string): Promise<string | null> {
	try {
		// did:web:example.com          -> https://example.com/.well-known/did.json
		// did:web:example.com:path:to  -> https://example.com/path/to/did.json
		const domain = did.replace('did:web:', '').replace(/:/g, '/');
		const hasPath = did.includes(':', 'did:web:'.length);

		const url = hasPath
			? `https://${domain}/did.json`
			: `https://${domain}/.well-known/did.json`;

		const response = await fetch(url, {
			headers: { Accept: 'application/json' },
		});

		if (!response.ok) {
			console.error(`Web DID resolution failed for ${did}: ${response.status}`);
			return null;
		}

		const doc = (await response.json()) as DidDocument;
		return extractPdsEndpoint(doc);
	} catch (error) {
		console.error(`Web DID resolution error for ${did}:`, error);
		return null;
	}
}

function extractPdsEndpoint(doc: DidDocument): string | null {
	const pdsService = doc.service?.find(
		(s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
	);

	return pdsService?.serviceEndpoint || null;
}

/**
 * Guards against the resolved DID document pointing somewhere unexpected.
 * DID resolution already establishes the endpoint is what the DID owner
 * declared; we only enforce HTTPS here.
 */
export function isValidPdsHost(pdsEndpoint: string): boolean {
	try {
		const url = new URL(pdsEndpoint);
		return url.protocol === 'https:';
	} catch {
		return false;
	}
}
