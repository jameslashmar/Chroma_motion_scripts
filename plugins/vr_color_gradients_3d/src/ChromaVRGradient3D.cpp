/*
	ChromaVRGradient3D.cpp

	VR Color Gradients 3D - an equirectangular multi-point colour gradient
	whose points carry a Z axis, so they can be moved in 3D space rather than
	being pinned to the surface of the sphere.

	See ChromaGradientMath.h for the geometry and README.md for the parameter
	reference.
*/

#include "ChromaVRGradient3D.h"
#include "ChromaGradientMath.h"
#include "CreateNullsScript.h"

#include <cmath>
#include <cstring>
#include <string>

/* ------------------------------------------------------------------ */
/*  About / GlobalSetup                                                */
/* ------------------------------------------------------------------ */

static PF_Err About(
	PF_InData		*in_data,
	PF_OutData		*out_data,
	PF_ParamDef		*params[],
	PF_LayerDef		*output)
{
	AEGP_SuiteHandler suites(in_data->pica_basicP);

	suites.ANSICallbacksSuite1()->sprintf(
		out_data->return_msg,
		"%s v%d.%d\r%s",
		STR_NAME, MAJOR_VERSION, MINOR_VERSION, STR_DESCRIPTION);

	return PF_Err_NONE;
}

/*	AEGP id for the script and stream calls behind the Create Nulls button.
	Set once at global setup and only read afterwards.					*/
static AEGP_PluginID gAEGPPluginID = 0;

static PF_Err GlobalSetup(
	PF_InData		*in_data,
	PF_OutData		*out_data,
	PF_ParamDef		*params[],
	PF_LayerDef		*output)
{
	out_data->my_version = PF_VERSION(
		MAJOR_VERSION, MINOR_VERSION, BUG_VERSION, STAGE_VERSION, BUILD_VERSION);

	/*	Must agree with the hex in ChromaVRGradient3DPiPL.r or AE complains
		at load time.													*/
	out_data->out_flags =
		PF_OutFlag_PIX_INDEPENDENT |
		PF_OutFlag_DEEP_COLOR_AWARE |
		PF_OutFlag_SEND_UPDATE_PARAMS_UI;

	out_data->out_flags2 =
		PF_OutFlag2_PARAM_GROUP_START_COLLAPSED_FLAG |
		PF_OutFlag2_SUPPORTS_SMART_RENDER |
		PF_OutFlag2_FLOAT_COLOR_AWARE |
		PF_OutFlag2_SUPPORTS_THREADED_RENDERING;

	/*	Only the button needs this, so failing to register is not fatal:
		the effect still renders, and the button reports the problem.	*/
	AEGP_SuiteHandler suites(in_data->pica_basicP);
	if (suites.UtilitySuite6()->AEGP_RegisterWithAEGP(NULL, STR_NAME, &gAEGPPluginID) != A_Err_NONE) {
		gAEGPPluginID = 0;
	}

	return PF_Err_NONE;
}

/* ------------------------------------------------------------------ */
/*  Parameters                                                         */
/* ------------------------------------------------------------------ */

/*	Default equirect positions, as a percentage of the layer, plus a default
	colour. Spread around the frame so dropping the effect on a solid gives
	something immediately readable.										*/
typedef struct {
	PF_FpLong	x_pct, y_pct;
	A_u_char	r, g, b;
} ChromaPointDefault;

static const ChromaPointDefault kPointDefaults[CHROMA_MAX_POINTS] = {
	{ 25.0, 30.0, 255, 120,  40 },		/* warm orange	*/
	{ 75.0, 30.0, 200,  40, 160 },		/* magenta		*/
	{ 25.0, 70.0,  30,  60, 200 },		/* deep blue	*/
	{ 75.0, 70.0,   0, 180, 180 },		/* teal			*/
	{ 50.0, 15.0, 255, 220,  60 },		/* yellow		*/
	{ 50.0, 85.0, 110,  40, 200 },		/* purple		*/
	{ 10.0, 50.0,  60, 200,  90 },		/* green		*/
	{ 90.0, 50.0, 220,  40,  60 }		/* red			*/
};

/*	A popup's item count is passed separately from its item string, so the two
	drift apart silently - an undercount simply truncates the menu. Counting
	the separators at compile time and asserting against the enum keeps them
	honest. Separator entries ("(-") do occupy an index.					*/
static constexpr int CountMenuItems(const char *s) {
	int n = 1;
	for (; *s; ++s) {
		if (*s == '|') ++n;
	}
	return n;
}

static_assert(CountMenuItems(STR_BLEND_CHOICES) == BLEND_LUMINOSITY,
	"Blending Mode menu string and enum disagree");
static_assert(CountMenuItems(STR_LAYOUT_CHOICES) == LAYOUT_SIDE_BY_SIDE,
	"Frame Layout menu string and enum disagree");
static_assert(CountMenuItems(STR_SPACE_CHOICES) == SPACE_WORLD_XYZ,
	"Point Space menu string and enum disagree");
static_assert(PARAM_ALPHA_N(CHROMA_MAX_POINTS - 1) + 1 == PARAM_POINTS_TOPIC_END,
	"Point/Color/Alpha rows and PARAM_STRIDE disagree");

/*	The disk IDs saved projects depend on - see the note on the enum. If one
	of these fires, a parameter was inserted or moved; put it back and add
	the new one just before PARAM_COUNT instead.						*/
