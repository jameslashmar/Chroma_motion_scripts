/*
	ChromaVRGradient3D.h

	An equirectangular (360 / VR) multi-point colour gradient, in the spirit of
	After Effects' own "VR Color Gradients", with one addition: every gradient
	point carries a Z axis, so the points live in 3D space rather than only on
	the surface of the sphere.

	This is an independent implementation of the standard maths involved
	(equirectangular projection + inverse-distance-weighted colour
	interpolation). No Adobe code is reproduced here.
*/

#pragma once

#ifndef CHROMA_VR_GRADIENT_3D_H
#define CHROMA_VR_GRADIENT_3D_H

#include "AEConfig.h"
#include "entry.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_EffectCBSuites.h"
#include "AE_EffectSuites.h"
#include "AE_Macros.h"
#include "AEGP_SuiteHandler.h"
#include "Param_Utils.h"
#include "Smart_Utils.h"

#define MAJOR_VERSION	1
#define MINOR_VERSION	0
#define BUG_VERSION		0
#define STAGE_VERSION	PF_Stage_RELEASE
#define BUILD_VERSION	1

#define STR_NAME			"VR Color Gradients 3D"
#define STR_DESCRIPTION		"A 360/VR multi-point colour gradient whose points can be moved in 3D space.\rChroma Studio."

/* ------------------------------------------------------------------ */
/*  Parameters                                                         */
/* ------------------------------------------------------------------ */

#define CHROMA_MAX_POINTS	8

enum {
	PARAM_INPUT = 0,

	PARAM_FRAME_LAYOUT,			/* popup: mono / over-under / side-by-side	*/
	PARAM_HFOV,					/* degrees									*/
	PARAM_VFOV,					/* degrees									*/

	PARAM_POINT_SPACE,			/* popup: equirect + distance / world XYZ	*/
	PARAM_DEPTH_SCALE,			/* pixels per one unit of sphere radius		*/

	PARAM_POINTS_NUMBER,		/* how many of the 8 points are live		*/
	PARAM_GRADIENT_POWER,		/* inverse-distance-weighting exponent		*/
	PARAM_GRADIENT_BLEND,		/* 0 % = hard cells, 100 % = smooth mix		*/

	PARAM_POINTS_TOPIC,

	PARAM_POINT_1,	PARAM_COLOR_1,
	PARAM_POINT_2,	PARAM_COLOR_2,
	PARAM_POINT_3,	PARAM_COLOR_3,
	PARAM_POINT_4,	PARAM_COLOR_4,
	PARAM_POINT_5,	PARAM_COLOR_5,
	PARAM_POINT_6,	PARAM_COLOR_6,
	PARAM_POINT_7,	PARAM_COLOR_7,
	PARAM_POINT_8,	PARAM_COLOR_8,

	PARAM_POINTS_TOPIC_END,

	PARAM_OPACITY,				/* percent									*/
	PARAM_BLEND_MODE,			/* popup									*/

	PARAM_COUNT
};

/*	The point/colour pairs are contiguous, so point i (0-based) is at
	PARAM_POINT_1 + 2 * i and its colour at PARAM_POINT_1 + 2 * i + 1.		*/
#define PARAM_POINT_N(i)	(PARAM_POINT_1 + 2 * (i))
#define PARAM_COLOR_N(i)	(PARAM_POINT_1 + 2 * (i) + 1)

/* Frame Layout ---------------------------------------------------- */
enum {
	LAYOUT_MONOSCOPIC = 1,
	LAYOUT_OVER_UNDER,
	LAYOUT_SIDE_BY_SIDE
};
#define STR_LAYOUT_CHOICES	"Monoscopic|Stereoscopic - Over/Under|Stereoscopic - Side-by-Side"

/* Point Space ----------------------------------------------------- */
enum {
	SPACE_EQUIRECT_DISTANCE = 1,	/* X,Y = equirect pixel; Z = depth offset	*/
	SPACE_WORLD_XYZ					/* X,Y,Z = Cartesian, origin at centre		*/
};
#define STR_SPACE_CHOICES	"Equirect + Distance|World XYZ"

