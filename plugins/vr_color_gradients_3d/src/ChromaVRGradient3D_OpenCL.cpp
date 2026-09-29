/*
	ChromaVRGradient3D_OpenCL.cpp

	OpenCL build of the kernel (Windows). The driver compiles the kernel
	text at GPU device setup, so no OpenCL SDK is needed to build this - and
	OpenCL.dll is loaded at run time rather than linked, so a machine without
	it still loads the effect and simply renders on the CPU.

	The handful of OpenCL entry points used are declared here by hand. Their
	ABI has been frozen since OpenCL 1.0, which is what makes this safe.

	After Effects only offers OpenCL on Windows for non-NVIDIA GPUs (its GPU
	sniffer skips NVIDIA's OpenCL devices in favour of CUDA), so on this
	platform the OpenCL path is the AMD and Intel path.
*/

#if defined(CHROMA_HAS_OPENCL)

#include "ChromaVRGradient3D_GPU.h"

#include <cstring>
#include <mutex>
#include <vector>

#if defined(_WIN32)
	#define WIN32_LEAN_AND_MEAN
	#include <windows.h>
	#define CH_CL_API __stdcall
#else
	#include <dlfcn.h>
	#define CH_CL_API
#endif

/* ------------------------------------------------------------------ */
/*  Just enough of OpenCL                                              */
/* ------------------------------------------------------------------ */

namespace {

typedef int32_t		cl_int;
typedef uint32_t	cl_uint;
typedef uint64_t	cl_bitfield;
typedef cl_bitfield	cl_mem_flags;
typedef cl_uint		cl_program_build_info;
typedef cl_uint		cl_platform_info;
typedef cl_uint		cl_device_type;
typedef cl_uint		cl_device_info;
typedef cl_bitfield	cl_command_queue_properties;
typedef intptr_t	cl_context_properties;

typedef struct _cl_platform_id*		cl_platform_id;
typedef struct _cl_device_id*		cl_device_id;
typedef struct _cl_context*			cl_context;
typedef struct _cl_command_queue*	cl_command_queue;
typedef struct _cl_mem*				cl_mem;
typedef struct _cl_program*			cl_program;
typedef struct _cl_kernel*			cl_kernel;
typedef struct _cl_event*			cl_event;

const cl_int				CL_SUCCESS				= 0;
const cl_program_build_info	CL_PROGRAM_BUILD_LOG	= 0x1183;

typedef cl_program			(CH_CL_API *PFN_clCreateProgramWithSource)(cl_context, cl_uint, const char**, const size_t*, cl_int*);
typedef cl_int				(CH_CL_API *PFN_clBuildProgram)(cl_program, cl_uint, const cl_device_id*, const char*, void (CH_CL_API *)(cl_program, void*), void*);
typedef cl_int				(CH_CL_API *PFN_clGetProgramBuildInfo)(cl_program, cl_device_id, cl_program_build_info, size_t, void*, size_t*);
typedef cl_kernel			(CH_CL_API *PFN_clCreateKernel)(cl_program, const char*, cl_int*);
typedef cl_int				(CH_CL_API *PFN_clSetKernelArg)(cl_kernel, cl_uint, size_t, const void*);
typedef cl_int				(CH_CL_API *PFN_clEnqueueNDRangeKernel)(cl_command_queue, cl_kernel, cl_uint, const size_t*, const size_t*, const size_t*, cl_uint, const cl_event*, cl_event*);
typedef cl_int				(CH_CL_API *PFN_clReleaseKernel)(cl_kernel);
typedef cl_int				(CH_CL_API *PFN_clReleaseProgram)(cl_program);

struct OpenCLApi {
	bool									loaded = false;
	bool									tried  = false;
	PFN_clCreateProgramWithSource			clCreateProgramWithSource = nullptr;
	PFN_clBuildProgram						clBuildProgram = nullptr;
	PFN_clGetProgramBuildInfo				clGetProgramBuildInfo = nullptr;
	PFN_clCreateKernel						clCreateKernel = nullptr;
	PFN_clSetKernelArg						clSetKernelArg = nullptr;
	PFN_clEnqueueNDRangeKernel				clEnqueueNDRangeKernel = nullptr;
	PFN_clReleaseKernel						clReleaseKernel = nullptr;
	PFN_clReleaseProgram					clReleaseProgram = nullptr;
};

static OpenCLApi	gCL;
static std::mutex	gCLMutex;

template <typename T>
static bool Resolve(void* lib, const char* name, T* out) {
#if defined(_WIN32)
	*out = reinterpret_cast<T>(GetProcAddress(static_cast<HMODULE>(lib), name));
#else
	*out = reinterpret_cast<T>(dlsym(lib, name));
#endif
	return *out != nullptr;
}

/*	Load OpenCL.dll once. Leaving it loaded for the life of the process is
	deliberate: After Effects has the same library open already, and the
	kernels we hand back live in it.									*/
static bool LoadOpenCL() {
	std::lock_guard<std::mutex> lock(gCLMutex);
	if (gCL.tried) return gCL.loaded;
	gCL.tried = true;

#if defined(_WIN32)
	void* lib = LoadLibraryA("OpenCL.dll");
#else
	void* lib = dlopen("/System/Library/Frameworks/OpenCL.framework/OpenCL", RTLD_NOW);
#endif
	if (!lib) return false;

	bool ok = true;
	ok = ok && Resolve(lib, "clCreateProgramWithSource",	&gCL.clCreateProgramWithSource);
	ok = ok && Resolve(lib, "clBuildProgram",				&gCL.clBuildProgram);
	ok = ok && Resolve(lib, "clGetProgramBuildInfo",		&gCL.clGetProgramBuildInfo);
	ok = ok && Resolve(lib, "clCreateKernel",				&gCL.clCreateKernel);
	ok = ok && Resolve(lib, "clSetKernelArg",				&gCL.clSetKernelArg);
	ok = ok && Resolve(lib, "clEnqueueNDRangeKernel",		&gCL.clEnqueueNDRangeKernel);
	ok = ok && Resolve(lib, "clReleaseKernel",				&gCL.clReleaseKernel);
	ok = ok && Resolve(lib, "clReleaseProgram",				&gCL.clReleaseProgram);

	gCL.loaded = ok;
	return ok;
}

struct OpenCLState {
	cl_program	program = nullptr;
	cl_kernel	kernel  = nullptr;
};

}	/* namespace */