static_assert(PARAM_FRAME_LAYOUT     ==  1, "parameter disk IDs moved");
static_assert(PARAM_GRADIENT_BLEND   ==  8, "parameter disk IDs moved");
static_assert(PARAM_CREATE_NULLS     ==  9, "parameter disk IDs moved");
static_assert(PARAM_POINT_1          == 11, "parameter disk IDs moved");
static_assert(PARAM_POINTS_TOPIC_END == 35, "parameter disk IDs moved");
static_assert(PARAM_OPACITY          == 36, "parameter disk IDs moved");
static_assert(PARAM_BLEND_MODE       == 37, "parameter disk IDs moved");
static_assert(PARAM_ALPHA_CUTS_LAYER == 38, "parameter disk IDs moved");

static PF_Err ParamsSetup(
	PF_InData		*in_data,
	PF_OutData		*out_data,
	PF_ParamDef		*params[],
	PF_LayerDef		*output)
{
	PF_Err			err = PF_Err_NONE;
	PF_ParamDef		def;

	AEFX_CLR_STRUCT(def);
	PF_ADD_POPUP("Frame Layout", CountMenuItems(STR_LAYOUT_CHOICES), LAYOUT_MONOSCOPIC, STR_LAYOUT_CHOICES, PARAM_FRAME_LAYOUT);

	AEFX_CLR_STRUCT(def);
	PF_ADD_FLOAT_SLIDERX("Horizontal Field of View",
		HFOV_MIN, HFOV_MAX, HFOV_MIN, HFOV_MAX, HFOV_DFLT,
		PF_Precision_TENTHS, PF_ValueDisplayFlag_NONE, 0, PARAM_HFOV);

	AEFX_CLR_STRUCT(def);
	PF_ADD_FLOAT_SLIDERX("Vertical Field of View",
		VFOV_MIN, VFOV_MAX, VFOV_MIN, VFOV_MAX, VFOV_DFLT,
		PF_Precision_TENTHS, PF_ValueDisplayFlag_NONE, 0, PARAM_VFOV);

	AEFX_CLR_STRUCT(def);
	PF_ADD_POPUP("Point Space", CountMenuItems(STR_SPACE_CHOICES), SPACE_EQUIRECT_DISTANCE, STR_SPACE_CHOICES, PARAM_POINT_SPACE);

	AEFX_CLR_STRUCT(def);
	PF_ADD_FLOAT_SLIDERX("Depth Scale",
		DEPTH_SCALE_MIN, DEPTH_SCALE_MAX, DEPTH_SCALE_MIN, 2000.0, DEPTH_SCALE_DFLT,
		PF_Precision_INTEGER, PF_ValueDisplayFlag_NONE, 0, PARAM_DEPTH_SCALE);

	/*	Supervised so the point rows below it can be greyed out live.	*/
	AEFX_CLR_STRUCT(def);
	def.flags = PF_ParamFlag_SUPERVISE;
	PF_ADD_SLIDER("Points Number",
		POINTS_NUM_MIN, POINTS_NUM_MAX, POINTS_NUM_MIN, POINTS_NUM_MAX,
		POINTS_NUM_DFLT, PARAM_POINTS_NUMBER);

	AEFX_CLR_STRUCT(def);
	PF_ADD_FLOAT_SLIDERX("Gradient Power",
		POWER_MIN, POWER_MAX, POWER_MIN, 8.0, POWER_DFLT,
		PF_Precision_HUNDREDTHS, PF_ValueDisplayFlag_NONE, 0, PARAM_GRADIENT_POWER);

	AEFX_CLR_STRUCT(def);
	PF_ADD_FLOAT_SLIDERX("Gradient Blend",
		BLEND_MIN, BLEND_MAX, BLEND_MIN, BLEND_MAX, BLEND_DFLT,
		PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, 0, PARAM_GRADIENT_BLEND);

	PF_ADD_BUTTON("Point Nulls", "Create Nulls from Points",
		0, PF_ParamFlag_SUPERVISE | PF_ParamFlag_CANNOT_TIME_VARY, PARAM_CREATE_NULLS);

	AEFX_CLR_STRUCT(def);
	PF_ADD_TOPIC("Points", PARAM_POINTS_TOPIC);

	for (int i = 0; i < CHROMA_MAX_POINTS; ++i) {
		A_char point_name[32];
		A_char color_name[32];
		A_char alpha_name[32];

		std::snprintf(point_name, sizeof point_name, "Point %d", i + 1);
		std::snprintf(color_name, sizeof color_name, "Color %d", i + 1);
		std::snprintf(alpha_name, sizeof alpha_name, "Alpha %d", i + 1);

		/*	Added by hand rather than through PF_ADD_POINT_3D: as of SDK
			25.6 that macro assigns Y_DFLT to z_value/z_dephault (see
			Param_Utils.h line 291), so asking for a Z default of 0 would
			silently land the point at the Y percentage instead - every
			point would start pushed out in depth and the effect would not
			match a flat gradient out of the box.

			Defaults are percentages: x of layer width, y and z of layer
			height. Z of 0 puts the point on the sphere (radius 1).		*/
		AEFX_CLR_STRUCT(def);
		def.param_type = PF_Param_POINT_3D;
		PF_STRNNCPY(def.PF_DEF_NAME, point_name, sizeof(def.PF_DEF_NAME));
		def.u.point3d_d.x_value = def.u.point3d_d.x_dephault = kPointDefaults[i].x_pct;
		def.u.point3d_d.y_value = def.u.point3d_d.y_dephault = kPointDefaults[i].y_pct;
		def.u.point3d_d.z_value = def.u.point3d_d.z_dephault = 0.0;
		def.uu.id = PARAM_POINT_N(i);
		ERR(PF_ADD_PARAM(in_data, -1, &def));
		if (err) return err;

		AEFX_CLR_STRUCT(def);
		PF_ADD_COLOR(color_name,
			kPointDefaults[i].r, kPointDefaults[i].g, kPointDefaults[i].b,
			PARAM_COLOR_N(i));

		/*	AE's colour picker has no alpha channel, so each colour gets its
			own keyframeable slider directly beneath it.				*/
		AEFX_CLR_STRUCT(def);
		PF_ADD_FLOAT_SLIDERX(alpha_name,
			ALPHA_MIN, ALPHA_MAX, ALPHA_MIN, ALPHA_MAX, ALPHA_DFLT,
			PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, 0, PARAM_ALPHA_N(i));
	}

	AEFX_CLR_STRUCT(def);
	PF_END_TOPIC(PARAM_POINTS_TOPIC_END);

	AEFX_CLR_STRUCT(def);
	PF_ADD_FLOAT_SLIDERX("Opacity",
		OPACITY_MIN, OPACITY_MAX, OPACITY_MIN, OPACITY_MAX, OPACITY_DFLT,
		PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, 0, PARAM_OPACITY);

	AEFX_CLR_STRUCT(def);
	PF_ADD_POPUP("Blending Mode", CountMenuItems(STR_BLEND_CHOICES), BLEND_NORMAL, STR_BLEND_CHOICES, PARAM_BLEND_MODE);

	AEFX_CLR_STRUCT(def);
	PF_ADD_CHECKBOX("Alpha", "Makes layer transparent", TRUE, 0, PARAM_ALPHA_CUTS_LAYER);

	out_data->num_params = PARAM_COUNT;

	return err;
}

