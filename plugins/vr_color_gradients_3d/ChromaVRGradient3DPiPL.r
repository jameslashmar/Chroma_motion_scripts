#include "AEConfig.h"
#include "AE_EffectVers.h"

#ifndef AE_OS_WIN
	#include "AE_General.r"
#endif

resource 'PiPL' (16000) {
	{	/* array properties: 12 elements */

		/* [1] */
		Kind {
			AEEffect
		},

		/* [2] */
		Name {
			"VR Color Gradients 3D"
		},

		/* [3] */
		Category {
			"Immersive Video"
		},

#ifdef AE_OS_WIN
	#if defined(AE_PROC_INTELx64)
		CodeWin64X86 {"EffectMain"},
	#elif defined(AE_PROC_ARM64)
		CodeWinARM64 {"EffectMain"},
	#endif
#elif defined(AE_OS_MAC)
		CodeMacIntel64 {"EffectMain"},
		CodeMacARM64 {"EffectMain"},
#endif

		/* [6] */
		AE_PiPL_Version {
			2,
			0
		},

		/* [7] */
		AE_Effect_Spec_Version {
			PF_PLUG_IN_VERSION,
			PF_PLUG_IN_SUBVERS
		},

		/* [8] */
		AE_Effect_Version {
			525825	/* 1.0.0 release, build 1 */
		},

		/* [9] */
		AE_Effect_Info_Flags {
			0
		},

		/* [10] */
		/* PF_OutFlag_PIX_INDEPENDENT | PF_OutFlag_DEEP_COLOR_AWARE |
		   PF_OutFlag_SEND_UPDATE_PARAMS_UI                                   */
		AE_Effect_Global_OutFlags {
			0x06000400
		},

		/* PF_OutFlag2_PARAM_GROUP_START_COLLAPSED_FLAG |
		   PF_OutFlag2_SUPPORTS_SMART_RENDER | PF_OutFlag2_FLOAT_COLOR_AWARE |
		   PF_OutFlag2_SUPPORTS_THREADED_RENDERING                            */
		AE_Effect_Global_OutFlags_2 {
			0x08001408
		},

		/* [11] */
		AE_Effect_Match_Name {
			"CHRM VR Color Gradients 3D"
		},

		/* [12] */
		AE_Reserved_Info {
			0
		}
	}
};