/* ------------------------------------------------------------------ */
/*  Module interface                                                   */
/* ------------------------------------------------------------------ */

void* ChromaOpenCL_Setup(void* cl_context_p, void* cl_device_p, const std::string& source, std::string* log) {
	if (!LoadOpenCL()) {
		if (log) *log = "OpenCL.dll could not be loaded";
		return nullptr;
	}

	cl_context   context = static_cast<cl_context>(cl_context_p);
	cl_device_id device  = static_cast<cl_device_id>(cl_device_p);
	if (!context || !device) return nullptr;

	const char*  text = source.c_str();
	const size_t len  = source.size();
	cl_int       result = CL_SUCCESS;

	cl_program program = gCL.clCreateProgramWithSource(context, 1, &text, &len, &result);
	if (!program || result != CL_SUCCESS) {
		if (log) *log = "clCreateProgramWithSource failed";
		return nullptr;
	}

	/*	No -cl-fast-relaxed-math: the kernel's isfinite() guards and its
		pow() need the real thing, and the CPU path is the yardstick.	*/
	result = gCL.clBuildProgram(program, 1, &device, "-cl-single-precision-constant", nullptr, nullptr);
	if (result != CL_SUCCESS) {
		if (log) {
			size_t n = 0;
			gCL.clGetProgramBuildInfo(program, device, CL_PROGRAM_BUILD_LOG, 0, nullptr, &n);
			std::vector<char> buf(n + 1, 0);
			if (n) gCL.clGetProgramBuildInfo(program, device, CL_PROGRAM_BUILD_LOG, n, buf.data(), nullptr);
			*log = "clBuildProgram failed:\n";
			*log += buf.data();
		}
		gCL.clReleaseProgram(program);
		return nullptr;
	}

	cl_kernel kernel = gCL.clCreateKernel(program, "ChromaVRGradient3DKernel", &result);
	if (!kernel || result != CL_SUCCESS) {
		if (log) *log = "clCreateKernel failed";
		gCL.clReleaseProgram(program);
		return nullptr;
	}

	OpenCLState* state = new OpenCLState;
	state->program = program;
	state->kernel  = kernel;
	return state;
}

bool ChromaOpenCL_Render(void* handle, void* cl_queue_p, void* src_mem, void* dst_mem,
						 const chromagpu::ChromaGPUParams* params)
{
	OpenCLState* state = static_cast<OpenCLState*>(handle);
	if (!state || !gCL.loaded || !params) return false;

	cl_command_queue queue = static_cast<cl_command_queue>(cl_queue_p);
	cl_mem src = static_cast<cl_mem>(src_mem);
	cl_mem dst = static_cast<cl_mem>(dst_mem);

	/*	One instance per device, and AE serialises renders on a device, but
		clSetKernelArg mutates the kernel object, so keep it under a lock
		against the day that stops being true.							*/
	std::lock_guard<std::mutex> lock(gCLMutex);

	cl_int result = CL_SUCCESS;
	result |= gCL.clSetKernelArg(state->kernel, 0, sizeof(cl_mem), &src);
	result |= gCL.clSetKernelArg(state->kernel, 1, sizeof(cl_mem), &dst);
	result |= gCL.clSetKernelArg(state->kernel, 2, sizeof(*params), params);
	if (result != CL_SUCCESS) return false;

	const size_t local[2]  = { 16, 16 };
	const size_t global[2] = {
		((static_cast<size_t>(params->i1.x) + 15) / 16) * 16,
		((static_cast<size_t>(params->i1.y) + 15) / 16) * 16
	};

	result = gCL.clEnqueueNDRangeKernel(queue, state->kernel, 2, nullptr, global, local, 0, nullptr, nullptr);
	return result == CL_SUCCESS;
}

void ChromaOpenCL_Teardown(void* handle) {
	OpenCLState* state = static_cast<OpenCLState*>(handle);
	if (!state) return;
	if (gCL.loaded) {
		if (state->kernel)  gCL.clReleaseKernel(state->kernel);
		if (state->program) gCL.clReleaseProgram(state->program);
	}
	delete state;
}

#endif	/* CHROMA_HAS_OPENCL */
