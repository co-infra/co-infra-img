import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { parseImageOps } from '../src/services/params';
import { buildProcessingOptions, buildSignedImgproxyUrl } from '../src/services/imgproxy';

const SOURCE = 'https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did:plc:abc&cid=bafkrei';

describe('buildProcessingOptions', () => {
	it('emits resize, gravity, quality, blur and rotate in canonical order', () => {
		const ops = parseImageOps('w=800,h=600,fit=cover,g=face,q=70,blur=5,rotate=90', null);
		expect(buildProcessingOptions(ops)).toBe('rs:fill:800:600:1/g:sm/q:70/bl:5/rot:90');
	});

	it('omits resize entirely when neither width nor height is given', () => {
		const ops = parseImageOps('q=90', null);
		expect(buildProcessingOptions(ops)).toBe('q:90');
	});

	it('treats a missing dimension as 0 (unbounded)', () => {
		const ops = parseImageOps('w=400', null);
		expect(buildProcessingOptions(ops)).toBe('rs:fit:400:0:0/q:85');
	});
});

describe('buildSignedImgproxyUrl', () => {
	it('produces a well-formed signed URL under the imgproxy base', async () => {
		const ops = parseImageOps('w=400,f=webp', null);
		const url = await buildSignedImgproxyUrl(SOURCE, ops, env);

		expect(url.startsWith('https://imgproxy.test/')).toBe(true);
		// /{signature}/{processing}/{base64source}.webp
		const path = url.slice('https://imgproxy.test/'.length);
		const segments = path.split('/');
		expect(segments.length).toBeGreaterThanOrEqual(3);
		expect(segments[0]).toMatch(/^[A-Za-z0-9_-]+$/); // url-safe base64 signature
		expect(path.endsWith('.webp')).toBe(true);
	});

	it('is deterministic for identical inputs', async () => {
		const ops = parseImageOps('w=400,f=webp', null);
		const a = await buildSignedImgproxyUrl(SOURCE, ops, env);
		const b = await buildSignedImgproxyUrl(SOURCE, ops, env);
		expect(a).toBe(b);
	});

	it('changes the signature when the transform changes', async () => {
		const a = await buildSignedImgproxyUrl(SOURCE, parseImageOps('w=400,f=webp', null), env);
		const b = await buildSignedImgproxyUrl(SOURCE, parseImageOps('w=401,f=webp', null), env);
		expect(a).not.toBe(b);
	});
});
