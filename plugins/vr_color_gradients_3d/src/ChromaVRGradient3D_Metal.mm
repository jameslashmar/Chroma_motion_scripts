/*
	ChromaVRGradient3D_Metal.mm

	Metal build of the kernel (macOS). The kernel text is compiled by the
	Metal framework at GPU device setup, from source, so the build needs no
	shader step and the same .plugin runs on Apple Silicon and Intel.

	Objective-C++ without ARC, like the SDK sample: the pipeline state is
	retained in a plain struct and released at teardown, and every call that
	touches Metal sits inside an @autoreleasepool because plug-ins must not
	lean on the host having one open.
*/

#if defined(CHROMA_HAS_METAL)

#include "ChromaVRGradient3D_GPU.h"

#import <Metal/Metal.h>
#import <Foundation/Foundation.h>

namespace {

struct MetalState {
	id<MTLComputePipelineState>	pipeline = nil;
};

}	/* namespace */

void* ChromaMetal_Setup(void* mtl_device, const std::string& source, std::string* log) {
	@autoreleasepool {
		id<MTLDevice> device = (id<MTLDevice>)mtl_device;
		if (!device) return nullptr;

		NSString* text = [[[NSString alloc] initWithBytes:source.data()
												   length:source.size()
												 encoding:NSUTF8StringEncoding] autorelease];
		if (!text) {
			if (log) *log = "kernel source is not valid UTF-8";
			return nullptr;
		}

		/*	Precise maths: the kernel's isfinite() guards and pow() must
			behave, and its results are checked against the CPU path.
			setMathMode: arrived with the macOS 15 SDK; fastMathEnabled is
			the older spelling of the same switch.						*/
		MTLCompileOptions* options = [[[MTLCompileOptions alloc] init] autorelease];
		if (@available(macOS 15.0, *)) {
			options.mathMode = MTLMathModeSafe;
		} else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
			options.fastMathEnabled = NO;
#pragma clang diagnostic pop
		}

		NSError* error = nil;
		id<MTLLibrary> library = [[device newLibraryWithSource:text options:options error:&error] autorelease];
		if (!library) {
			if (log) {
				*log = "Metal compile failed: ";
				*log += error ? [[error localizedDescription] UTF8String] : "(no description)";
			}
			return nullptr;
		}

		id<MTLFunction> function = [[library newFunctionWithName:@"ChromaVRGradient3DKernel"] autorelease];
		if (!function) {
			if (log) *log = "ChromaVRGradient3DKernel not found in the compiled Metal library";
			return nullptr;
		}

		error = nil;
		id<MTLComputePipelineState> pipeline = [device newComputePipelineStateWithFunction:function error:&error];
		if (!pipeline) {
			if (log) {
				*log = "Metal pipeline state failed: ";
				*log += error ? [[error localizedDescription] UTF8String] : "(no description)";
			}
			return nullptr;
		}

		MetalState* state = new MetalState;
		state->pipeline = pipeline;		/* +1 from newComputePipelineState..., released in Teardown */
		return state;
	}
}

bool ChromaMetal_Render(void* handle, void* mtl_device, void* mtl_queue, void* src_buffer, void* dst_buffer,
						const chromagpu::ChromaGPUParams* params)
{
	MetalState* state = static_cast<MetalState*>(handle);
	if (!state || !state->pipeline || !params) return false;
	(void)mtl_device;

	@autoreleasepool {
		id<MTLCommandQueue> queue = (id<MTLCommandQueue>)mtl_queue;
		id<MTLBuffer>       src   = (id<MTLBuffer>)src_buffer;
		id<MTLBuffer>       dst   = (id<MTLBuffer>)dst_buffer;
		if (!queue || !src || !dst) return false;

		id<MTLCommandBuffer>         commands = [queue commandBuffer];
		id<MTLComputeCommandEncoder> encoder  = [commands computeCommandEncoder];
		if (!commands || !encoder) return false;

		[encoder setComputePipelineState:state->pipeline];
		[encoder setBuffer:src offset:0 atIndex:0];
		[encoder setBuffer:dst offset:0 atIndex:1];
		[encoder setBytes:params length:sizeof(*params) atIndex:2];

		/*	The kernel bounds-checks, so round the grid up rather than rely
			on non-uniform threadgroups, which older Intel GPUs lack.	*/
		const NSUInteger w = [state->pipeline threadExecutionWidth];
		NSUInteger h = [state->pipeline maxTotalThreadsPerThreadgroup] / w;
		if (h > 16) h = 16;
		if (h < 1)  h = 1;

		const MTLSize threads = MTLSizeMake(w, h, 1);
		const MTLSize groups  = MTLSizeMake(
			(static_cast<NSUInteger>(params->i1.x) + w - 1) / w,
			(static_cast<NSUInteger>(params->i1.y) + h - 1) / h, 1);

		[encoder dispatchThreadgroups:groups threadsPerThreadgroup:threads];
		[encoder endEncoding];
		[commands commit];

		/*	Commands on AE's queue run in order, so whatever AE does with the
			output next sees this result without a wait here - the SDK sample
			does the same. An error at this point is a submission error.	*/
		return [commands error] == nil;
	}
}

void ChromaMetal_Teardown(void* handle) {
	MetalState* state = static_cast<MetalState*>(handle);
	if (!state) return;
	@autoreleasepool {
		[state->pipeline release];
		state->pipeline = nil;
	}
	delete state;
}

#endif	/* CHROMA_HAS_METAL */
