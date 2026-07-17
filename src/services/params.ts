/**
 * Parses the comma-separated transform params from the image URL into a
 * normalized, imgproxy-oriented options object.
 *
 * Keeps Refract's URL vocabulary (`w`, `h`, `q`, `f`, `fit`, `g`, `blur`,
 * `rotate`) so the public URL contract is familiar, but resolves to imgproxy
 * processing options rather than Cloudflare `cf.image` options. `f=auto` is
 * negotiated from the request `Accept` header into a concrete output format so
 * the cache key stays deterministic (one stored variant per real format).
 */

export type OutputFormat = 'webp' | 'avif' | 'jpeg' | 'png' | 'gif';

/** File extension imgproxy appends and the R2 key uses, per output format. */
export const FORMAT_EXTENSION: Record<OutputFormat, string> = {
	webp: 'webp',
	avif: 'avif',
	jpeg: 'jpg',
	png: 'png',
	gif: 'gif',
};

/** MIME type served for each output format. */
export const FORMAT_CONTENT_TYPE: Record<OutputFormat, string> = {
	webp: 'image/webp',
	avif: 'image/avif',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
};

/** imgproxy resize types we use. `fit` preserves aspect; `fill` crops to fill. */
type ResizeType = 'fit' | 'fill';

export interface ImageOps {
	width?: number;
	height?: number;
	quality: number;
	resize: ResizeType;
	enlarge: boolean;
	/** When true, pad the fitted image out to the exact box (imgproxy extend). */
	pad: boolean;
	/** Device pixel ratio, already capped so the effective size stays within 4096. */
	dpr: number;
	/** imgproxy gravity token (e.g. `sm`, `no`, `we`, or `fp:0.5:0.3`). */
	gravity?: string;
	blur?: number;
	/** imgproxy sharpen sigma. */
	sharpen?: number;
	rotate?: 0 | 90 | 180 | 270;
	/** Background hex color without `#`, for pad fill and flattening transparency. */
	background?: string;
	format: OutputFormat;
}

const EXPLICIT_FORMATS: Record<string, OutputFormat> = {
	webp: 'webp',
	avif: 'avif',
	jpeg: 'jpeg',
	jpg: 'jpeg',
	png: 'png',
	gif: 'gif',
};

const DEFAULT_QUALITY = 85;

export function parseImageOps(paramsString: string, acceptHeader: string | null): ImageOps {
	const raw = new Map<string, string>();
	for (const pair of paramsString.split(',')) {
		const [key, value] = pair.split('=');
		if (value !== undefined) {
			raw.set(key, value);
		}
	}

	const { resize, enlarge, pad } = mapFit(raw.get('fit'));
	const width = parseIntInRange(raw.get('w') ?? raw.get('width'), 1, 4096);
	const height = parseIntInRange(raw.get('h') ?? raw.get('height'), 1, 4096);

	return {
		width,
		height,
		quality: parseIntInRange(raw.get('q') ?? raw.get('quality'), 1, 100) ?? DEFAULT_QUALITY,
		resize,
		enlarge,
		pad,
		dpr: resolveDpr(raw.get('dpr'), width, height),
		gravity: mapGravity(raw.get('g') ?? raw.get('gravity')),
		blur: parseIntInRange(raw.get('blur'), 1, 250),
		sharpen: parseFloatInRange(raw.get('sharpen'), 0, 10),
		rotate: mapRotate(raw.get('rotate')),
		background: parseHexColor(raw.get('bg')),
		format: resolveFormat(raw.get('f') ?? raw.get('format'), acceptHeader),
	};
}

/**
 * Device pixel ratio, 1 to 2. Capped so the effective output (largest dimension
 * times dpr) never exceeds 4096, which stops a crafted URL from forcing a huge
 * render. Returns 1 when no size is set, since dpr only scales a resize.
 */
function resolveDpr(value: string | undefined, width?: number, height?: number): number {
	const requested = value === undefined ? 1 : parseFloat(value);
	if (Number.isNaN(requested)) {
		return 1;
	}

	const maxDim = Math.max(width ?? 0, height ?? 0);
	if (maxDim === 0) {
		return 1;
	}

	return clamp(requested, 1, Math.min(2, 4096 / maxDim));
}

