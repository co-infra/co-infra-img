/**
 * Environment bindings for the infra.coop worker.
 *
 * R2 bucket, KV namespace, and vars are declared in wrangler.jsonc; the
 * IMGPROXY_KEY / IMGPROXY_SALT secrets are set via `wrangler secret put`.
 */
export interface Env {
	// Durable cache for transformed blobs. Key: {did}/{cid}/{params_hash}.{format}.
	IMAGE_CACHE: R2Bucket;

	// DID -> PDS endpoint mappings (1 hour TTL).
	DID_CACHE: KVNamespace;

	// imgproxy base URL (on the VPS).
	IMGPROXY_URL: string;

	// imgproxy signed-URL HMAC key and salt (hex).
	IMGPROXY_KEY: string;
	IMGPROXY_SALT: string;

	// Shared token authenticating POST /admin/purge (the Jetstream consumer holds
	// the same value). Set via `wrangler secret put PURGE_TOKEN`.
	PURGE_TOKEN: string;
}
