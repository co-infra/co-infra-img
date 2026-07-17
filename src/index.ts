/**
 * img.infra.coop - public, free, at-scale image CDN for the AT Protocol.
 *
 * Edge router. Serves transformed ATProto blobs from a durable R2 cache,
 * transforming via imgproxy on a cache miss. See README for the architecture
 * and why this is a separate service from Refract.
 */
import type { Env } from './env';
import { handleImageRequest } from './handlers/image';
import { handlePurge } from './handlers/admin';
import { json, jsonError } from './utils/response';

export type { Env };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return new Response('OK', { status: 200 });
		}

		if (url.pathname === '/') {
			return json({
				name: 'img.infra.coop',
				description: 'Public image CDN for the AT Protocol',
				usage: '/blob/{did}/{cid}/{params}',
			});
		}

		if (url.pathname.startsWith('/blob/')) {
			return handleImageRequest(request, url, env, ctx);
		}

		if (url.pathname === '/admin/purge') {
			return handlePurge(request, env);
		}

		return jsonError('Not found', 404);
	},
} satisfies ExportedHandler<Env>;
