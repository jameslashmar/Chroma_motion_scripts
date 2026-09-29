/*
	ChromaVRGradient3D_GPU.h

	Host side of the GPU render path: the language preludes that turn
	ChromaVRGradient3D_Kernel.h into CUDA, OpenCL C or Metal, the same kernel
	compiled here as plain C++ so the host owns the parameter block (and the
	tests can run it), and the interface each GPU framework module exposes to
	the plug-in.

	Which frameworks exist is decided at build time:

	  CHROMA_HAS_CUDA     Windows, when the build finds a CUDA toolkit. The
	                      kernel is compiled by nvcc into the .aex.
	  CHROMA_HAS_OPENCL   Windows, always. OpenCL.dll is loaded at run time,
	                      so a machine without it still loads the effect.
	  CHROMA_HAS_METAL    macOS, always.

	None of them is required. PF_Cmd_GPU_DEVICE_SETUP only claims GPU
	support for a framework that was built in and whose kernel compiled on
	the device in front of it; anything else renders on the CPU, silently.
*/

#pragma once
#ifndef CHROMA_VR_GRADIENT_3D_GPU_H
#define CHROMA_VR_GRADIENT_3D_GPU_H

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>

/* ------------------------------------------------------------------ */
/*  The kernel, compiled as C++                                        */
/* ------------------------------------------------------------------ */

/*	Gives the host chromagpu::ChromaGPUParams - the one true layout of the
	parameter block - and chromagpu::ch_shade, the kernel itself, for the
	tests. The device compilers see float4/int4 as their own vector types;
	here they are 16-byte structs with the same members, which is all the
	kernel ever touches.												*/
namespace chromagpu {

struct alignas(16) float4 { float x, y, z, w; };
struct alignas(16) int4   { int   x, y, z, w; };

static inline float4 ch_make_float4(float a, float b, float c, float d) {
	float4 v = { a, b, c, d };
	return v;
}

#define CH_INLINE		static inline
#define CH_PARAMS_PTR	const ChromaGPUParams*
#define CH_F4			ch_make_float4
#define CH_SQRT(x)		std::sqrt((float)(x))
#define CH_POW(x, y)	std::pow((float)(x), (float)(y))
#define CH_SIN(x)		std::sin((float)(x))
#define CH_COS(x)		std::cos((float)(x))
#define CH_FABS(x)		std::fabs((float)(x))
#define CH_FMIN(x, y)	std::fmin((float)(x), (float)(y))
#define CH_FMAX(x, y)	std::fmax((float)(x), (float)(y))
#define CH_ISFINITE(x)	std::isfinite((float)(x))

#include "ChromaVRGradient3D_Kernel.h"

#undef CH_INLINE
#undef CH_PARAMS_PTR
#undef CH_F4
#undef CH_SQRT
#undef CH_POW
#undef CH_SIN
#undef CH_COS
#undef CH_FABS
#undef CH_FMIN
#undef CH_FMAX
#undef CH_ISFINITE

static_assert(sizeof(float4) == 16 && sizeof(int4) == 16, "vector types must be 16 bytes");
static_assert(sizeof(ChromaGPUParams) == 336, "ChromaGPUParams layout drifted from the device side");
static_assert(offsetof(ChromaGPUParams, color) == 128, "ChromaGPUParams layout drifted");
static_assert(offsetof(ChromaGPUParams, i2)    == 320, "ChromaGPUParams layout drifted");

}	/* namespace chromagpu */

/* ------------------------------------------------------------------ */
/*  Preludes for the device compilers                                  */
/* ------------------------------------------------------------------ */

/*	Prepended to the kernel text before it goes to the OpenCL or Metal
	compiler. The CUDA prelude lives in ChromaVRGradient3D_Kernel.cu, where
	nvcc sees it directly. Each one also appends the kernel entry point,
	because that is the one part whose syntax really is per language.	*/

static const char kChromaOpenCLPrelude[] =
	"#define CH_INLINE      inline\n"
	"#define CH_PARAMS_PTR  const ChromaGPUParams*\n"
	"#define CH_F4(a,b,c,d) ((float4)((a),(b),(c),(d)))\n"
	"#define CH_SQRT        sqrt\n"
	"#define CH_POW         pow\n"
	"#define CH_SIN         sin\n"
	"#define CH_COS         cos\n"
	"#define CH_FABS        fabs\n"
	"#define CH_FMIN        fmin\n"
	"#define CH_FMAX        fmax\n"
	"#define CH_ISFINITE    isfinite\n"
	"#line 1 \"ChromaVRGradient3D_Kernel.h\"\n";

