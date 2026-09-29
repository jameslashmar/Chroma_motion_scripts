/*
	ChromaVRGradient3D_Kernel.h

	The GPU side of VR Color Gradients 3D: one pixel in, one pixel out, the
	same maths as ChromaGradientMath.h in single precision.

	Written once, in the subset of C that CUDA, OpenCL C and the Metal
	Shading Language all accept, and compiled four ways:

	  CUDA     nvcc compiles ChromaVRGradient3D_Kernel.cu, which includes this
	           file, into the plug-in at build time.
	  OpenCL   the build embeds this file as a byte array; at GPU device setup
	           the plug-in prepends the OpenCL prelude and hands the text to
	           the driver to compile.
	  Metal    the same, with the Metal prelude.
	  host     ChromaVRGradient3D_GPU.h includes it as ordinary C++ with a
	           host prelude, so the tests can run the exact kernel code on
	           the CPU and compare it with the double-precision reference.

	The preludes (ChromaVRGradient3D_GPU.h) supply the CH_* macros used
	below, so nothing in this file names a language. Keep it that way:

	  - no C++ features, no references, no default arguments
	  - no float3: it is 12 bytes in CUDA and 16 in OpenCL and Metal, so it
	    can never appear in the shared parameter block; use ch_vec3
	  - no dot(): CUDA has none for its vector types
	  - no vector arithmetic, only .x .y .z .w component access
	  - no `//` comments and no apostrophes in comments - the file is also
	    embedded as text and parsed by four different compilers

	Every function here has a twin in ChromaGradientMath.h. When one
	changes, change the other; the tests exist to catch drift.
*/

#ifndef CHROMA_VR_GRADIENT_3D_KERNEL_H
#define CHROMA_VR_GRADIENT_3D_KERNEL_H

#ifndef CH_INLINE
#error "ChromaVRGradient3D_Kernel.h needs a language prelude before it (see ChromaVRGradient3D_GPU.h)"
#endif

#define CH_MAX_POINTS	8
#define CH_EPS			1e-12f

/* Frame layout; matches chroma::FrameLayout. */
#define CH_LAYOUT_MONOSCOPIC	0
#define CH_LAYOUT_OVER_UNDER	1
#define CH_LAYOUT_SIDE_BY_SIDE	2

/* Blend modes; matches chroma::BlendMode. */
#define CH_BLEND_NONE			0
#define CH_BLEND_NORMAL			1
#define CH_BLEND_ADD			2
#define CH_BLEND_MULTIPLY		3
#define CH_BLEND_SCREEN			4
#define CH_BLEND_OVERLAY		5
#define CH_BLEND_SOFT_LIGHT		6
#define CH_BLEND_HARD_LIGHT		7
#define CH_BLEND_COLOR_DODGE	8
#define CH_BLEND_COLOR_BURN		9
#define CH_BLEND_DARKEN			10
#define CH_BLEND_LIGHTEN		11
#define CH_BLEND_DIFFERENCE		12
#define CH_BLEND_EXCLUSION		13
#define CH_BLEND_HUE			14
#define CH_BLEND_SATURATION		15
#define CH_BLEND_COLOR			16
#define CH_BLEND_LUMINOSITY		17

/* ------------------------------------------------------------------ */
/*  The parameter block                                                */
/* ------------------------------------------------------------------ */

/*	Filled by the host once per frame, read by every pixel. Only float4 and
	int4 appear in it, each 16 bytes and 16-byte aligned in every language
	here, so the host and all four device compilers agree on the layout
	without a single padding byte. 336 bytes; the host static_asserts it.	*/
typedef struct {
	float4	point[CH_MAX_POINTS];	/* xyz unit direction, w radius (sphere 1)	*/
	float4	color[CH_MAX_POINTS];	/* rgb 0..1, a 0..1							*/
	float4	f0;						/* x hfov, y vfov (radians), z power, w blend 0..1	*/
	float4	f1;						/* x opacity 0..1, y sub_w, z sub_h, w unused		*/
	int4	i0;						/* x num_points, y layout, z blend_mode, w alpha_cuts_layer	*/
	int4	i1;						/* x out width, y out height, z src pitch, w dst pitch (float4s)	*/
	int4	i2;						/* x origin_x, y origin_y, z src width, w src height	*/
} ChromaGPUParams;

