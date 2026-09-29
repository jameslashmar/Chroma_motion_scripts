/*
	kernel_test_common.h - the scenarios, the reference render and the
	comparison shared by test_kernel.cpp (host + OpenCL) and
	test_kernel_metal.mm (Metal).

	Each scenario is a chroma::ShadeParams (what the CPU path renders with)
	and the chromagpu::ChromaGPUParams built from it exactly as the plug-in's
	FillGPUParams does, plus a synthetic BGRA float source image. The
	reference is chroma::shadePixel in double precision with the 32-bit
	output rounding the plug-in applies; every GPU (or host-compiled kernel)
	result is measured against it.
*/

#pragma once

#include "../ChromaGradientMath.h"
#include "../ChromaVRGradient3D_GPU.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace ktest {

struct Scenario {
	std::string						name;
	chroma::ShadeParams				sp;
	chromagpu::ChromaGPUParams		gp;
	int								w, h;			/* output size						*/
	int								src_w, src_h;	/* input size (may be smaller)		*/
	std::vector<float>				src;			/* BGRA, src_w * src_h * 4			*/
	bool							boundary_sensitive;	/* blend < 1: nearest-point flips allowed on a few pixels */
};

static const double kPi = chroma::kPi;

/* The plug-in's default point placement, as percentages of the frame. */
struct PointDefault { double x_pct, y_pct; int r, g, b; };
static const PointDefault kDefaults[8] = {
	{ 25.0, 30.0, 255, 120,  40 },
	{ 75.0, 30.0, 200,  40, 160 },
	{ 25.0, 70.0,  30,  60, 200 },
	{ 75.0, 70.0,   0, 180, 180 },
	{ 50.0, 15.0, 255, 220,  60 },
	{ 50.0, 85.0, 110,  40, 200 },
	{ 10.0, 50.0,  60, 200,  90 },
	{ 90.0, 50.0, 220,  40,  60 }
};

/*	A source image with something in every channel: a colour sweep, alpha
	rising left to right with a fully transparent band and an overbright
	patch, so premultiplied maths, alpha handling and the unclamped float
	path all get exercised.											*/
inline std::vector<float> makeSource(int w, int h) {
	std::vector<float> img(static_cast<size_t>(w) * h * 4);
	for (int y = 0; y < h; ++y) {
		for (int x = 0; x < w; ++x) {
			const double u = (x + 0.5) / w;
			const double v = (y + 0.5) / h;
			double r = 0.5 + 0.5 * std::sin(u * 6.0);
			double g = v;
			double b = 0.5 + 0.5 * std::cos(v * 4.0 + u);
			double a = u;
			if (x >= w / 3 && x < w / 3 + 5)  a = 0.0;			/* transparent band			*/
			if (y >= h / 2 && x >= w - 12)    { r = 1.6; g = 1.2; }	/* overbright patch			*/
			if (y == h - 1 && x < 8)          { r = -0.2; }			/* below zero, as float can be	*/
			float* p = &img[(static_cast<size_t>(y) * w + x) * 4];
			p[0] = static_cast<float>(b);
			p[1] = static_cast<float>(g);
			p[2] = static_cast<float>(r);
			p[3] = static_cast<float>(a);
		}
	}
	return img;
}

/*	Build the field the way GatherRenderInfo does for Equirect + Distance:
	equirect percentage -> pixel -> normalised -> direction; Z -> radius.	*/
inline void placePoints(chroma::ShadeParams& sp, int count, const double* z_px, const double* alphas,
						double depth_scale)
{
	sp.field.count = count;
	for (int i = 0; i < count; ++i) {
		const double px = kDefaults[i].x_pct / 100.0 * sp.sub_w;
		const double py = kDefaults[i].y_pct / 100.0 * sp.sub_h;
		sp.field.points[i].dir    = chroma::dirFromNormalized(px / sp.sub_w, py / sp.sub_h, sp.hfov, sp.vfov);
		double radius = 1.0 + (z_px ? z_px[i] : 0.0) / depth_scale;
		if (radius < 0.0) radius = 0.0;
		sp.field.points[i].radius = radius;
		sp.field.points[i].rgb[0] = kDefaults[i].r / 255.0;
		sp.field.points[i].rgb[1] = kDefaults[i].g / 255.0;
		sp.field.points[i].rgb[2] = kDefaults[i].b / 255.0;
		sp.field.points[i].alpha  = alphas ? alphas[i] : 1.0;
	}
}