/* Blending Mode --------------------------------------------------- */
enum {
	BLEND_NONE = 1,
	BLEND_NORMAL,
	BLEND_SEP_1,
	BLEND_ADD,
	BLEND_MULTIPLY,
	BLEND_SCREEN,
	BLEND_OVERLAY,
	BLEND_SOFT_LIGHT,
	BLEND_HARD_LIGHT,
	BLEND_SEP_2,
	BLEND_COLOR_DODGE,
	BLEND_COLOR_BURN,
	BLEND_SEP_3,
	BLEND_DARKEN,
	BLEND_LIGHTEN,
	BLEND_DIFFERENCE,
	BLEND_EXCLUSION,
	BLEND_SEP_4,
	BLEND_HUE,
	BLEND_SATURATION,
	BLEND_COLOR,
	BLEND_LUMINOSITY
};
#define STR_BLEND_CHOICES	"None|Normal|(-|Add|Multiply|Screen|Overlay|Soft Light|Hard Light|(-|" \
							"Color Dodge|Color Burn|(-|Darken|Lighten|Difference|Exclusion|(-|" \
							"Hue|Saturation|Color|Luminosity"

/* Defaults -------------------------------------------------------- */
#define HFOV_MIN		1.0
#define HFOV_MAX		360.0
#define HFOV_DFLT		360.0

#define VFOV_MIN		1.0
#define VFOV_MAX		180.0
#define VFOV_DFLT		180.0

#define DEPTH_SCALE_MIN		1.0
#define DEPTH_SCALE_MAX		10000.0
#define DEPTH_SCALE_DFLT	500.0

#define POINTS_NUM_MIN		1
#define POINTS_NUM_MAX		CHROMA_MAX_POINTS
#define POINTS_NUM_DFLT		4

#define POWER_MIN		0.10
#define POWER_MAX		16.0
#define POWER_DFLT		2.0

#define BLEND_MIN		0.0
#define BLEND_MAX		100.0
#define BLEND_DFLT		100.0

#define OPACITY_MIN		0.0
#define OPACITY_MAX		100.0
#define OPACITY_DFLT	100.0

/* ------------------------------------------------------------------ */
/*  Render-time state                                                  */
/* ------------------------------------------------------------------ */

typedef struct {
	PF_FpLong	x, y, z;
} ChromaVec3;

typedef struct {
	ChromaVec3	dir;			/* unit direction from the viewer			*/
	PF_FpLong	radius;			/* distance from the viewer, sphere = 1.0	*/
	PF_FpLong	rgb[3];			/* linear-ish 0..1 colour					*/
} ChromaGradientPoint;

typedef struct {
	ChromaGradientPoint	points[CHROMA_MAX_POINTS];
	A_long				num_points;

	A_long				layout;
	A_long				space;
	A_long				blend_mode;

	PF_FpLong			hfov;			/* radians							*/
	PF_FpLong			vfov;			/* radians							*/
	PF_FpLong			power;
	PF_FpLong			blend;			/* 0..1								*/
	PF_FpLong			opacity;		/* 0..1								*/

	A_long				width;			/* full layer size, pixels			*/
	A_long				height;
	PF_FpLong			sub_w;			/* one eye's frame size, pixels		*/
	PF_FpLong			sub_h;

	/*	Top-left of the buffer we are asked to render, in layer coordinates.
		Non-zero whenever AE asks for a sub-region, so the gradient stays
		anchored to the layer rather than sliding with the buffer.		*/
	A_long				origin_x;
	A_long				origin_y;
} ChromaRenderInfo;

#ifdef __cplusplus
extern "C" {
#endif

DllExport PF_Err EffectMain(
	PF_Cmd			cmd,
	PF_InData		*in_data,
	PF_OutData		*out_data,
	PF_ParamDef		*params[],
	PF_LayerDef		*output,
	void			*extra);

#ifdef __cplusplus
}
#endif

#endif	/* CHROMA_VR_GRADIENT_3D_H */
