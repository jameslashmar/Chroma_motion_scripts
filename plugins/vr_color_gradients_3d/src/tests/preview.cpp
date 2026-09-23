/*
	preview.cpp - render equirect previews of the gradient with no After
	Effects in the loop, so the projection and the Z axis can be eyeballed.

		g++ -std=c++17 -O2 -I.. preview.cpp -o preview && ./preview

	Writes a set of PPM files. It mirrors the plug-in's pixel loop exactly:
	same dirFromNormalized call, same defaults, same evaluate().
*/

#include "../ChromaGradientMath.h"

#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <string>
#include <vector>

using namespace chroma;

/* The plug-in's default point placement, verbatim. */
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

static const int   kW = 512;
static const int   kH = 256;
static const double kHFov = 360.0 * kPi / 180.0;
static const double kVFov = 180.0 * kPi / 180.0;

/*	Build the field the way GatherRenderInfo does: equirect percentage ->
	pixel -> normalised -> direction; Z -> radius.						*/
static GradientField buildField(int count, double power, double blend,
								const double* z_px, double depth_scale)
{
	GradientField f{};
	f.count = count;
	f.power = power;
	f.blend = blend;

	for (int i = 0; i < count; ++i) {
		const double px = kDefaults[i].x_pct / 100.0 * kW;
		const double py = kDefaults[i].y_pct / 100.0 * kH;

		f.points[i].dir    = dirFromNormalized(px / kW, py / kH, kHFov, kVFov);
		f.points[i].radius = 1.0 + (z_px ? z_px[i] : 0.0) / depth_scale;
		f.points[i].rgb[0] = kDefaults[i].r / 255.0;
		f.points[i].rgb[1] = kDefaults[i].g / 255.0;
		f.points[i].rgb[2] = kDefaults[i].b / 255.0;
	}
	return f;
}

static void render(const GradientField& f, const std::string& path) {
	std::vector<unsigned char> img(kW * kH * 3);

	for (int y = 0; y < kH; ++y) {
		for (int x = 0; x < kW; ++x) {
			const Vec3 d = dirFromNormalized(
				(x + 0.5) / static_cast<double>(kW),
				(y + 0.5) / static_cast<double>(kH),
				kHFov, kVFov);

			double c[3];
			evaluate(f, d, c);

			for (int k = 0; k < 3; ++k) {
				img[(y * kW + x) * 3 + k] =
					static_cast<unsigned char>(clamp01(c[k]) * 255.0 + 0.5);
			}
		}
	}

	std::FILE* fp = std::fopen(path.c_str(), "wb");
	if (!fp) { std::printf("  could not write %s\n", path.c_str()); return; }
	std::fprintf(fp, "P6\n%d %d\n255\n", kW, kH);
	std::fwrite(img.data(), 1, img.size(), fp);
	std::fclose(fp);
	std::printf("  wrote %s\n", path.c_str());
}

/*	Sample the colour at a point's own pixel: it must come back as that
	point's colour, otherwise placement and rendering disagree.			*/
static void checkPlacement(const GradientField& f, int count) {
	std::printf("\n-- point placement round-trip --\n");
	bool all_ok = true;
	for (int i = 0; i < count; ++i) {
		const double px = kDefaults[i].x_pct / 100.0 * kW;
		const double py = kDefaults[i].y_pct / 100.0 * kH;

		const Vec3 d = dirFromNormalized(px / kW, py / kH, kHFov, kVFov);
		double c[3];
		evaluate(f, d, c);

		const double want[3] = {
			kDefaults[i].r / 255.0, kDefaults[i].g / 255.0, kDefaults[i].b / 255.0
		};
		const double e = std::fabs(c[0]-want[0]) + std::fabs(c[1]-want[1]) + std::fabs(c[2]-want[2]);
		const bool ok = e < 1e-6;
		all_ok = all_ok && ok;
		std::printf("  %s  point %d -> (%.3f %.3f %.3f) want (%.3f %.3f %.3f)\n",
			ok ? "ok  " : "FAIL", i + 1, c[0], c[1], c[2], want[0], want[1], want[2]);
	}
	std::printf("  %s\n", all_ok ? "all points reproduce their own colour" : "PLACEMENT MISMATCH");
}

/*	Seam check: an equirect wraps, so the left and right edge columns are
	adjacent on the sphere and must match closely.						*/
static void checkSeam(const GradientField& f) {
	std::printf("\n-- horizontal wrap seam --\n");
	double worst = 0.0;
	for (int y = 0; y < kH; ++y) {
		const Vec3 dl = dirFromNormalized(0.5 / kW,          (y + 0.5) / kH, kHFov, kVFov);
		const Vec3 dr = dirFromNormalized((kW - 0.5) / kW,   (y + 0.5) / kH, kHFov, kVFov);
		double cl[3], cr[3];
		evaluate(f, dl, cl);
		evaluate(f, dr, cr);
		for (int k = 0; k < 3; ++k) worst = std::max(worst, std::fabs(cl[k] - cr[k]));
	}
	std::printf("  worst edge-to-edge difference: %.6f (%s)\n",
		worst, worst < 0.02 ? "seamless" : "VISIBLE SEAM");
}

/*	Poles: every pixel along the top row looks at (nearly) the same place,
	so the row must be near-constant or the poles will smear.			*/
static void checkPoles(const GradientField& f) {
	std::printf("\n-- pole consistency --\n");
	for (int row = 0; row < 2; ++row) {
		const double v = row == 0 ? 0.5 / kH : (kH - 0.5) / kH;
		double lo[3] = { 2, 2, 2 }, hi[3] = { -2, -2, -2 };
		for (int x = 0; x < kW; ++x) {
			const Vec3 d = dirFromNormalized((x + 0.5) / kW, v, kHFov, kVFov);
			double c[3];
			evaluate(f, d, c);
			for (int k = 0; k < 3; ++k) { lo[k] = std::min(lo[k], c[k]); hi[k] = std::max(hi[k], c[k]); }
		}
		double spread = 0.0;
		for (int k = 0; k < 3; ++k) spread = std::max(spread, hi[k] - lo[k]);
		std::printf("  %s pole row spread: %.6f (%s)\n",
			row == 0 ? "top   " : "bottom", spread, spread < 0.05 ? "consistent" : "SMEARED");
	}
}

int main() {
	const double depth_scale = 500.0;

	std::printf("rendering %dx%d equirect previews\n\n", kW, kH);

	GradientField flat = buildField(4, 2.0, 1.0, nullptr, depth_scale);
	render(flat, "preview_01_default_4pt.ppm");

	GradientField eight = buildField(8, 2.0, 1.0, nullptr, depth_scale);
	render(eight, "preview_02_eight_points.ppm");

	/* point 1 pulled toward the viewer, then pushed away */
	double z_near[8] = { -400, 0, 0, 0, 0, 0, 0, 0 };
	render(buildField(4, 2.0, 1.0, z_near, depth_scale), "preview_03_z_pulled_in.ppm");

	double z_far[8] = { 1500, 0, 0, 0, 0, 0, 0, 0 };
	render(buildField(4, 2.0, 1.0, z_far, depth_scale), "preview_04_z_pushed_out.ppm");

	/* hard cells */
	GradientField cells = buildField(4, 2.0, 0.0, nullptr, depth_scale);
	render(cells, "preview_05_blend_zero_cells.ppm");

	/* high power */
	GradientField tight = buildField(4, 8.0, 1.0, nullptr, depth_scale);
	render(tight, "preview_06_power_8.ppm");

	checkPlacement(flat, 4);
	checkSeam(flat);
	checkPoles(flat);

	std::printf("\n");
	return 0;
}