inline chroma::ShadeParams baseParams(int w, int h) {
	chroma::ShadeParams sp{};
	sp.layout           = chroma::kLayoutMonoscopic;
	sp.blend_mode       = chroma::kBlendNormal;
	sp.alpha_cuts_layer = true;
	sp.hfov             = 360.0 * kPi / 180.0;
	sp.vfov             = 180.0 * kPi / 180.0;
	sp.opacity          = 1.0;
	sp.sub_w            = w;
	sp.sub_h            = h;
	sp.origin_x         = 0;
	sp.origin_y         = 0;
	sp.field.power      = 2.0;
	sp.field.blend      = 1.0;
	return sp;
}

/*	Mirror of the plug-in's FillGPUParams, from a ShadeParams instead of a
	ChromaRenderInfo.													*/
inline chromagpu::ChromaGPUParams toGPU(const chroma::ShadeParams& sp, int w, int h, int src_w, int src_h) {
	chromagpu::ChromaGPUParams P;
	std::memset(&P, 0, sizeof P);
	for (int i = 0; i < sp.field.count && i < CH_MAX_POINTS; ++i) {
		P.point[i].x = static_cast<float>(sp.field.points[i].dir.x);
		P.point[i].y = static_cast<float>(sp.field.points[i].dir.y);
		P.point[i].z = static_cast<float>(sp.field.points[i].dir.z);
		P.point[i].w = static_cast<float>(sp.field.points[i].radius);
		P.color[i].x = static_cast<float>(sp.field.points[i].rgb[0]);
		P.color[i].y = static_cast<float>(sp.field.points[i].rgb[1]);
		P.color[i].z = static_cast<float>(sp.field.points[i].rgb[2]);
		P.color[i].w = static_cast<float>(sp.field.points[i].alpha);
	}
	P.f0.x = static_cast<float>(sp.hfov);
	P.f0.y = static_cast<float>(sp.vfov);
	P.f0.z = static_cast<float>(sp.field.power);
	P.f0.w = static_cast<float>(sp.field.blend);
	P.f1.x = static_cast<float>(sp.opacity);
	P.f1.y = static_cast<float>(sp.sub_w);
	P.f1.z = static_cast<float>(sp.sub_h);
	P.i0.x = sp.field.count;
	P.i0.y = sp.layout;
	P.i0.z = sp.blend_mode;
	P.i0.w = sp.alpha_cuts_layer ? 1 : 0;
	P.i1.x = w;
	P.i1.y = h;
	P.i1.z = src_w;			/* pitch == width: the test buffers are packed	*/
	P.i1.w = w;
	P.i2.x = sp.origin_x;
	P.i2.y = sp.origin_y;
	P.i2.z = src_w;
	P.i2.w = src_h;
	return P;
}

inline Scenario make(const std::string& name, const chroma::ShadeParams& sp, int w, int h,
					 int src_w = -1, int src_h = -1)
{
	Scenario s;
	s.name  = name;
	s.sp    = sp;
	s.w     = w;
	s.h     = h;
	s.src_w = src_w < 0 ? w : src_w;
	s.src_h = src_h < 0 ? h : src_h;
	s.src   = makeSource(s.src_w, s.src_h);
	s.gp    = toGPU(sp, w, h, s.src_w, s.src_h);
	s.boundary_sensitive = sp.field.blend < 1.0;
	return s;
}

