import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { parseImageOps } from '../src/services/params';
import { buildCacheKey } from '../src/services/cache';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function dispatch(request: Request) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe('img.infra.coop worker', () => {
	describe('Health & info', () => {
		it('returns 200 OK for /health', async () => {
			const res = await dispatch(new IncomingRequest('https://img.infra.coop/health'));
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('OK');
		});

		it('returns service info for /', async () => {
			const res = await dispatch(new IncomingRequest('https://img.infra.coop/'));
			expect(res.status).toBe(200);
			const body = (await res.json()) as { name: string };
			expect(body.name).toBe('img.infra.coop');
		});

		it('returns 404 for unknown paths', async () => {
			const res = await dispatch(new IncomingRequest('https://img.infra.coop/nope'));
			expect(res.status).toBe(404);
		});
	});

	describe('Image request validation', () => {
		it('400s on a malformed path (missing params)', async () => {
			const res = await dispatch(new IncomingRequest('https://img.infra.coop/blob/did:plc:abc/bafkrei'));
			expect(res.status).toBe(400);
		});

		it('400s on an invalid DID', async () => {
			const res = await dispatch(
				new IncomingRequest('https://img.infra.coop/blob/not-a-did/bafkrei/w=400')
			);
			expect(res.status).toBe(400);
		});

		it('400s on an invalid CID', async () => {
			const res = await dispatch(
				new IncomingRequest('https://img.infra.coop/blob/did:plc:abc/bad%2Fcid/w=400')
			);
			expect(res.status).toBe(400);
		});
	});

	describe('R2 cache hit path', () => {
		it('serves stored bytes directly with X-Cache: HIT', async () => {
			const did = 'did:plc:cachehit';
			const cid = 'bafkreicachehit';
			const ops = parseImageOps('w=400,f=webp', null);
			const key = await buildCacheKey(did, cid, ops);

			const bytes = new Uint8Array([1, 2, 3, 4]);
			await env.IMAGE_CACHE.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } });

			const res = await dispatch(
				new IncomingRequest(`https://img.infra.coop/blob/${did}/${cid}/w=400,f=webp`)
			);

			expect(res.status).toBe(200);
			expect(res.headers.get('X-Cache')).toBe('HIT');
			expect(res.headers.get('Content-Type')).toBe('image/webp');
			expect(res.headers.get('Cache-Control')).toContain('immutable');
			expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
		});
	});
});
