/*
	ChromaVRGradient3D_Kernel.cu

	CUDA build of the kernel. nvcc compiles this into an object the plug-in
	links, so CUDA needs no compile step at run time - unlike OpenCL and
	Metal, whose kernels are compiled by the driver at GPU device setup.

	The kernel body is ChromaVRGradient3D_Kernel.h; this file is only the
	CUDA prelude, the __global__ wrapper and a host-callable launcher.
*/

#include <cuda_runtime.h>
#include <math.h>

#define CH_INLINE		static __device__ __forceinline__
#define CH_PARAMS_PTR	const ChromaGPUParams*
#define CH_F4			make_float4
#define CH_SQRT			sqrtf
#define CH_POW			powf
#define CH_SIN			sinf
#define CH_COS			cosf
#define CH_FABS			fabsf
#define CH_FMIN			fminf
#define CH_FMAX			fmaxf
#define CH_ISFINITE		isfinite

#include "ChromaVRGradient3D_Kernel.h"

__global__ void ChromaVRGradient3DKernel(
	const float4* __restrict__	src,
	float4* __restrict__		dst,
	const ChromaGPUParams		P)
{
	const int x = blockIdx.x * blockDim.x + threadIdx.x;
	const int y = blockIdx.y * blockDim.y + threadIdx.y;
	if (x >= P.i1.x || y >= P.i1.y) return;

	const float4 s = (x < P.i2.z && y < P.i2.w) ? src[y * P.i1.z + x]
												 : make_float4(0.0f, 0.0f, 0.0f, 0.0f);
	dst[y * P.i1.w + x] = ch_shade(&P, x, y, s);
}

/*	Launch one frame. After Effects has its CUDA context current on this
	thread for the whole of PF_Cmd_SMART_RENDER_GPU (the runtime API picks
	that up), so the launch lands on the device AE is rendering with - which
	matters on a two-GPU machine. Synchronous, as the SDK sample is: AE reads
	the output buffer as soon as we return.

	Returns 1 on success, 0 on any CUDA error.							*/
extern "C" int ChromaCUDA_Render(
	const void*	src_mem,
	void*		dst_mem,
	const void*	params,
	size_t		params_size)
{
	if (params_size != sizeof(ChromaGPUParams)) return 0;

	const ChromaGPUParams* P = static_cast<const ChromaGPUParams*>(params);

	const dim3 block(16, 16, 1);
	const dim3 grid((P->i1.x + block.x - 1) / block.x,
					(P->i1.y + block.y - 1) / block.y, 1);

	ChromaVRGradient3DKernel<<<grid, block>>>(
		static_cast<const float4*>(src_mem), static_cast<float4*>(dst_mem), *P);

	if (cudaPeekAtLastError() != cudaSuccess) return 0;
	if (cudaDeviceSynchronize() != cudaSuccess) return 0;
	return 1;
}