/* ------------------------------------------------------------------ */
/*  Parameter supervision - grey out unused point rows                 */
/* ------------------------------------------------------------------ */

static PF_Err UpdateParameterUI(
	PF_InData		*in_data,
	PF_OutData		*out_data,
	PF_ParamDef		*params[],
	PF_LayerDef		*output)
{
	PF_Err				err = PF_Err_NONE;
	AEGP_SuiteHandler	suites(in_data->pica_basicP);

	const A_long active = params[PARAM_POINTS_NUMBER]->u.sd.value;

	for (int i = 0; i < CHROMA_MAX_POINTS; ++i) {
		const bool live = (i < active);

		const int idx[3] = { PARAM_POINT_N(i), PARAM_COLOR_N(i), PARAM_ALPHA_N(i) };
		for (int k = 0; k < 3; ++k) {
			PF_ParamDef copy = *params[idx[k]];

			if (live) {
				copy.ui_flags &= ~PF_PUI_DISABLED;
			} else {
				copy.ui_flags |= PF_PUI_DISABLED;
			}

			ERR(suites.ParamUtilsSuite3()->PF_UpdateParamUI(
				in_data->effect_ref, idx[k], &copy));
		}
	}

	return err;
}

/*	Append a UTF-16 string to a JS source string as a quoted literal made
	of \uXXXX escapes, so no effect name can break out of the quotes and
	nothing depends on the platform's text encoding.					*/
static void AppendJsString(std::string &out, const A_UTF16Char *s) {
	static const char kHex[] = "0123456789ABCDEF";
	out += '"';
	for (; s && *s; ++s) {
		const unsigned c = static_cast<unsigned>(*s);
		out += "\\u";
		out += kHex[(c >> 12) & 0xF];
		out += kHex[(c >>  8) & 0xF];
		out += kHex[(c >>  4) & 0xF];
		out += kHex[ c        & 0xF];
	}
	out += '"';
}

/*	Work out which comp, layer and effect instance the button belongs to,
	then hand over to the script in CreateNullsScript.h.				*/