static const char kChromaOpenCLEntry[] =
	"\n"
	"__kernel void ChromaVRGradient3DKernel(\n"
	"    __global const float4* src,\n"
	"    __global float4*       dst,\n"
	"    const ChromaGPUParams  P)\n"
	"{\n"
	"    int x = (int)get_global_id(0);\n"
	"    int y = (int)get_global_id(1);\n"
	"    if (x >= P.i1.x || y >= P.i1.y) return;\n"
	"    float4 s = (x < P.i2.z && y < P.i2.w) ? src[y * P.i1.z + x] : (float4)(0.0f, 0.0f, 0.0f, 0.0f);\n"
	"    dst[y * P.i1.w + x] = ch_shade(&P, x, y, s);\n"
	"}\n";

static const char kChromaMetalPrelude[] =
	"#include <metal_stdlib>\n"
	"using namespace metal;\n"
	"#define CH_INLINE      static inline\n"
	"#define CH_PARAMS_PTR  constant ChromaGPUParams*\n"
	"#define CH_F4(a,b,c,d) float4((a),(b),(c),(d))\n"
	"#define CH_SQRT        sqrt\n"
	"#define CH_POW         pow\n"
	"#define CH_SIN         sin\n"
	"#define CH_COS         cos\n"
	"#define CH_FABS        fabs\n"
	"#define CH_FMIN        fmin\n"
	"#define CH_FMAX        fmax\n"
	"#define CH_ISFINITE    isfinite\n"
	"#line 1 \"ChromaVRGradient3D_Kernel.h\"\n";

static const char kChromaMetalEntry[] =
	"\n"
	"kernel void ChromaVRGradient3DKernel(\n"
	"    const device float4*       src [[buffer(0)]],\n"
	"    device float4*             dst [[buffer(1)]],\n"
	"    constant ChromaGPUParams&  P   [[buffer(2)]],\n"
	"    uint2                      gid [[thread_position_in_grid]])\n"
	"{\n"
	"    int x = (int)gid.x;\n"
	"    int y = (int)gid.y;\n"
	"    if (x >= P.i1.x || y >= P.i1.y) return;\n"
	"    float4 s = (x < P.i2.z && y < P.i2.w) ? src[y * P.i1.z + x] : float4(0.0f, 0.0f, 0.0f, 0.0f);\n"
	"    dst[y * P.i1.w + x] = ch_shade(&P, x, y, s);\n"
	"}\n";

/*	Assemble prelude + kernel body + entry point. `body` is the text of
	ChromaVRGradient3D_Kernel.h, which the build embeds as
	kChromaKernelBody (see ChromaVRGradient3D_KernelSource.h, generated).	*/
inline std::string ChromaAssembleKernelSource(const char* prelude, const char* body, const char* entry) {
	std::string s;
	s.reserve(std::strlen(prelude) + std::strlen(body) + std::strlen(entry) + 16);
	s += prelude;
	s += body;
	s += entry;
	return s;
}

/* ------------------------------------------------------------------ */
/*  Framework modules                                                  */
/* ------------------------------------------------------------------ */

/*	Every module has the same three calls. Setup compiles the kernel for one
	device and returns an opaque handle, or NULL with the compiler's words in
	`log`; Render runs one frame; Teardown frees the handle. The host
	pointers (context, device, queue, buffers) are whatever After Effects
	hands over in PF_GPUDeviceInfo and GetGPUWorldData for that framework.	*/

#if defined(CHROMA_HAS_OPENCL)
void* ChromaOpenCL_Setup(void* cl_context, void* cl_device, const std::string& source, std::string* log);
bool  ChromaOpenCL_Render(void* handle, void* cl_queue, void* src_mem, void* dst_mem,
						  const chromagpu::ChromaGPUParams* params);
void  ChromaOpenCL_Teardown(void* handle);
#endif

#if defined(CHROMA_HAS_METAL)
void* ChromaMetal_Setup(void* mtl_device, const std::string& source, std::string* log);
bool  ChromaMetal_Render(void* handle, void* mtl_device, void* mtl_queue, void* src_buffer, void* dst_buffer,
						 const chromagpu::ChromaGPUParams* params);
void  ChromaMetal_Teardown(void* handle);
#endif

#if defined(CHROMA_HAS_CUDA)
extern "C" int ChromaCUDA_Render(const void* src_mem, void* dst_mem, const void* params, size_t params_size);
#endif

#endif	/* CHROMA_VR_GRADIENT_3D_GPU_H */