/* ------------------------------------------------------------------ */
/*  Small types                                                        */
/* ------------------------------------------------------------------ */

typedef struct { float x, y, z; }		ch_vec3;
typedef struct { float r, g, b, a; }	ch_color;

CH_INLINE float ch_clamp01(float v) {
	return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}

CH_INLINE float ch_dot3(ch_vec3 a, ch_vec3 b) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

/* ------------------------------------------------------------------ */
/*  The gradient field  (twin: chroma::evaluate)                       */
/* ------------------------------------------------------------------ */

CH_INLINE ch_color ch_evaluate(CH_PARAMS_PTR P, ch_vec3 d) {
	ch_color out;
	int n = P->i0.x;
	int i;

	if (n > CH_MAX_POINTS) n = CH_MAX_POINTS;
	if (n <= 0) {
		out.r = 0.0f; out.g = 0.0f; out.b = 0.0f; out.a = 0.0f;
		return out;
	}

	float d2[CH_MAX_POINTS];
	float d2_min  = 0.0f;
	int   nearest = 0;

	for (i = 0; i < n; ++i) {
		float4 pt = P->point[i];
		ch_vec3 dir; dir.x = pt.x; dir.y = pt.y; dir.z = pt.z;
		float dd = pt.w * pt.w + 1.0f - 2.0f * pt.w * ch_dot3(dir, d);
		d2[i] = dd > CH_EPS ? dd : CH_EPS;
		if (i == 0 || d2[i] < d2_min) {
			d2_min  = d2[i];
			nearest = i;
		}
	}

	float half_power = 0.5f * P->f0.z;

	float wsum = 0.0f;
	float asum = 0.0f;
	float accr = 0.0f, accg = 0.0f, accb = 0.0f;		/* premultiplied	*/

	for (i = 0; i < n; ++i) {
		float w;
		if (i == nearest) {
			w = 1.0f;
		} else {
			w = CH_POW(d2_min / d2[i], half_power);
			if (!(w > 0.0f) || !CH_ISFINITE(w)) w = 0.0f;
		}
		float4 c  = P->color[i];
		float  a  = ch_clamp01(c.w);
		float  wa = w * a;
		wsum += w;
		asum += wa;
		accr += wa * c.x;
		accg += wa * c.y;
		accb += wa * c.z;
	}

	float4 nc     = P->color[nearest];
	float  near_a = ch_clamp01(nc.w);

	if (!(wsum > 0.0f) || !CH_ISFINITE(wsum)) {
		out.r = nc.x; out.g = nc.y; out.b = nc.z; out.a = near_a;
		return out;
	}

	float t     = ch_clamp01(P->f0.w);
	float alpha = near_a + t * (asum / wsum - near_a);

	float pr = near_a * nc.x + t * (accr / wsum - near_a * nc.x);
	float pg = near_a * nc.y + t * (accg / wsum - near_a * nc.y);
	float pb = near_a * nc.z + t * (accb / wsum - near_a * nc.z);

	if (alpha > CH_EPS) {
		out.r = pr / alpha; out.g = pg / alpha; out.b = pb / alpha;
	} else {
		out.r = nc.x; out.g = nc.y; out.b = nc.z;
	}
	out.a = alpha;
	return out;
}

/* ------------------------------------------------------------------ */
/*  Blend modes  (twin: chroma::blendChannel / blendRGB)               */
/* ------------------------------------------------------------------ */

CH_INLINE float ch_soft_light(float b, float s) {
	if (s <= 0.5f) {
		return b - (1.0f - 2.0f * s) * b * (1.0f - b);
	}
	float d = (b <= 0.25f) ? ((16.0f * b - 12.0f) * b + 4.0f) * b : CH_SQRT(b);
	return b + (2.0f * s - 1.0f) * (d - b);
}