static PF_Err CreateNullsFromPoints(PF_InData *in_data, PF_OutData *out_data)
{
	AEGP_SuiteHandler	suites(in_data->pica_basicP);
	A_Err				err = A_Err_NONE;

	AEGP_LayerH			layerH  = NULL;
	AEGP_CompH			compH   = NULL;
	AEGP_ItemH			itemH   = NULL;
	AEGP_EffectRefH		effectH = NULL;
	AEGP_StreamRefH		paramS  = NULL;
	AEGP_StreamRefH		effectS = NULL;
	AEGP_MemHandle		nameH   = NULL;
	A_long				layer_index = 0;
	A_long				comp_id = 0;
	std::string			js;

	if (!gAEGPPluginID) {
		suites.ANSICallbacksSuite1()->sprintf(out_data->return_msg,
			"Create Nulls from Points could not register with After Effects.");
		out_data->out_flags |= PF_OutFlag_DISPLAY_ERROR_MESSAGE;
		return PF_Err_NONE;
	}

	ERR(suites.PFInterfaceSuite1()->AEGP_GetEffectLayer(in_data->effect_ref, &layerH));
	ERR(suites.LayerSuite9()->AEGP_GetLayerIndex(layerH, &layer_index));
	ERR(suites.LayerSuite9()->AEGP_GetLayerParentComp(layerH, &compH));
	ERR(suites.CompSuite12()->AEGP_GetItemFromComp(compH, &itemH));
	ERR(suites.ItemSuite9()->AEGP_GetItemID(itemH, &comp_id));

	/*	The effect's display name - unique on its layer, which is what lets
		the script tell two instances of this effect apart. Reached through
		the first parameter's stream, whose parent is the effect itself.	*/
	ERR(suites.PFInterfaceSuite1()->AEGP_GetNewEffectForEffect(gAEGPPluginID, in_data->effect_ref, &effectH));
	ERR(suites.StreamSuite6()->AEGP_GetNewEffectStreamByIndex(gAEGPPluginID, effectH, PARAM_FRAME_LAYOUT, &paramS));
	ERR(suites.DynamicStreamSuite4()->AEGP_GetNewParentStreamRef(gAEGPPluginID, paramS, &effectS));
	ERR(suites.StreamSuite6()->AEGP_GetStreamName(gAEGPPluginID, effectS, FALSE, &nameH));

	if (!err) {
		A_UTF16Char *nameP = NULL;
		ERR(suites.MemorySuite1()->AEGP_LockMemHandle(nameH, reinterpret_cast<void **>(&nameP)));
		if (!err) {
			char head[96];
			std::snprintf(head, sizeof head,
				"\n__chromaVRG3DArgs = { comp: %d, layer: %d, fx: ",
				static_cast<int>(comp_id), static_cast<int>(layer_index + 1));
			js  = kCreateNullsScript;
			js += head;
			AppendJsString(js, nameP);
			js += " };\n"
				  "app.scheduleTask(\"__chromaVRG3DSync(__chromaVRG3DArgs)\", 0, false);\n";
			suites.MemorySuite1()->AEGP_UnlockMemHandle(nameH);
		}
	}

	if (nameH)   suites.MemorySuite1()->AEGP_FreeMemHandle(nameH);
	if (effectS) suites.StreamSuite6()->AEGP_DisposeStream(effectS);
	if (paramS)  suites.StreamSuite6()->AEGP_DisposeStream(paramS);
	if (effectH) suites.EffectSuite4()->AEGP_DisposeEffect(effectH);

	if (!err) {
		AEGP_MemHandle errH = NULL;
		err = suites.UtilitySuite6()->AEGP_ExecuteScript(
			gAEGPPluginID, js.c_str(), FALSE, NULL, &errH);
		if (errH) suites.MemorySuite1()->AEGP_FreeMemHandle(errH);
	}

	if (err) {
		suites.ANSICallbacksSuite1()->sprintf(out_data->return_msg,
			"Create Nulls from Points failed (error %d).", static_cast<int>(err));
		out_data->out_flags |= PF_OutFlag_DISPLAY_ERROR_MESSAGE;
	}

	return PF_Err_NONE;
}

static PF_Err UserChangedParam(
	PF_InData						*in_data,
	PF_OutData						*out_data,
	PF_ParamDef						*params[],
	const PF_UserChangedParamExtra	*which_hitP)
{
	/*	Points Number needs nothing here; PF_Cmd_UPDATE_PARAMS_UI does the
		greying out, and handling this command is what makes AE send it.	*/
	if (which_hitP && which_hitP->param_index == PARAM_CREATE_NULLS) {
		return CreateNullsFromPoints(in_data, out_data);
	}
	return PF_Err_NONE;
}

/* ------------------------------------------------------------------ */
/*  Gathering parameters                                               */
/* ------------------------------------------------------------------ */

/*	A colour parameter is authored in 8-bit, but the project may be working
	in 16-bit or float and in a linear space. PF_GetFloatingPointColorFrom-
	ColorDef hands back the value already converted into the working space,
	which is the only correct source for a float-aware effect. Fall back to
	a plain 8-bit divide if the suite is unavailable.					*/
static void ColorToFloat(
	PF_InData		*in_data,
	PF_ParamDef		*paramP,
	double			 out_rgb[3])
{
	AEGP_SuiteHandler	suites(in_data->pica_basicP);
	PF_PixelFloat		fc = { 0, 0, 0, 0 };
	PF_Err				err = PF_Err_NONE;

	err = suites.ColorParamSuite1()->PF_GetFloatingPointColorFromColorDef(
		in_data->effect_ref, paramP, &fc);

	if (!err) {
		out_rgb[0] = fc.red;
		out_rgb[1] = fc.green;
		out_rgb[2] = fc.blue;
	} else {
		out_rgb[0] = paramP->u.cd.value.red   / 255.0;
		out_rgb[1] = paramP->u.cd.value.green / 255.0;
		out_rgb[2] = paramP->u.cd.value.blue  / 255.0;
	}
}

/*	Build everything the render needs from the parameter values. Called once
	per frame from PreRender, never per pixel.							*/
