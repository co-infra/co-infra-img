/**
 * infra.coop — public image CDN for the AT Protocol.
 *
 * Edge router: resolves an ATProto blob URL to a durable R2 cache entry,
 * transforming via imgproxy on a cache miss. See README for architecture.
 *
 * This is the bootstrap stub — the routing, R2 cache, and imgproxy pipeline
 * land on the `dev` branch.
 */
import type { Env } from './env';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return new Response('OK');
		}

		return new Response(
			JSON.stringify({ service: 'infra.coop', status: 'bootstrap' }),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	},
} satisfies ExportedHandler<Env>;
