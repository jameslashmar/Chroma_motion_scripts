/*
	ChromaGradientMath.h

	Pure maths for the VR Color Gradients 3D effect. Deliberately free of any
	After Effects types so it can be compiled and exercised on its own (see
	tests/test_math.cpp).

	The model
	---------
	The viewer sits at the origin looking down +Z, with +X right and +Y up.
	The layer is an equirectangular projection of the sphere around them.

	Every gradient point is a position in that space, not merely a direction:

	    P = radius * dir

	A pixel is a unit direction d. The distance from the gradient point to the
	point on the unit sphere the pixel is looking at is

	    |P - d|^2 = radius^2 + 1 - 2 * radius * (dir . d)

	which for radius == 1 collapses to the chord distance 2*sin(theta/2), i.e.
	a pure angular falloff - exactly how a gradient point confined to the
	sphere behaves. That is what makes radius == 1 the neutral value: the Z
	axis only ever adds to the flat behaviour, never changes it out from
	under an existing look.

	Pulling a point inward (radius < 1) equalises its distance to every
	direction, so its colour blooms across the sphere; pushing it outward
	(radius > 1) concentrates it into a tight hotspot.

	Colours are then mixed by inverse distance weighting (Shepard's method)
	with a user exponent.
*/

#pragma once
#ifndef CHROMA_GRADIENT_MATH_H
#define CHROMA_GRADIENT_MATH_H

#include <cmath>
#include <algorithm>

