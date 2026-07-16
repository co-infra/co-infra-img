import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					bindings: {
						IMGPROXY_URL: 'https://imgproxy.test',
						// Deterministic hex key/salt for signature tests.
						IMGPROXY_KEY: '0011223344556677',
						IMGPROXY_SALT: '8899aabbccddeeff',
					},
					kvNamespaces: ['DID_CACHE'],
					r2Buckets: ['IMAGE_CACHE'],
				},
			},
		},
	},
});