static PF_Err GatherRenderInfo(
	PF_InData			*in_data,
	ChromaRenderInfo	*infoP)
{
	PF_Err		err = PF_Err_NONE;
	PF_ParamDef	p;

	AEFX_CLR_STRUCT(*infoP);

	infoP->width  = in_data->width;
	infoP->height = in_data->height;

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_FRAME_LAYOUT, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->layout = p.u.pd.value;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_HFOV, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->hfov = p.u.fs_d.value * chroma::kPi / 180.0;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_VFOV, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->vfov = p.u.fs_d.value * chroma::kPi / 180.0;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_POINT_SPACE, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->space = p.u.pd.value;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	PF_FpLong depth_scale = DEPTH_SCALE_DFLT;
	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_DEPTH_SCALE, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	depth_scale = p.u.fs_d.value;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	/*	Point parameters are scaled by AE for the current resolution; plain
		sliders are not (AE_Effect.h:3061-3068 - only "scalar parameters
		(ie. sliders)" need the effect to compensate). Depth Scale is a
		slider measured in pixels and gets divided into point values, so
		without this it would drift and Half resolution would not match
		Full.														*/
	if (in_data->downsample_y.den) {
		depth_scale *= static_cast<PF_FpLong>(in_data->downsample_y.num) /
					   static_cast<PF_FpLong>(in_data->downsample_y.den);
	}
	if (depth_scale < 1e-3) depth_scale = 1e-3;

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_POINTS_NUMBER, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->num_points = p.u.sd.value;
	ERR(PF_CHECKIN_PARAM(in_data, &p));
	if (infoP->num_points < 1) infoP->num_points = 1;
	if (infoP->num_points > CHROMA_MAX_POINTS) infoP->num_points = CHROMA_MAX_POINTS;

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_GRADIENT_POWER, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->power = p.u.fs_d.value;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_GRADIENT_BLEND, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->blend = p.u.fs_d.value / 100.0;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_OPACITY, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->opacity = p.u.fs_d.value / 100.0;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_BLEND_MODE, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->blend_mode = p.u.pd.value;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	AEFX_CLR_STRUCT(p);
	ERR(PF_CHECKOUT_PARAM(in_data, PARAM_ALPHA_CUTS_LAYER, in_data->current_time,
		in_data->time_step, in_data->time_scale, &p));
	infoP->alpha_cuts_layer = p.u.bd.value ? 1 : 0;
	ERR(PF_CHECKIN_PARAM(in_data, &p));

	/*	One eye's frame. The gradient itself is identical for both eyes - it
		sits far enough away that there is no meaningful parallax - so the
		points are authored against the first eye and reused for the second. */
	infoP->sub_w = static_cast<PF_FpLong>(infoP->width);
	infoP->sub_h = static_cast<PF_FpLong>(infoP->height);

	if (infoP->layout == LAYOUT_OVER_UNDER) {
		infoP->sub_h *= 0.5;
	} else if (infoP->layout == LAYOUT_SIDE_BY_SIDE) {
		infoP->sub_w *= 0.5;
	}
	if (infoP->sub_w < 1.0) infoP->sub_w = 1.0;
	if (infoP->sub_h < 1.0) infoP->sub_h = 1.0;

	/*	Point params arrive in the current downsampled resolution, the same
		space as in_data->width/height, so no rescaling is needed here.	*/
	const PF_FpLong cx = infoP->sub_w * 0.5;
	const PF_FpLong cy = infoP->sub_h * 0.5;

	for (A_long i = 0; i < infoP->num_points; ++i) {
		AEFX_CLR_STRUCT(p);
		ERR(PF_CHECKOUT_PARAM(in_data, PARAM_POINT_N(i), in_data->current_time,
			in_data->time_step, in_data->time_scale, &p));

		const PF_FpLong px = p.u.point3d_d.x_value;
		const PF_FpLong py = p.u.point3d_d.y_value;
		const PF_FpLong pz = p.u.point3d_d.z_value;

		ERR(PF_CHECKIN_PARAM(in_data, &p));

		chroma::Vec3 dir;
		double       radius;

		if (infoP->space == SPACE_WORLD_XYZ) {
			/*	Cartesian, viewer at the centre of the frame. AE's Y axis
				points down, so it is flipped into the maths convention.	*/
			chroma::Vec3 world = {
				 (px - cx),
				-(py - cy),
				 pz
			};
			dir    = chroma::normalize(world);
			radius = chroma::length(world) / depth_scale;
		} else {
			/*	Equirect position for the direction, Z for the depth.
				Z == 0 gives radius 1, which is exactly the behaviour of a
				point pinned to the sphere.								*/
			dir = chroma::dirFromNormalized(
				px / infoP->sub_w,
				py / infoP->sub_h,
				infoP->hfov, infoP->vfov);
			radius = 1.0 + pz / depth_scale;
		}

		if (radius < 0.0)  radius = 0.0;
		if (radius > 1e6)  radius = 1e6;

		infoP->points[i].dir    = ChromaVec3{ dir.x, dir.y, dir.z };
		infoP->points[i].radius = radius;

		AEFX_CLR_STRUCT(p);
		ERR(PF_CHECKOUT_PARAM(in_data, PARAM_COLOR_N(i), in_data->current_time,
			in_data->time_step, in_data->time_scale, &p));
		ColorToFloat(in_data, &p, infoP->points[i].rgb);
		ERR(PF_CHECKIN_PARAM(in_data, &p));

		AEFX_CLR_STRUCT(p);
		ERR(PF_CHECKOUT_PARAM(in_data, PARAM_ALPHA_N(i), in_data->current_time,
			in_data->time_step, in_data->time_scale, &p));
		infoP->points[i].alpha = chroma::clamp01(p.u.fs_d.value / 100.0);
		ERR(PF_CHECKIN_PARAM(in_data, &p));
	}

	return err;
}

/* ------------------------------------------------------------------ */
/*  Per-pixel work                                                     */
/* ------------------------------------------------------------------ */

typedef struct {
	const ChromaRenderInfo	*infoP;
	chroma::GradientField	 field;
	A_long					 origin_x;
	A_long					 origin_y;
	int						 blend_mode;		/* mapped to chroma::BlendMode	*/
} ChromaIterateRefcon;

/*	Map the popup index (which carries separator entries) onto the maths
	header's contiguous enum.											*/