inline std::vector<Scenario> scenarios() {
	std::vector<Scenario> out;
	const int W = 128, H = 64;
	const double depth = 500.0;

	{	/* the defaults: four points, normal, alpha cuts layer */
		chroma::ShadeParams sp = baseParams(W, H);
		placePoints(sp, 4, nullptr, nullptr, depth);
		out.push_back(make("defaults", sp, W, H));
	}
	{	/* eight points, Z in and out, per-point alpha, tighter power */
		chroma::ShadeParams sp = baseParams(W, H);
		const double z[8] = { -400, 0, 1500, 0, 250, -100, 0, 60 };
		const double a[8] = { 1.0, 0.5, 1.0, 0.0, 0.8, 1.0, 0.25, 1.0 };
		placePoints(sp, 8, z, a, depth);
		sp.field.power = 5.0;
		out.push_back(make("8pt z alpha power5", sp, W, H));
	}
	{	/* hard cells */
		chroma::ShadeParams sp = baseParams(W, H);
		placePoints(sp, 6, nullptr, nullptr, depth);
		sp.field.blend = 0.0;
		out.push_back(make("blend 0 cells", sp, W, H));
	}
	{	/* part-way blend, high power (stress for pow) */
		chroma::ShadeParams sp = baseParams(W, H);
		const double a[8] = { 1.0, 1.0, 0.3, 1.0, 1.0, 1.0, 1.0, 1.0 };
		placePoints(sp, 4, nullptr, a, depth);
		sp.field.blend = 0.35;
		sp.field.power = 14.0;
		out.push_back(make("blend 0.35 power 14", sp, W, H));
	}
	{	/* None: replace, at partial opacity over a part-transparent source */
		chroma::ShadeParams sp = baseParams(W, H);
		const double a[8] = { 1.0, 0.6, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0 };
		placePoints(sp, 4, nullptr, a, depth);
		sp.blend_mode = chroma::kBlendNone;
		sp.opacity    = 0.6;
		out.push_back(make("none opacity 0.6", sp, W, H));
	}
	{	/* alpha does not cut the layer */
		chroma::ShadeParams sp = baseParams(W, H);
		const double a[8] = { 1.0, 0.4, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0 };
		placePoints(sp, 4, nullptr, a, depth);
		sp.alpha_cuts_layer = false;
		sp.opacity = 0.8;
		out.push_back(make("alpha fades effect only", sp, W, H));
	}
	/* every blend mode, separable and not */
	static const struct { chroma::BlendMode mode; const char* name; } kModes[] = {
		{ chroma::kBlendAdd,        "add" },        { chroma::kBlendMultiply,   "multiply" },
		{ chroma::kBlendScreen,     "screen" },     { chroma::kBlendOverlay,    "overlay" },
		{ chroma::kBlendSoftLight,  "soft light" }, { chroma::kBlendHardLight,  "hard light" },
		{ chroma::kBlendColorDodge, "color dodge" },{ chroma::kBlendColorBurn,  "color burn" },
		{ chroma::kBlendDarken,     "darken" },     { chroma::kBlendLighten,    "lighten" },
		{ chroma::kBlendDifference, "difference" }, { chroma::kBlendExclusion,  "exclusion" },
		{ chroma::kBlendHue,        "hue" },        { chroma::kBlendSaturation, "saturation" },
		{ chroma::kBlendColor,      "color" },      { chroma::kBlendLuminosity, "luminosity" },
	};
	for (const auto& m : kModes) {
		chroma::ShadeParams sp = baseParams(W, H);
		const double a[8] = { 1.0, 0.7, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0 };
		placePoints(sp, 5, nullptr, a, depth);
		sp.blend_mode = m.mode;
		sp.opacity    = 0.9;
		out.push_back(make(std::string("blend ") + m.name, sp, W, H));
	}
	{	/* stereo over/under: sub frame is half height */
		chroma::ShadeParams sp = baseParams(W, H);
		sp.layout = chroma::kLayoutOverUnder;
		sp.sub_h  = H * 0.5;
		placePoints(sp, 4, nullptr, nullptr, depth);
		out.push_back(make("stereo over-under", sp, W, H));
	}
	{	/* stereo side by side: sub frame is half width */
		chroma::ShadeParams sp = baseParams(W, H);
		sp.layout = chroma::kLayoutSideBySide;
		sp.sub_w  = W * 0.5;
		placePoints(sp, 4, nullptr, nullptr, depth);
		out.push_back(make("stereo side-by-side", sp, W, H));
	}
	{	/* a sub-region render: buffer smaller than the layer, offset origin,
		   and an input buffer smaller than the output */
		chroma::ShadeParams sp = baseParams(W, H);
		placePoints(sp, 4, nullptr, nullptr, depth);
		sp.origin_x = 37;
		sp.origin_y = 11;
		out.push_back(make("sub-region origin (37,11)", sp, 60, 40, 50, 33));
	}
	{	/* field of view narrower than the full sphere */
		chroma::ShadeParams sp = baseParams(W, H);
		sp.hfov = 180.0 * kPi / 180.0;
		sp.vfov =  90.0 * kPi / 180.0;
		placePoints(sp, 4, nullptr, nullptr, depth);
		out.push_back(make("fov 180x90", sp, W, H));
	}
	{	/* degenerate: a point sitting on the viewer (radius 0) and one far out */
		chroma::ShadeParams sp = baseParams(W, H);
		const double z[8] = { -500, 0, 0, 100000, 0, 0, 0, 0 };
		placePoints(sp, 4, z, nullptr, depth);
		out.push_back(make("radius 0 and radius 201", sp, W, H));
	}
	{	/* a single point */
		chroma::ShadeParams sp = baseParams(W, H);
		placePoints(sp, 1, nullptr, nullptr, depth);
		out.push_back(make("single point", sp, W, H));
	}
	return out;
}

