/**
 * JSON response helpers shared across handlers.
 */

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});
}

export function jsonError(message: string, status: number): Response {
	return json({ error: message }, status);
}