static int MapBlendMode(A_long popup_value) {
	switch (popup_value) {
		case BLEND_NONE:		return chroma::kBlendNone;
		case BLEND_NORMAL:		return chroma::kBlendNormal;
		case BLEND_ADD:			return chroma::kBlendAdd;
		case BLEND_MULTIPLY:	return chroma::kBlendMultiply;
		case BLEND_SCREEN:		return chroma::kBlendScreen;
		case BLEND_OVERLAY:		return chroma::kBlendOverlay;
		case BLEND_SOFT_LIGHT:	return chroma::kBlendSoftLight;
		case BLEND_HARD_LIGHT:	return chroma::kBlendHardLight;
		case BLEND_COLOR_DODGE:	return chroma::kBlendColorDodge;
		case BLEND_COLOR_BURN:	return chroma::kBlendColorBurn;
		case BLEND_DARKEN:		return chroma::kBlendDarken;
		case BLEND_LIGHTEN:		return chroma::kBlendLighten;
		case BLEND_DIFFERENCE:	return chroma::kBlendDifference;
		case BLEND_EXCLUSION:	return chroma::kBlendExclusion;
		case BLEND_HUE:			return chroma::kBlendHue;
		case BLEND_SATURATION:	return chroma::kBlendSaturation;
		case BLEND_COLOR:		return chroma::kBlendColor;
		case BLEND_LUMINOSITY:	return chroma::kBlendLuminosity;
		default:				return chroma::kBlendNormal;
	}
}

/*	Layer pixel (absolute, current resolution) -> view direction.
	For the stereo layouts the pixel is folded into its own eye's frame
	first, so both eyes receive the same gradient.						*/
static chroma::Vec3 DirectionForPixel(
	const ChromaRenderInfo	*infoP,
	double					 abs_x,
	double					 abs_y)
{
	double fx = abs_x;
	double fy = abs_y;

	if (infoP->layout == LAYOUT_OVER_UNDER) {
		if (fy >= infoP->sub_h) fy -= infoP->sub_h;
	} else if (infoP->layout == LAYOUT_SIDE_BY_SIDE) {
		if (fx >= infoP->sub_w) fx -= infoP->sub_w;
	}

	return chroma::dirFromNormalized(
		(fx + 0.5) / infoP->sub_w,
		(fy + 0.5) / infoP->sub_h,
		infoP->hfov, infoP->vfov);
}

/*	Shared core: given the source pixel (straight colour + alpha, 0..1),
	produce the output pixel.

	What the gradient's alpha does is the Alpha checkbox's choice:

	  on  (default)	the alpha cuts the layer: where a point is transparent
					the layer becomes see-through, so whatever is below it
					in the comp shows. This is what people expect - on a
					solid, the alternative just reveals the solid's colour.
	  off			the alpha only fades the effect: transparent points let
					the layer's own pixels through, and the layer's alpha is
					left alone - like a layer style's gradient overlay.

	"None" replaces the frame rather than compositing, so there the
	gradient's alpha simply becomes the layer's alpha either way.		*/
static void ShadePixel(
	const ChromaIterateRefcon	*rc,
	A_long						 x,
	A_long						 y,
	const double				 src_rgb[3],
	double						 src_alpha,
	double						 out_rgb[3],
	double						*out_alpha)
{
	const ChromaRenderInfo *infoP = rc->infoP;

	const chroma::Vec3 dir = DirectionForPixel(
		infoP,
		static_cast<double>(x + rc->origin_x),
		static_cast<double>(y + rc->origin_y));

	double grad[3];
	double grad_a = 1.0;
	chroma::evaluate(rc->field, dir, grad, &grad_a);

	if (rc->blend_mode == chroma::kBlendNone) {
		/*	Mix premultiplied, then divide back out, so a half-transparent
			gradient over a transparent layer does not pick up the layer's
			invisible colour.										*/
		const double k  = infoP->opacity;
		const double a  = src_alpha + k * (grad_a - src_alpha);
		for (int c = 0; c < 3; ++c) {
			const double p = src_rgb[c] * src_alpha +
							 k * (grad[c] * grad_a - src_rgb[c] * src_alpha);
			out_rgb[c] = (a > 1e-9) ? p / a : grad[c];
		}
		*out_alpha = a;
		return;
	}

	double blended[3];
	chroma::blendRGB(rc->blend_mode, src_rgb, grad, blended);

	if (infoP->alpha_cuts_layer) {
		const double k = infoP->opacity;
		for (int c = 0; c < 3; ++c) {
			out_rgb[c] = src_rgb[c] + k * (blended[c] - src_rgb[c]);
		}
		*out_alpha = src_alpha * (1.0 - k * (1.0 - grad_a));
		return;
	}

	const double k = infoP->opacity * grad_a;
	for (int c = 0; c < 3; ++c) {
		out_rgb[c] = src_rgb[c] + k * (blended[c] - src_rgb[c]);
	}
	*out_alpha = src_alpha;
}

/* --- 8 bit -------------------------------------------------------- */

