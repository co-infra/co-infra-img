/**
 * JSON response helpers shared across handlers.
 */

/**
 * CORS headers applied to every public response. The CDN serves public blobs
 * with no credentials, so `*` is safe, and it lets browsers use the images in
 * canvas, WebGL, and fetch-based loaders. `Timing-Allow-Origin` exposes real
 * transfer sizes to the Resource Timing API cross-origin.
 */
export const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Timing-Allow-Origin': '*',
	'Access-Control-Expose-Headers': 'Content-Length, Content-Type, X-Cache',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers },
	});
}

export function jsonError(message: string, status: number): Response {
	return json({ error: message }, status);
}
