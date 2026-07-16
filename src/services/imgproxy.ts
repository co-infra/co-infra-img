/**
 * Builds signed imgproxy URLs for a given source blob + transform.
 *
 * imgproxy signed-URL format (base64 source form):
 *
 *   /{signature}/{processing_options}/{base64url(source_url)}.{ext}
 *
 * where signature = url-safe Base64 of HMAC-SHA256(key, salt || path), and
 * `path` is everything after the signature (starting with `/`). Only reached on
 * a cache miss - hot content is served straight from R2 and never touches this.
 */
import type { Env } from '../env';
import type { ImageOps } from './params';
import { FORMAT_EXTENSION } from './params';
import { base64urlString, hexToBytes, imgproxySignature } from '../utils/crypto';

/**
 * Translates our normalized ops into an imgproxy processing-options segment,
 * e.g. `rs:fill:800:600:1/g:sm/q:85/bl:5/rot:90`.
 */
export function buildProcessingOptions(ops: ImageOps): string {
	const opts: string[] = [];

	if (ops.width !== undefined || ops.height !== undefined) {
		const w = ops.width ?? 0; // imgproxy treats 0 as unbounded
		const h = ops.height ?? 0;
		opts.push(`rs:${ops.resize}:${w}:${h}:${ops.enlarge ? 1 : 0}`);
		if (ops.pad) {
			// Extend the fitted image out to the requested box, padding the
			// remaining space (transparent where the output format allows).
			opts.push('ex:1');
		}
	}

	if (ops.gravity !== undefined) {
		opts.push(`g:${ops.gravity}`);
	}

	opts.push(`q:${ops.quality}`);

	if (ops.blur !== undefined) {
		opts.push(`bl:${ops.blur}`);
	}

	if (ops.rotate !== undefined) {
		opts.push(`rot:${ops.rotate}`);
	}

	return opts.join('/');
}

/**
 * Produces the fully-qualified, signed imgproxy URL for a source blob URL.
 */
export async function buildSignedImgproxyUrl(
	sourceUrl: string,
	ops: ImageOps,
	env: Env
): Promise<string> {
	const processing = buildProcessingOptions(ops);
	const encodedSource = base64urlString(sourceUrl);
	const ext = FORMAT_EXTENSION[ops.format];

	// Path the signature is computed over - must start with `/` and exclude host.
	const path = `/${processing}/${encodedSource}.${ext}`;

	const signature = await imgproxySignature(
		hexToBytes(env.IMGPROXY_KEY),
		hexToBytes(env.IMGPROXY_SALT),
		path
	);

	const base = env.IMGPROXY_URL.replace(/\/+$/, '');
	return `${base}/${signature}${path}`;
}