static PF_Err ShadePixel8(
	void		*refcon,
	A_long		 x,
	A_long		 y,
	PF_Pixel8	*inP,
	PF_Pixel8	*outP)
{
	const ChromaIterateRefcon *rc = static_cast<ChromaIterateRefcon *>(refcon);

	const double src[3] = {
		inP->red / 255.0, inP->green / 255.0, inP->blue / 255.0
	};
	double out[3];
	double out_a;
	ShadePixel(rc, x, y, src, inP->alpha / 255.0, out, &out_a);

	outP->alpha = static_cast<A_u_char>(chroma::clamp01(out_a) * 255.0 + 0.5);
	outP->red   = static_cast<A_u_char>(chroma::clamp01(out[0]) * 255.0 + 0.5);
	outP->green = static_cast<A_u_char>(chroma::clamp01(out[1]) * 255.0 + 0.5);
	outP->blue  = static_cast<A_u_char>(chroma::clamp01(out[2]) * 255.0 + 0.5);

	return PF_Err_NONE;
}

/* --- 16 bit ------------------------------------------------------- */

static PF_Err ShadePixel16(
	void		*refcon,
	A_long		 x,
	A_long		 y,
	PF_Pixel16	*inP,
	PF_Pixel16	*outP)
{
	const ChromaIterateRefcon *rc = static_cast<ChromaIterateRefcon *>(refcon);

	const double kMax = static_cast<double>(PF_MAX_CHAN16);
	const double src[3] = {
		inP->red / kMax, inP->green / kMax, inP->blue / kMax
	};
	double out[3];
	double out_a;
	ShadePixel(rc, x, y, src, inP->alpha / kMax, out, &out_a);

	outP->alpha = static_cast<A_u_short>(chroma::clamp01(out_a) * kMax + 0.5);
	outP->red   = static_cast<A_u_short>(chroma::clamp01(out[0]) * kMax + 0.5);
	outP->green = static_cast<A_u_short>(chroma::clamp01(out[1]) * kMax + 0.5);
	outP->blue  = static_cast<A_u_short>(chroma::clamp01(out[2]) * kMax + 0.5);

	return PF_Err_NONE;
}

/* --- 32 bit float ------------------------------------------------- */

static PF_Err ShadePixelFloat(
	void			*refcon,
	A_long			 x,
	A_long			 y,
	PF_PixelFloat	*inP,
	PF_PixelFloat	*outP)
{
	const ChromaIterateRefcon *rc = static_cast<ChromaIterateRefcon *>(refcon);

	const double src[3] = { inP->red, inP->green, inP->blue };
	double out[3];
	double out_a;
	ShadePixel(rc, x, y, src, inP->alpha, out, &out_a);

	/*	Float output is deliberately left unclamped above 1.0 so overbright
		results survive into later effects; only negatives are cut.		*/
	outP->alpha = static_cast<PF_FpShort>(chroma::clamp01(out_a));
	outP->red   = static_cast<PF_FpShort>(out[0] < 0.0 ? 0.0 : out[0]);
	outP->green = static_cast<PF_FpShort>(out[1] < 0.0 ? 0.0 : out[1]);
	outP->blue  = static_cast<PF_FpShort>(out[2] < 0.0 ? 0.0 : out[2]);

	return PF_Err_NONE;
}

/* ------------------------------------------------------------------ */
/*  Smart render                                                       */
/* ------------------------------------------------------------------ */

static PF_Err PreRender(
	PF_InData			*in_data,
	PF_OutData			*out_data,
	PF_PreRenderExtra	*extraP)
{
	PF_Err				err = PF_Err_NONE;
	PF_RenderRequest	req = extraP->input->output_request;
	PF_CheckoutResult	in_result;

	ERR(extraP->cb->checkout_layer(
		in_data->effect_ref, PARAM_INPUT, PARAM_INPUT,
		&req, in_data->current_time, in_data->time_step, in_data->time_scale,
		&in_result));

	if (!err) {
		UnionLRect(&in_result.result_rect,     &extraP->output->result_rect);
		UnionLRect(&in_result.max_result_rect, &extraP->output->max_result_rect);
	}

	/*	Stash the gathered parameters so SmartRender does not have to check
		out anything but pixels.										*/
	PF_Handle infoH = PF_NEW_HANDLE(sizeof(ChromaRenderInfo));
	if (!infoH) return PF_Err_OUT_OF_MEMORY;

	ChromaRenderInfo *infoP = static_cast<ChromaRenderInfo *>(PF_LOCK_HANDLE(infoH));
	if (!infoP) {
		PF_DISPOSE_HANDLE(infoH);
		return PF_Err_OUT_OF_MEMORY;
	}

	ERR(GatherRenderInfo(in_data, infoP));

	/*	Anchor the gradient to the layer, not to the buffer. AE may hand us a
		sub-region (region of interest, partial repaint), in which case the
		output world's (0,0) is at result_rect's top-left in layer space.

		in_data->output_origin_x is NOT this value - that field is the offset
		of the input buffer within the output buffer, and is documented as
		"non-zero only when effect changes buffer size" (AE_Effect.h:3138).
		Using it here would leave the gradient pinned to the buffer and make
		it slide whenever AE rendered less than the whole layer.			*/
	{
		const PF_LRect *rectP = &extraP->output->result_rect;
		if (rectP->right <= rectP->left || rectP->bottom <= rectP->top) {
			rectP = &extraP->input->output_request.rect;		/* empty: fall back */
		}
		infoP->origin_x = rectP->left;
		infoP->origin_y = rectP->top;
	}

	PF_UNLOCK_HANDLE(infoH);

	if (err) {
		PF_DISPOSE_HANDLE(infoH);
		return err;
	}

	extraP->output->pre_render_data = infoH;

	return err;
}