CH_INLINE float ch_blend_channel(int mode, float b, float s) {
	if (mode == CH_BLEND_NORMAL)		return s;
	if (mode == CH_BLEND_ADD)			return b + s;
	if (mode == CH_BLEND_MULTIPLY)		return b * s;
	if (mode == CH_BLEND_SCREEN)		return b + s - b * s;
	if (mode == CH_BLEND_OVERLAY)		return (b <= 0.5f) ? 2.0f * b * s
														   : 1.0f - 2.0f * (1.0f - b) * (1.0f - s);
	if (mode == CH_BLEND_SOFT_LIGHT)	return ch_soft_light(b, s);
	if (mode == CH_BLEND_HARD_LIGHT)	return (s <= 0.5f) ? 2.0f * s * b
														   : 1.0f - 2.0f * (1.0f - s) * (1.0f - b);
	if (mode == CH_BLEND_COLOR_DODGE)	return (s >= 1.0f) ? 1.0f : CH_FMIN(1.0f, b / (1.0f - s));
	if (mode == CH_BLEND_COLOR_BURN)	return (s <= 0.0f) ? 0.0f : 1.0f - CH_FMIN(1.0f, (1.0f - b) / s);
	if (mode == CH_BLEND_DARKEN)		return CH_FMIN(b, s);
	if (mode == CH_BLEND_LIGHTEN)		return CH_FMAX(b, s);
	if (mode == CH_BLEND_DIFFERENCE)	return CH_FABS(b - s);
	if (mode == CH_BLEND_EXCLUSION)		return b + s - 2.0f * b * s;
	return s;
}

CH_INLINE float ch_lum(ch_vec3 c) {
	return 0.3f * c.x + 0.59f * c.y + 0.11f * c.z;
}

CH_INLINE ch_vec3 ch_clip_color(ch_vec3 c) {
	float l = ch_lum(c);
	float n = CH_FMIN(c.x, CH_FMIN(c.y, c.z));
	float x = CH_FMAX(c.x, CH_FMAX(c.y, c.z));

	if (n < 0.0f) {
		float d = l - n;
		if (d > CH_EPS) {
			c.x = l + (c.x - l) * l / d;
			c.y = l + (c.y - l) * l / d;
			c.z = l + (c.z - l) * l / d;
		} else {
			c.x = l; c.y = l; c.z = l;
		}
	}
	if (x > 1.0f) {
		float d = x - l;
		if (d > CH_EPS) {
			c.x = l + (c.x - l) * (1.0f - l) / d;
			c.y = l + (c.y - l) * (1.0f - l) / d;
			c.z = l + (c.z - l) * (1.0f - l) / d;
		} else {
			c.x = l; c.y = l; c.z = l;
		}
	}
	return c;
}

CH_INLINE ch_vec3 ch_set_lum(ch_vec3 c, float l) {
	float d = l - ch_lum(c);
	c.x += d; c.y += d; c.z += d;
	return ch_clip_color(c);
}

CH_INLINE float ch_sat(ch_vec3 c) {
	return CH_FMAX(c.x, CH_FMAX(c.y, c.z)) - CH_FMIN(c.x, CH_FMIN(c.y, c.z));
}

/*	Rank the channels so the middle one is rescaled between the other two,
	per the W3C SetSat pseudocode. Done on a small array because the ranks
	are indices.														*/
CH_INLINE ch_vec3 ch_set_sat(ch_vec3 c, float s) {
	float v[3];
	int imin = 0, imid = 1, imax = 2, tmp;
	v[0] = c.x; v[1] = c.y; v[2] = c.z;

	if (v[imin] > v[imid]) { tmp = imin; imin = imid; imid = tmp; }
	if (v[imid] > v[imax]) { tmp = imid; imid = imax; imax = tmp; }
	if (v[imin] > v[imid]) { tmp = imin; imin = imid; imid = tmp; }

	if (v[imax] > v[imin]) {
		v[imid] = (v[imid] - v[imin]) * s / (v[imax] - v[imin]);
		v[imax] = s;
	} else {
		v[imid] = 0.0f; v[imax] = 0.0f;
	}
	v[imin] = 0.0f;

	c.x = v[0]; c.y = v[1]; c.z = v[2];
	return c;
}

