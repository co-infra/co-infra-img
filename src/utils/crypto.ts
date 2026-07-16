/**
 * Crypto helpers built on Web Crypto (available in Workers).
 *
 * Used for imgproxy signed-URL HMACs and deterministic R2 cache keys.
 */

const encoder = new TextEncoder();

/** Decodes a hex string (imgproxy key/salt are hex-encoded) to raw bytes. */
export function hexToBytes(hex: string): Uint8Array {
	const clean = hex.trim();
	if (clean.length % 2 !== 0) {
		throw new Error('Invalid hex string: odd length');
	}

	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}

	return bytes;
}

/** URL-safe Base64 (no padding) of raw bytes - the form imgproxy expects. */
export function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe Base64 (no padding) of a UTF-8 string. */
export function base64urlString(value: string): string {
	return base64url(encoder.encode(value));
}

/**
 * imgproxy signature: url-safe Base64 of HMAC-SHA256(key, salt || path),
 * where `path` is the URL portion after the signature, starting with `/`.
 */
export async function imgproxySignature(
	keyBytes: Uint8Array,
	saltBytes: Uint8Array,
	path: string
): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		keyBytes,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);

	const message = new Uint8Array([...saltBytes, ...encoder.encode(path)]);
	const signature = await crypto.subtle.sign('HMAC', key, message);

	return base64url(new Uint8Array(signature));
}

/** Hex SHA-256 of a string - used to derive stable cache-key tokens. */
export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
