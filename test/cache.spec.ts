import { describe, it, expect } from 'vitest';
import { parseImageOps } from '../src/services/params';
import { buildCacheKey } from '../src/services/cache';

const DID = 'did:plc:abc123';
const CID = 'bafkreixyz';

describe('buildCacheKey', () => {
	it('is `{did}/{cid}/{hash}.{ext}` with the format extension', async () => {
		const key = await buildCacheKey(DID, CID, parseImageOps('w=400,f=webp', null));
		expect(key).toMatch(new RegExp(`^${DID}/${CID}/[0-9a-f]{24}\\.webp$`));
	});

	it('maps jpeg to a .jpg extension', async () => {
		const key = await buildCacheKey(DID, CID, parseImageOps('w=400,f=jpg', null));
		expect(key.endsWith('.jpg')).toBe(true);
	});

	it('collapses equivalent transforms to the same key', async () => {
		const a = await buildCacheKey(DID, CID, parseImageOps('w=400,q=80,f=webp', null));
		const b = await buildCacheKey(DID, CID, parseImageOps('q=80,f=webp,width=400', null));
		expect(a).toBe(b);
	});

	it('separates different transforms into different keys', async () => {
		const a = await buildCacheKey(DID, CID, parseImageOps('w=400,f=webp', null));
		const b = await buildCacheKey(DID, CID, parseImageOps('w=800,f=webp', null));
		expect(a).not.toBe(b);
	});
});