/*	The plug-in's 32-bit CPU output for a scenario: chroma::shadePixel per
	pixel, alpha clamped to 0..1, colour floored at 0, BGRA order.
	Pixels outside the input buffer read as transparent black, as the
	kernel does.														*/
inline std::vector<float> reference(const Scenario& s) {
	std::vector<float> out(static_cast<size_t>(s.w) * s.h * 4);
	for (int y = 0; y < s.h; ++y) {
		for (int x = 0; x < s.w; ++x) {
			double src[3] = { 0.0, 0.0, 0.0 };
			double sa = 0.0;
			if (x < s.src_w && y < s.src_h) {
				const float* p = &s.src[(static_cast<size_t>(y) * s.src_w + x) * 4];
				src[0] = p[2]; src[1] = p[1]; src[2] = p[0]; sa = p[3];
			}
			double rgb[3];
			double a;
			chroma::shadePixel(s.sp, x, y, src, sa, rgb, &a);
			float* o = &out[(static_cast<size_t>(y) * s.w + x) * 4];
			o[0] = static_cast<float>(rgb[2] < 0.0 ? 0.0 : rgb[2]);
			o[1] = static_cast<float>(rgb[1] < 0.0 ? 0.0 : rgb[1]);
			o[2] = static_cast<float>(rgb[0] < 0.0 ? 0.0 : rgb[0]);
			o[3] = static_cast<float>(chroma::clamp01(a));
		}
	}
	return out;
}

/*	The kernel compiled as C++ (chromagpu::ch_shade), for the same scenario. */
inline std::vector<float> hostKernel(const Scenario& s) {
	std::vector<float> out(static_cast<size_t>(s.w) * s.h * 4);
	for (int y = 0; y < s.h; ++y) {
		for (int x = 0; x < s.w; ++x) {
			chromagpu::float4 src = { 0.0f, 0.0f, 0.0f, 0.0f };
			if (x < s.src_w && y < s.src_h) {
				const float* p = &s.src[(static_cast<size_t>(y) * s.src_w + x) * 4];
				src.x = p[0]; src.y = p[1]; src.z = p[2]; src.w = p[3];
			}
			const chromagpu::float4 o = chromagpu::ch_shade(&s.gp, x, y, src);
			float* q = &out[(static_cast<size_t>(y) * s.w + x) * 4];
			q[0] = o.x; q[1] = o.y; q[2] = o.z; q[3] = o.w;
		}
	}
	return out;
}

struct CompareResult {
	double	max_diff;
	size_t	outliers;		/* channels beyond tol					*/
	size_t	nans;
	bool	ok;
};

/*	Single vs double precision lands within ~1e-5 almost everywhere. The
	budget is 1/512 - half an 8-bit step - so a pass means the two paths are
	indistinguishable at 8 and 16 bit and differ in float only far below
	what any later effect could pick up. Where Gradient Blend < 1 the
	nearest point decides the colour, and a pixel whose two nearest points
	tie to within float precision may pick differently; a handful of those
	is allowed, a band of them is not.									*/
inline CompareResult compare(const Scenario& s, const std::vector<float>& got, const std::vector<float>& want,
							 double tol = 1.0 / 512.0)
{
	CompareResult r{ 0.0, 0, 0, true };
	for (size_t i = 0; i < want.size(); ++i) {
		if (!std::isfinite(got[i])) { ++r.nans; continue; }
		const double d = std::fabs(static_cast<double>(got[i]) - static_cast<double>(want[i]));
		if (d > r.max_diff) r.max_diff = d;
		if (d > tol) ++r.outliers;
	}
	const size_t pixels  = static_cast<size_t>(s.w) * s.h;
	const size_t allowed = s.boundary_sensitive ? (pixels * 4) / 500 : 0;	/* 0.2 % of channels */
	r.ok = (r.nans == 0) && (r.outliers <= allowed);
	return r;
}

inline bool report(const char* label, const Scenario& s, const CompareResult& r) {
	std::printf("  %-4s %-28s max diff %.3g  outliers %zu%s%s\n",
		r.ok ? "ok" : "FAIL", s.name.c_str(), r.max_diff, r.outliers,
		r.nans ? "  NaN/inf!" : "", label);
	return r.ok;
}

}	/* namespace ktest */