namespace chroma {

static const int   kMaxPoints = 8;
static const double kPi       = 3.14159265358979323846;
static const double kEpsilon  = 1e-12;

/* ------------------------------------------------------------------ */
/*  Vectors                                                            */
/* ------------------------------------------------------------------ */

struct Vec3 {
	double x, y, z;
};

inline double dot(const Vec3& a, const Vec3& b) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

inline double length(const Vec3& v) {
	return std::sqrt(dot(v, v));
}

/*	Normalise, falling back to "straight ahead" for a degenerate vector so a
	point parked exactly on the viewer still renders something sane.		*/
inline Vec3 normalize(const Vec3& v) {
	const double len = length(v);
	if (len < kEpsilon) {
		Vec3 fwd = { 0.0, 0.0, 1.0 };
		return fwd;
	}
	Vec3 r = { v.x / len, v.y / len, v.z / len };
	return r;
}

/*	Equirectangular longitude/latitude (radians) to a unit direction.
	lon 0, lat 0 is the centre of the frame and looks down +Z.			*/
inline Vec3 dirFromLonLat(double lon, double lat) {
	const double cl = std::cos(lat);
	Vec3 d = { cl * std::sin(lon), std::sin(lat), cl * std::cos(lon) };
	return d;
}

/*	Normalised position in one eye's equirect frame (u, v both 0..1, origin
	top-left as in every image buffer) to a unit direction. v is flipped
	because image rows run downward while latitude runs upward.

	Shared by the render loop and by point placement, so a point dropped on
	a given pixel is guaranteed to colour exactly that pixel.			*/
inline Vec3 dirFromNormalized(double u, double v, double hfov, double vfov) {
	const double lon = (u - 0.5) * hfov;
	const double lat = (0.5 - v) * vfov;
	return dirFromLonLat(lon, lat);
}

/* ------------------------------------------------------------------ */
/*  The gradient field                                                 */
/* ------------------------------------------------------------------ */

struct GradientPoint {
	Vec3   dir;			/* unit direction from the viewer				*/
	double radius;		/* distance from the viewer; sphere == 1.0		*/
	double rgb[3];
};

struct GradientField {
	GradientPoint points[kMaxPoints];
	int    count;
	double power;		/* inverse-distance exponent					*/
	double blend;		/* 0 = hard cells, 1 = smooth inverse-distance	*/
};

/*	Squared distance from a gradient point to the unit-sphere position the
	pixel direction d is looking at.									*/
inline double squaredDistance(const GradientPoint& p, const Vec3& d) {
	const double d2 = p.radius * p.radius + 1.0 - 2.0 * p.radius * dot(p.dir, d);
	return d2 > kEpsilon ? d2 : kEpsilon;
}

/*	Evaluate the field along direction d (must be unit length).

	Weights are computed relative to the *closest* point, i.e.

	    w_i = (d2_min / d2_i) ^ (power / 2)

	rather than d2_i ^ (-power/2) directly. Mathematically identical after
	normalisation, but every weight lands in (0, 1] with the largest exactly
	1, so a high exponent cannot overflow to inf and poison the sum.	*/
inline void evaluate(const GradientField& f, const Vec3& d, double out_rgb[3]) {
	if (f.count <= 0) {
		out_rgb[0] = out_rgb[1] = out_rgb[2] = 0.0;
		return;
	}

	const int n = std::min(f.count, kMaxPoints);

	double d2[kMaxPoints];
	double d2_min   = 0.0;
	int    nearest  = 0;

	for (int i = 0; i < n; ++i) {
		d2[i] = squaredDistance(f.points[i], d);
		if (i == 0 || d2[i] < d2_min) {
			d2_min  = d2[i];
			nearest = i;
		}
	}

	const double half_power = 0.5 * f.power;

	double wsum = 0.0;
	double acc[3] = { 0.0, 0.0, 0.0 };

	for (int i = 0; i < n; ++i) {
		double w;
		if (i == nearest) {
			w = 1.0;
		} else {
			w = std::pow(d2_min / d2[i], half_power);
			if (!(w > 0.0) || !std::isfinite(w)) {
				w = 0.0;
			}
		}
		wsum   += w;
		acc[0] += w * f.points[i].rgb[0];
		acc[1] += w * f.points[i].rgb[1];
		acc[2] += w * f.points[i].rgb[2];
	}

	const GradientPoint& near_pt = f.points[nearest];

	if (!(wsum > 0.0) || !std::isfinite(wsum)) {
		out_rgb[0] = near_pt.rgb[0];
		out_rgb[1] = near_pt.rgb[1];
		out_rgb[2] = near_pt.rgb[2];
		return;
	}

	/*	blend == 1 gives the smooth inverse-distance mix; blend == 0 collapses
		to the nearest point's flat colour, i.e. hard Voronoi cells.		*/
	const double t = std::min(1.0, std::max(0.0, f.blend));
	for (int c = 0; c < 3; ++c) {
		const double idw = acc[c] / wsum;
		out_rgb[c] = near_pt.rgb[c] + t * (idw - near_pt.rgb[c]);
	}
}

/* ------------------------------------------------------------------ */
/*  Blend modes (W3C compositing formulas)                             */
/* ------------------------------------------------------------------ */

enum BlendMode {
	kBlendNone = 0,
	kBlendNormal,
	kBlendAdd,
	kBlendMultiply,
	kBlendScreen,
	kBlendOverlay,
	kBlendSoftLight,
	kBlendHardLight,
	kBlendColorDodge,
	kBlendColorBurn,
	kBlendDarken,
	kBlendLighten,
	kBlendDifference,
	kBlendExclusion,
	kBlendHue,
	kBlendSaturation,
	kBlendColor,
	kBlendLuminosity
};

inline double clamp01(double v) {
	return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
}

inline double softLightChannel(double b, double s) {
	if (s <= 0.5) {
		return b - (1.0 - 2.0 * s) * b * (1.0 - b);
	}
	const double d = (b <= 0.25) ? ((16.0 * b - 12.0) * b + 4.0) * b : std::sqrt(b);
	return b + (2.0 * s - 1.0) * (d - b);
}

inline double blendChannel(int mode, double b, double s) {
	switch (mode) {
		case kBlendNormal:		return s;
		case kBlendAdd:			return b + s;
		case kBlendMultiply:	return b * s;
		case kBlendScreen:		return b + s - b * s;
		case kBlendOverlay:		return (b <= 0.5) ? 2.0 * b * s
													: 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
		case kBlendSoftLight:	return softLightChannel(b, s);
		case kBlendHardLight:	return (s <= 0.5) ? 2.0 * s * b
													: 1.0 - 2.0 * (1.0 - s) * (1.0 - b);
		case kBlendColorDodge:	return (s >= 1.0) ? 1.0 : std::min(1.0, b / (1.0 - s));
		case kBlendColorBurn:	return (s <= 0.0) ? 0.0 : 1.0 - std::min(1.0, (1.0 - b) / s);
		case kBlendDarken:		return std::min(b, s);
		case kBlendLighten:		return std::max(b, s);
		case kBlendDifference:	return std::fabs(b - s);
		case kBlendExclusion:	return b + s - 2.0 * b * s;
		default:				return s;
	}
}

/* --- non-separable helpers --------------------------------------- */

inline double lum(const double c[3]) {
	return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
}

inline void clipColor(double c[3]) {
	const double l = lum(c);
	const double n = std::min(c[0], std::min(c[1], c[2]));
	const double x = std::max(c[0], std::max(c[1], c[2]));

	if (n < 0.0) {
		const double d = l - n;
		if (d > kEpsilon) {
			for (int i = 0; i < 3; ++i) c[i] = l + (c[i] - l) * l / d;
		} else {
			for (int i = 0; i < 3; ++i) c[i] = l;
		}
	}
	if (x > 1.0) {
		const double d = x - l;
		if (d > kEpsilon) {
			for (int i = 0; i < 3; ++i) c[i] = l + (c[i] - l) * (1.0 - l) / d;
		} else {
			for (int i = 0; i < 3; ++i) c[i] = l;
		}
	}
}

inline void setLum(double c[3], double l) {
	const double d = l - lum(c);
	c[0] += d; c[1] += d; c[2] += d;
	clipColor(c);
}

inline double sat(const double c[3]) {
	return std::max(c[0], std::max(c[1], c[2])) - std::min(c[0], std::min(c[1], c[2]));
}

inline void setSat(double c[3], double s) {
	/*	Index the channels by rank so the mid channel is rescaled between the
		min and max, per the W3C SetSat pseudocode.						*/
	int imin = 0, imid = 1, imax = 2;
	if (c[imin] > c[imid]) std::swap(imin, imid);
	if (c[imid] > c[imax]) std::swap(imid, imax);
	if (c[imin] > c[imid]) std::swap(imin, imid);

	if (c[imax] > c[imin]) {
		c[imid] = (c[imid] - c[imin]) * s / (c[imax] - c[imin]);
		c[imax] = s;
	} else {
		c[imid] = c[imax] = 0.0;
	}
	c[imin] = 0.0;
}

/*	Blend gradient colour s over backdrop b. Results are left unclamped for
	the caller to handle (32-bit float output is allowed to exceed 1.0).	*/
inline void blendRGB(int mode, const double b[3], const double s[3], double out[3]) {
	switch (mode) {
		case kBlendHue: {
			double t[3] = { s[0], s[1], s[2] };
			setSat(t, sat(b));
			setLum(t, lum(b));
			out[0] = t[0]; out[1] = t[1]; out[2] = t[2];
			return;
		}
		case kBlendSaturation: {
			double t[3] = { b[0], b[1], b[2] };
			setSat(t, sat(s));
			setLum(t, lum(b));
			out[0] = t[0]; out[1] = t[1]; out[2] = t[2];
			return;
		}
		case kBlendColor: {
			double t[3] = { s[0], s[1], s[2] };
			setLum(t, lum(b));
			out[0] = t[0]; out[1] = t[1]; out[2] = t[2];
			return;
		}
		case kBlendLuminosity: {
			double t[3] = { b[0], b[1], b[2] };
			setLum(t, lum(s));
			out[0] = t[0]; out[1] = t[1]; out[2] = t[2];
			return;
		}
		default:
			for (int c = 0; c < 3; ++c) out[c] = blendChannel(mode, b[c], s[c]);
			return;
	}
}

}	/* namespace chroma */

#endif	/* CHROMA_GRADIENT_MATH_H */