static PF_Err SmartRender(
	PF_InData				*in_data,
	PF_OutData				*out_data,
	PF_SmartRenderExtra		*extraP)
{
	PF_Err				err = PF_Err_NONE, err2 = PF_Err_NONE;
	AEGP_SuiteHandler	suites(in_data->pica_basicP);

	PF_EffectWorld		*inputP  = NULL;
	PF_EffectWorld		*outputP = NULL;

	PF_Handle infoH = reinterpret_cast<PF_Handle>(extraP->input->pre_render_data);
	if (!infoH) return PF_Err_INTERNAL_STRUCT_DAMAGED;

	ChromaRenderInfo *infoP = static_cast<ChromaRenderInfo *>(PF_LOCK_HANDLE(infoH));
	if (!infoP) return PF_Err_OUT_OF_MEMORY;

	ERR(extraP->cb->checkout_layer_pixels(in_data->effect_ref, PARAM_INPUT, &inputP));
	ERR(extraP->cb->checkout_output(in_data->effect_ref, &outputP));

	if (!err && inputP && outputP) {

		ChromaIterateRefcon rc;
		AEFX_CLR_STRUCT(rc);

		rc.infoP      = infoP;
		rc.origin_x   = infoP->origin_x;
		rc.origin_y   = infoP->origin_y;
		rc.blend_mode = MapBlendMode(infoP->blend_mode);

		rc.field.count = infoP->num_points;
		rc.field.power = infoP->power;
		rc.field.blend = infoP->blend;
		for (A_long i = 0; i < infoP->num_points; ++i) {
			rc.field.points[i].dir.x  = infoP->points[i].dir.x;
			rc.field.points[i].dir.y  = infoP->points[i].dir.y;
			rc.field.points[i].dir.z  = infoP->points[i].dir.z;
			rc.field.points[i].radius = infoP->points[i].radius;
			rc.field.points[i].rgb[0] = infoP->points[i].rgb[0];
			rc.field.points[i].rgb[1] = infoP->points[i].rgb[1];
			rc.field.points[i].rgb[2] = infoP->points[i].rgb[2];
			rc.field.points[i].alpha  = infoP->points[i].alpha;
		}

		PF_LRect area = { 0, 0, outputP->width, outputP->height };

		switch (extraP->input->bitdepth) {
			case 8:
				ERR(suites.Iterate8Suite2()->iterate(
					in_data, 0, outputP->height, inputP, &area,
					&rc, ShadePixel8, outputP));
				break;
			case 16:
				ERR(suites.Iterate16Suite2()->iterate(
					in_data, 0, outputP->height, inputP, &area,
					&rc, ShadePixel16, outputP));
				break;
			case 32:
				ERR(suites.IterateFloatSuite2()->iterate(
					in_data, 0, outputP->height, inputP, &area,
					&rc, ShadePixelFloat, outputP));
				break;
			default:
				err = PF_Err_BAD_CALLBACK_PARAM;
				break;
		}
	}

	ERR2(extraP->cb->checkin_layer_pixels(in_data->effect_ref, PARAM_INPUT));
	PF_UNLOCK_HANDLE(infoH);

	return err;
}

/* ------------------------------------------------------------------ */
/*  Entry points                                                       */
/* ------------------------------------------------------------------ */

extern "C" DllExport PF_Err PluginDataEntryFunction2(
	PF_PluginDataPtr		inPtr,
	PF_PluginDataCB2		inPluginDataCallBackPtr,
	SPBasicSuite			*inSPBasicSuitePtr,
	const char				*inHostName,
	const char				*inHostVersion)
{
	PF_Err result = PF_Err_INVALID_CALLBACK;

	result = PF_REGISTER_EFFECT_EXT2(
		inPtr,
		inPluginDataCallBackPtr,
		"VR Color Gradients 3D",			/* name							*/
		"CHRM VR Color Gradients 3D",		/* match name					*/
		"Immersive Video",					/* category						*/
		AE_RESERVED_INFO,					/* reserved info				*/
		"EffectMain",						/* entry point					*/
		"");								/* support URL					*/

	return result;
}

PF_Err EffectMain(
	PF_Cmd			cmd,
	PF_InData		*in_data,
	PF_OutData		*out_data,
	PF_ParamDef		*params[],
	PF_LayerDef		*output,
	void			*extra)
{
	PF_Err err = PF_Err_NONE;

	try {
		switch (cmd) {
			case PF_Cmd_ABOUT:
				err = About(in_data, out_data, params, output);
				break;
			case PF_Cmd_GLOBAL_SETUP:
				err = GlobalSetup(in_data, out_data, params, output);
				break;
			case PF_Cmd_PARAMS_SETUP:
				err = ParamsSetup(in_data, out_data, params, output);
				break;
			case PF_Cmd_USER_CHANGED_PARAM:
				err = UserChangedParam(in_data, out_data, params,
					reinterpret_cast<const PF_UserChangedParamExtra *>(extra));
				break;
			case PF_Cmd_UPDATE_PARAMS_UI:
				err = UpdateParameterUI(in_data, out_data, params, output);
				break;
			case PF_Cmd_SMART_PRE_RENDER:
				err = PreRender(in_data, out_data,
					reinterpret_cast<PF_PreRenderExtra *>(extra));
				break;
			case PF_Cmd_SMART_RENDER:
				err = SmartRender(in_data, out_data,
					reinterpret_cast<PF_SmartRenderExtra *>(extra));
				break;
			default:
				break;
		}
	} catch (PF_Err &thrown_err) {
		err = thrown_err;
	} catch (...) {
		err = PF_Err_INTERNAL_STRUCT_DAMAGED;
	}

	return err;
}
