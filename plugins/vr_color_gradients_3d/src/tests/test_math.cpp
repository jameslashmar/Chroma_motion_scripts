/*
	test_math.cpp - exercises ChromaGradientMath.h with no After Effects in
	the loop. Build and run:

		g++ -std=c++17 -O2 -I.. test_math.cpp -o test_math && ./test_math
*/

#include "../ChromaGradientMath.h"

#include <cstdio>
#include <cmath>

using namespace chroma;

static int g_fail = 0;
static int g_run  = 0;

static void check(bool ok, const char* what) {
	++g_run;
	if (!ok) { ++g_fail; std::printf("  FAIL  %s\n", what); }
	else     { std::printf("  ok    %s\n", what); }
}

static void checkNear(double a, double b, double tol, const char* what) {
	++g_run;
	if (std::fabs(a - b) > tol) {
		++g_fail;
		std::printf("  FAIL  %s  (%.9g vs %.9g, tol %g)\n", what, a, b, tol);
	} else {
		std::printf("  ok    %s\n", what);
	}
}

static GradientField makeField(int count, double power, double blend) {
	GradientField f{};
	f.count = count;
	f.power = power;
	f.blend = blend;
	for (int i = 0; i < count; ++i) {
		f.points[i].radius = 1.0;
		f.points[i].dir    = Vec3{ 0.0, 0.0, 1.0 };
		f.points[i].rgb[0] = f.points[i].rgb[1] = f.points[i].rgb[2] = 0.0;
	}
	return f;
}

