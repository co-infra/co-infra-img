import { describe, it, expect } from 'vitest';
import { classifyTransformError } from '../src/handlers/image';

describe('classifyTransformError', () => {
	it('treats a missing blob (atproto 400 BlobNotFound) as 404, not a transform failure', () => {
		expect(classifyTransformError(400)).toEqual({ message: 'Blob not found', status: 404 });
	});

	it('treats a source 404 as 404', () => {
		expect(classifyTransformError(404)).toEqual({ message: 'Blob not found', status: 404 });
	});

	it('treats 422 as an unprocessable source, distinct from not-found', () => {
		const result = classifyTransformError(422);
		expect(result.status).toBe(422);
		expect(result.message).not.toBe('Blob not found');
	});

	it('maps genuine upstream failures to 502 and surfaces the imgproxy status', () => {
		const result = classifyTransformError(500);
		expect(result.status).toBe(502);
		expect(result.message).toContain('500');
	});
});
