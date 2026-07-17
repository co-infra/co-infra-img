import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { purgePrefix } from '../src/services/purge';

const DID = 'did:plc:purgetest';

// Storage is isolated and rolled back per test, so each test seeds its own data.
async function seed() {
	await env.IMAGE_CACHE.put(`${DID}/cidA/h1.webp`, new Uint8Array([1]));
	await env.IMAGE_CACHE.put(`${DID}/cidA/h2.jpg`, new Uint8Array([2]));
	await env.IMAGE_CACHE.put(`${DID}/cidB/h3.webp`, new Uint8Array([3]));
	await env.IMAGE_CACHE.put('did:plc:other/cidC/h4.webp', new Uint8Array([4]));
}

describe('purgePrefix', () => {
	it('removes only one blob when given a did/cid prefix', async () => {
		await seed();
		const removed = await purgePrefix(env, `${DID}/cidA/`);
		expect(removed).toBe(2);
		expect(await env.IMAGE_CACHE.get(`${DID}/cidA/h1.webp`)).toBeNull();
		expect(await env.IMAGE_CACHE.get(`${DID}/cidB/h3.webp`)).not.toBeNull();
	});

	it('removes every variant for an account when given a did prefix', async () => {
		await seed();
		const removed = await purgePrefix(env, `${DID}/`);
		expect(removed).toBe(3);
		expect(await env.IMAGE_CACHE.get(`${DID}/cidB/h3.webp`)).toBeNull();
		// A different account is untouched.
		expect(await env.IMAGE_CACHE.get('did:plc:other/cidC/h4.webp')).not.toBeNull();
	});

	it('returns 0 when nothing matches', async () => {
		expect(await purgePrefix(env, 'did:plc:nothinghere/')).toBe(0);
	});
});