int main() {
	std::printf("\n-- geometry --\n");
	{
		Vec3 c = dirFromLonLat(0.0, 0.0);
		checkNear(c.x, 0.0, 1e-12, "frame centre looks down +Z (x)");
		checkNear(c.y, 0.0, 1e-12, "frame centre looks down +Z (y)");
		checkNear(c.z, 1.0, 1e-12, "frame centre looks down +Z (z)");

		Vec3 r = dirFromLonLat(kPi / 2.0, 0.0);
		checkNear(r.x, 1.0, 1e-12, "lon +90 deg looks down +X");

		Vec3 up = dirFromLonLat(0.0, kPi / 2.0);
		checkNear(up.y, 1.0, 1e-12, "lat +90 deg looks up +Y");

		Vec3 d = dirFromLonLat(1.1, -0.4);
		checkNear(length(d), 1.0, 1e-12, "dirFromLonLat returns unit length");

		Vec3 deg = normalize(Vec3{ 0.0, 0.0, 0.0 });
		checkNear(deg.z, 1.0, 1e-12, "degenerate normalize falls back to forward");
	}

	std::printf("\n-- radius 1 reduces to pure angular falloff --\n");
	{
		GradientPoint p{};
		p.dir = Vec3{ 0.0, 0.0, 1.0 };
		p.radius = 1.0;

		for (double theta = 0.0; theta <= kPi; theta += 0.37) {
			Vec3 d = dirFromLonLat(theta, 0.0);
			double got  = squaredDistance(p, d);
			double want = 2.0 - 2.0 * std::cos(theta);
			if (want < kEpsilon) want = kEpsilon;
			char msg[128];
			std::snprintf(msg, sizeof msg, "chord^2 at theta=%.2f", theta);
			checkNear(got, want, 1e-9, msg);
		}
	}

	std::printf("\n-- colour interpolation --\n");
	{
		GradientField f = makeField(2, 2.0, 1.0);
		f.points[0].dir = dirFromLonLat(0.0, 0.0);
		f.points[0].rgb[0] = 1.0;								/* red   */
		f.points[1].dir = dirFromLonLat(kPi, 0.0);
		f.points[1].rgb[2] = 1.0;								/* blue  */

		double c[3];
		evaluate(f, f.points[0].dir, c);
		checkNear(c[0], 1.0, 1e-6, "at point 1 the colour is point 1's red");
		checkNear(c[2], 0.0, 1e-6, "at point 1 there is no blue");

		evaluate(f, f.points[1].dir, c);
		checkNear(c[2], 1.0, 1e-6, "at point 2 the colour is point 2's blue");

		/* equidistant from both -> even mix */
		evaluate(f, dirFromLonLat(kPi / 2.0, 0.0), c);
		checkNear(c[0], 0.5, 1e-9, "midpoint is half red");
		checkNear(c[2], 0.5, 1e-9, "midpoint is half blue");
		checkNear(c[1], 0.0, 1e-12, "midpoint has no green");
	}

	std::printf("\n-- the Z axis --\n");
	{
		/*	Two points, red in front and blue behind. Pulling the red point
			toward the viewer must make the far side redder than it was with
			the point pinned to the sphere; pushing it away must make it
			less red. This is the whole point of the feature.			*/
		GradientField f = makeField(2, 2.0, 1.0);
		f.points[0].dir = dirFromLonLat(0.0, 0.0);
		f.points[0].rgb[0] = 1.0;
		f.points[1].dir = dirFromLonLat(kPi, 0.0);
		f.points[1].rgb[2] = 1.0;

		Vec3 probe = dirFromLonLat(kPi * 0.75, 0.0);	/* out toward blue */

		double flat[3], near_[3], far_[3];
		f.points[0].radius = 1.0;  evaluate(f, probe, flat);
		f.points[0].radius = 0.25; evaluate(f, probe, near_);
		f.points[0].radius = 3.0;  evaluate(f, probe, far_);

		check(near_[0] > flat[0], "pulling a point inward spreads its colour wider");
		check(far_[0]  < flat[0], "pushing a point outward tightens its colour");

		/* radius 1 must be bit-for-bit the flat behaviour, not merely close */
		GradientField g = f;
		g.points[0].radius = 1.0;
		double a[3], b[3];
		evaluate(g, probe, a);
		g.points[0].radius = 1.0;
		evaluate(g, probe, b);
		checkNear(a[0], b[0], 0.0, "radius 1.0 is the neutral value");

		/* a point sitting exactly on the viewer must not produce NaN */
		GradientField h = makeField(2, 4.0, 1.0);
		h.points[0].dir = normalize(Vec3{ 0.0, 0.0, 0.0 });
		h.points[0].radius = 0.0;
		h.points[0].rgb[1] = 1.0;
		h.points[1].dir = dirFromLonLat(kPi, 0.0);
		h.points[1].rgb[2] = 1.0;
		double z[3];
		evaluate(h, dirFromLonLat(0.3, 0.2), z);
		check(std::isfinite(z[0]) && std::isfinite(z[1]) && std::isfinite(z[2]),
			  "radius 0 stays finite");
	}

	std::printf("\n-- power and blend --\n");
	{
		GradientField f = makeField(2, 2.0, 1.0);
		f.points[0].dir = dirFromLonLat(0.0, 0.0);
		f.points[0].rgb[0] = 1.0;
		f.points[1].dir = dirFromLonLat(kPi, 0.0);
		f.points[1].rgb[2] = 1.0;

		Vec3 probe = dirFromLonLat(kPi * 0.4, 0.0);		/* nearer the red */

		double soft[3], sharp[3];
		f.power = 1.0;  evaluate(f, probe, soft);
		f.power = 12.0; evaluate(f, probe, sharp);
		check(sharp[0] > soft[0], "a higher power localises colour around its point");

		double hard[3];
		f.power = 2.0;
		f.blend = 0.0;
		evaluate(f, probe, hard);
		checkNear(hard[0], 1.0, 1e-12, "blend 0 gives the nearest point's flat colour");
		checkNear(hard[2], 0.0, 1e-12, "blend 0 admits nothing from the far point");

		/* extreme power must not overflow */
		f.power = 16.0;
		f.blend = 1.0;
		double hot[3];
		evaluate(f, probe, hot);
		check(std::isfinite(hot[0]) && std::isfinite(hot[2]), "power 16 stays finite");
	}

	std::printf("\n-- blend modes --\n");
	{
		double b[3] = { 0.4, 0.5, 0.6 };
		double s[3] = { 0.2, 0.7, 0.9 };
		double o[3];

		blendRGB(kBlendNormal, b, s, o);
		checkNear(o[1], 0.7, 1e-12, "normal returns the gradient");

		blendRGB(kBlendMultiply, b, s, o);
		checkNear(o[0], 0.4 * 0.2, 1e-12, "multiply");

		blendRGB(kBlendScreen, b, s, o);
		checkNear(o[0], 0.4 + 0.2 - 0.08, 1e-12, "screen");

		blendRGB(kBlendDifference, b, s, o);
		checkNear(o[0], 0.2, 1e-12, "difference");

		blendRGB(kBlendDarken, b, s, o);
		checkNear(o[2], 0.6, 1e-12, "darken");

		blendRGB(kBlendLighten, b, s, o);
		checkNear(o[2], 0.9, 1e-12, "lighten");

		/* white through soft light must stay in gamut */
		double w[3] = { 1.0, 1.0, 1.0 };
		blendRGB(kBlendSoftLight, b, w, o);
		check(o[0] <= 1.0 + 1e-9 && o[0] >= 0.0, "soft light with white stays in gamut");

		/* non-separable: luminosity takes its luminance from the gradient */
		blendRGB(kBlendLuminosity, b, s, o);
		checkNear(lum(o), lum(s), 1e-9, "luminosity adopts the gradient's luminance");

		/* ...and colour takes its luminance from the backdrop */
		blendRGB(kBlendColor, b, s, o);
		checkNear(lum(o), lum(b), 1e-9, "color keeps the backdrop's luminance");

		/* saturation adopts the gradient's saturation, backdrop's luminance */
		blendRGB(kBlendSaturation, b, s, o);
		checkNear(lum(o), lum(b), 1e-9, "saturation keeps the backdrop's luminance");

		/* every mode must stay finite on the extremes */
		double zero[3] = { 0.0, 0.0, 0.0 };
		double one[3]  = { 1.0, 1.0, 1.0 };
		for (int m = kBlendNormal; m <= kBlendLuminosity; ++m) {
			double r1[3], r2[3], r3[3];
			blendRGB(m, zero, one,  r1);
			blendRGB(m, one,  zero, r2);
			blendRGB(m, zero, zero, r3);
			bool fin = true;
			for (int c = 0; c < 3; ++c) {
				fin = fin && std::isfinite(r1[c]) && std::isfinite(r2[c]) && std::isfinite(r3[c]);
			}
			char msg[96];
			std::snprintf(msg, sizeof msg, "mode %d finite at the extremes", m);
			check(fin, msg);
		}
	}

	std::printf("\n%d checks, %d failed\n\n", g_run, g_fail);
	return g_fail == 0 ? 0 : 1;
}
