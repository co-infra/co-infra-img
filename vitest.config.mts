import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				// Per-test R2 storage isolation hits a known .sqlite-shm pop bug in
				// this pool version. Tests use distinct keys, so persistent storage
				// is fine.
				isolatedStorage: false,
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					bindings: {
						IMGPROXY_URL: 'https://imgproxy.test',
						// Deterministic hex key/salt for signature tests.
						IMGPROXY_KEY: '0011223344556677',
						IMGPROXY_SALT: '8899aabbccddeeff',
						PURGE_TOKEN: 'test-purge-token',
					},
					kvNamespaces: ['DID_CACHE'],
					r2Buckets: ['IMAGE_CACHE'],
				},
			},
		},
	},
});
