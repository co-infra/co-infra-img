import { describe, it, expect } from 'vitest';
import { parseImageOps, opsToken } from '../src/services/params';

describe('parseImageOps', () => {
	it('applies defaults when no params are meaningful', () => {
		const ops = parseImageOps('f=auto', null);
		expect(ops.quality).toBe(85);
		expect(ops.format).toBe('jpeg'); // no Accept -> jpeg
		expect(ops.resize).toBe('fit');
		expect(ops.enlarge).toBe(false);
		expect(ops.width).toBeUndefined();
	});

	it('accepts short and long aliases equivalently', () => {
		const short = parseImageOps('w=800,h=600,q=70', null);
		const long = parseImageOps('width=800,height=600,quality=70', null);
		expect(opsToken(short)).toBe(opsToken(long));
		expect(short.width).toBe(800);
		expect(short.height).toBe(600);
		expect(short.quality).toBe(70);
	});

	it('clamps out-of-range values rather than rejecting', () => {
		const ops = parseImageOps('w=99999,q=500', null);
		expect(ops.width).toBe(4096);
		expect(ops.quality).toBe(100);
	});

	it('negotiates f=auto from the Accept header (avif > webp > jpeg)', () => {
		expect(parseImageOps('w=100', 'image/avif,image/webp,*/*').format).toBe('avif');
		expect(parseImageOps('w=100', 'image/webp,*/*').format).toBe('webp');
		expect(parseImageOps('w=100', 'text/html').format).toBe('jpeg');
	});

	it('lets an explicit format override Accept negotiation', () => {
		expect(parseImageOps('w=100,f=png', 'image/avif').format).toBe('png');
		expect(parseImageOps('w=100,f=jpg', 'image/avif').format).toBe('jpeg');
	});

	it('maps fit to resize type, enlarge, and pad flags', () => {
		expect(parseImageOps('w=100,fit=cover', null)).toMatchObject({ resize: 'fill', pad: false });
		expect(parseImageOps('w=100,fit=contain', null)).toMatchObject({ resize: 'fit', pad: false });
		expect(parseImageOps('w=100,h=100,fit=pad', null)).toMatchObject({ resize: 'fit', pad: true });
		expect(parseImageOps('w=100,fit=scale-down', null)).toMatchObject({
			resize: 'fit',
			enlarge: false,
			pad: false,
		});
	});

	it('maps gravity keywords and focus-point coordinates', () => {
		expect(parseImageOps('w=100,g=auto', null).gravity).toBe('sm');
		expect(parseImageOps('w=100,g=smart', null).gravity).toBe('sm');
		expect(parseImageOps('w=100,g=left', null).gravity).toBe('we');
		expect(parseImageOps('w=100,g=0.5x0.3', null).gravity).toBe('fp:0.5:0.3');
	});

	it('does not treat g=face as smart crop, since there is no face detection', () => {
		expect(parseImageOps('w=100,g=face', null).gravity).toBeUndefined();
	});

	it('caps dpr so the effective size stays within 4096', () => {
		expect(parseImageOps('w=200,h=200,dpr=2', null).dpr).toBe(2);
		expect(parseImageOps('w=200,dpr=1.5', null).dpr).toBe(1.5);
		expect(parseImageOps('w=4096,dpr=2', null).dpr).toBe(1);
		expect(parseImageOps('dpr=2', null).dpr).toBe(1);
	});

	it('parses sharpen and ignores non-positive values', () => {
		expect(parseImageOps('w=100,sharpen=1.5', null).sharpen).toBe(1.5);
		expect(parseImageOps('w=100,sharpen=0', null).sharpen).toBeUndefined();
	});

	it('parses a 3- or 6-digit hex background and rejects the rest', () => {
		expect(parseImageOps('w=100,bg=ffffff', null).background).toBe('ffffff');
		expect(parseImageOps('w=100,bg=FFF', null).background).toBe('fff');
		expect(parseImageOps('w=100,bg=zzz', null).background).toBeUndefined();
	});

	it('only accepts 90/180/270 rotations', () => {
		expect(parseImageOps('w=100,rotate=90', null).rotate).toBe(90);
		expect(parseImageOps('w=100,rotate=45', null).rotate).toBeUndefined();
	});
});

describe('opsToken', () => {
	it('is order-independent for equivalent params', () => {
		const a = parseImageOps('w=800,f=webp,q=80', null);
		const b = parseImageOps('q=80,f=webp,w=800', null);
		expect(opsToken(a)).toBe(opsToken(b));
	});

	it('differs when a meaningful param differs', () => {
		const a = parseImageOps('w=800,f=webp', null);
		const b = parseImageOps('w=801,f=webp', null);
		expect(opsToken(a)).not.toBe(opsToken(b));
	});
});