/** Parses a 3- or 6-digit hex color (no `#`), lowercased. Ignores anything else. */
function parseHexColor(value: string | undefined): string | undefined {
	if (value === undefined || !/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
		return undefined;
	}

	return value.toLowerCase();
}

/**
 * Resolves output format. An explicit format wins; `auto` (or absent) is
 * negotiated from the Accept header: AVIF > WebP > JPEG.
 */
function resolveFormat(value: string | undefined, acceptHeader: string | null): OutputFormat {
	if (value && value !== 'auto' && EXPLICIT_FORMATS[value]) {
		return EXPLICIT_FORMATS[value];
	}

	const accept = acceptHeader ?? '';
	if (accept.includes('image/avif')) {
		return 'avif';
	}
	if (accept.includes('image/webp')) {
		return 'webp';
	}

	return 'jpeg';
}

function mapFit(value: string | undefined): { resize: ResizeType; enlarge: boolean; pad: boolean } {
	switch (value) {
		case 'cover':
		case 'crop':
			return { resize: 'fill', enlarge: true, pad: false };
		case 'pad':
			// Fit inside the box, then pad out to the exact dimensions.
			return { resize: 'fit', enlarge: true, pad: true };
		case 'contain':
			return { resize: 'fit', enlarge: true, pad: false };
		// `scale-down` and the default never upscale.
		default:
			return { resize: 'fit', enlarge: false, pad: false };
	}
}

function mapGravity(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	switch (value) {
		case 'auto':
		case 'smart':
			// libvips smart crop: attention-based, keeps the salient region in
			// frame. This is content-aware, not face detection.
			return 'sm';
		case 'left':
			return 'we';
		case 'right':
			return 'ea';
		case 'top':
			return 'no';
		case 'bottom':
			return 'so';
	}

	// Coordinate focus point: `g=0.5x0.3` -> imgproxy focus point `fp:0.5:0.3`.
	if (!value.includes('x')) {
		return undefined;
	}

	const [x, y] = value.split('x').map(parseFloat);
	if (Number.isNaN(x) || Number.isNaN(y)) {
		return undefined;
	}

	return `fp:${clamp(x, 0, 1)}:${clamp(y, 0, 1)}`;
}

function mapRotate(value: string | undefined): 0 | 90 | 180 | 270 | undefined {
	const parsed = value === undefined ? NaN : parseInt(value, 10);
	if (parsed === 90 || parsed === 180 || parsed === 270) {
		return parsed;
	}

	return undefined;
}

function parseIntInRange(value: string | undefined, min: number, max: number): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	const parsed = parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		return undefined;
	}

	return clamp(parsed, min, max);
}

function parseFloatInRange(value: string | undefined, min: number, max: number): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	const parsed = parseFloat(value);
	if (Number.isNaN(parsed) || parsed <= min) {
		return undefined;
	}

	return clamp(parsed, min, max);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Canonical, order-stable string describing the transform. Two URLs that mean
 * the same thing (param order, `w`/`width` aliases) collapse to one token, so
 * they hit the same cache entry. Also the basis of the imgproxy processing path.
 */
export function opsToken(ops: ImageOps): string {
	const parts = [
		`f=${ops.format}`,
		`q=${ops.quality}`,
		`rs=${ops.resize}`,
		`en=${ops.enlarge ? 1 : 0}`,
		`pad=${ops.pad ? 1 : 0}`,
		`dpr=${ops.dpr}`,
	];

	if (ops.width !== undefined) {
		parts.push(`w=${ops.width}`);
	}
	if (ops.height !== undefined) {
		parts.push(`h=${ops.height}`);
	}
	if (ops.gravity !== undefined) {
		parts.push(`g=${ops.gravity}`);
	}
	if (ops.blur !== undefined) {
		parts.push(`bl=${ops.blur}`);
	}
	if (ops.sharpen !== undefined) {
		parts.push(`sh=${ops.sharpen}`);
	}
	if (ops.rotate !== undefined) {
		parts.push(`rot=${ops.rotate}`);
	}
	if (ops.background !== undefined) {
		parts.push(`bg=${ops.background}`);
	}

	return parts.join(';');
}