/*	Blend gradient colour s over backdrop b. Left unclamped, as on the CPU. */
CH_INLINE ch_vec3 ch_blend_rgb(int mode, ch_vec3 b, ch_vec3 s) {
	ch_vec3 t;
	if (mode == CH_BLEND_HUE) {
		t = ch_set_sat(s, ch_sat(b));
		return ch_set_lum(t, ch_lum(b));
	}
	if (mode == CH_BLEND_SATURATION) {
		t = ch_set_sat(b, ch_sat(s));
		return ch_set_lum(t, ch_lum(b));
	}
	if (mode == CH_BLEND_COLOR) {
		return ch_set_lum(s, ch_lum(b));
	}
	if (mode == CH_BLEND_LUMINOSITY) {
		return ch_set_lum(b, ch_lum(s));
	}
	t.x = ch_blend_channel(mode, b.x, s.x);
	t.y = ch_blend_channel(mode, b.y, s.y);
	t.z = ch_blend_channel(mode, b.z, s.z);
	return t;
}

/* ------------------------------------------------------------------ */
/*  One pixel  (twin: chroma::shadePixel + the float output rounding)  */
/* ------------------------------------------------------------------ */

/*	x, y are positions in the output buffer; src is that pixel of the input
	layer. Buffers are BGRA float (AE_PixelFormat GPU_BGRA128): .x blue,
	.y green, .z red, .w alpha. Output is alpha clamped to 0..1 and colour
	floored at 0 but not capped, exactly as the 32-bit CPU path does.	*/
CH_INLINE float4 ch_shade(CH_PARAMS_PTR P, int x, int y, float4 src) {
	/* --- view direction (twin: directionForPixel) --- */
	float fx    = (float)(x + P->i2.x);
	float fy    = (float)(y + P->i2.y);
	float sub_w = P->f1.y;
	float sub_h = P->f1.z;

	if (P->i0.y == CH_LAYOUT_OVER_UNDER) {
		if (fy >= sub_h) fy -= sub_h;
	} else if (P->i0.y == CH_LAYOUT_SIDE_BY_SIDE) {
		if (fx >= sub_w) fx -= sub_w;
	}

	float u   = (fx + 0.5f) / sub_w;
	float v   = (fy + 0.5f) / sub_h;
	float lon = (u - 0.5f) * P->f0.x;
	float lat = (0.5f - v) * P->f0.y;
	float cl  = CH_COS(lat);

	ch_vec3 d;
	d.x = cl * CH_SIN(lon);
	d.y = CH_SIN(lat);
	d.z = cl * CH_COS(lon);

	ch_color g = ch_evaluate(P, d);

	float sr = src.z, sg = src.y, sb = src.x, sa = src.w;
	float orr, og, ob, oa;
	int   mode = P->i0.z;
	float k    = P->f1.x;

	if (mode == CH_BLEND_NONE) {
		oa = sa + k * (g.a - sa);
		float pr = sr * sa + k * (g.r * g.a - sr * sa);
		float pg = sg * sa + k * (g.g * g.a - sg * sa);
		float pb = sb * sa + k * (g.b * g.a - sb * sa);
		if (oa > 1e-9f) {
			orr = pr / oa; og = pg / oa; ob = pb / oa;
		} else {
			orr = g.r; og = g.g; ob = g.b;
		}
	} else {
		ch_vec3 back; back.x = sr; back.y = sg; back.z = sb;
		ch_vec3 grad; grad.x = g.r; grad.y = g.g; grad.z = g.b;
		ch_vec3 bl = ch_blend_rgb(mode, back, grad);

		if (P->i0.w) {
			orr = sr + k * (bl.x - sr);
			og  = sg + k * (bl.y - sg);
			ob  = sb + k * (bl.z - sb);
			oa  = sa * (1.0f - k * (1.0f - g.a));
		} else {
			float kk = k * g.a;
			orr = sr + kk * (bl.x - sr);
			og  = sg + kk * (bl.y - sg);
			ob  = sb + kk * (bl.z - sb);
			oa  = sa;
		}
	}

	return CH_F4(
		ob  < 0.0f ? 0.0f : ob,
		og  < 0.0f ? 0.0f : og,
		orr < 0.0f ? 0.0f : orr,
		ch_clamp01(oa));
}

#endif	/* CHROMA_VR_GRADIENT_3D_KERNEL_H */
