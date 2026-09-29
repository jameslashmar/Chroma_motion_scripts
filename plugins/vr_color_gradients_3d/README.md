# VR Color Gradients 3D

An After Effects effect plug-in: an equirectangular (360 / VR) multi-point
colour gradient in the spirit of Adobe's own **VR Color Gradients**, with one
addition — every gradient point carries a **Z axis**, so the points sit in 3D
space rather than being pinned to the surface of the sphere.

- Effect name: **VR Color Gradients 3D**
- Category: **Immersive Video** (sits next to the stock VR effects)
- Match name: `CHRM VR Color Gradients 3D`
- Version **1.3** — Windows x64 and macOS (universal), After Effects 2026.
  Renders on the CPU everywhere and on the GPU where it can: **CUDA** and
  **OpenCL** on Windows, **Metal** on macOS.

This is an independent implementation of the standard maths — equirectangular
projection plus inverse-distance-weighted colour interpolation. No Adobe code
is reproduced. The parameter list was modelled on the stock effect's so the
two feel the same to use.

---

## What the Z axis does

A gradient point is a position, not just a direction:

```
P = radius * direction
```

For a pixel looking along unit direction `d`, the falloff uses the true 3D
distance from the point to where that pixel meets the unit sphere:

```
|P - d|^2  =  radius^2 + 1 - 2 * radius * (direction . d)
```

At `radius == 1` this collapses to the chord distance `2*sin(theta/2)` — a
pure angular falloff, i.e. exactly how a point confined to the sphere behaves.
**That is why Z = 0 is the neutral value**: the Z axis only ever adds to the
flat behaviour, it never changes an existing look out from under you.

| Z | radius | Result |
|---|--------|--------|
| `0` | `1.0` | Identical to a flat sphere-surface gradient |
| negative | `< 1` | Point pulled toward the viewer — its colour **blooms wide** across the sphere |
| positive | `> 1` | Point pushed away — its colour **tightens into a hotspot** |

Pulling a point right in toward the viewer equalises its distance to every
direction at once, which is what makes the colour flood outward.

---

## Parameters

| Parameter | Notes |
|---|---|
| **Frame Layout** | Monoscopic, Stereoscopic Over/Under, Stereoscopic Side-by-Side. Points are authored against the first eye and applied to both. |
| **Horizontal Field of View** | Degrees, default 360. |
| **Vertical Field of View** | Degrees, default 180. |
| **Point Space** | How each point's X/Y/Z is read — see below. |
| **Depth Scale** | Pixels per one unit of sphere radius, default 500. The conversion between the Z figure you type and the radius in the maths. |
| **Points Number** | 1–8. Point rows above this are greyed out. |
| **Gradient Power** | Inverse-distance exponent. Higher = colour stays tighter to its own point. Default 2. |
| **Gradient Blend** | 100 % = smooth inverse-distance mix. 0 % = hard Voronoi cells (each pixel takes its nearest point's flat colour). |
| **Create Nulls from Points** | Button. Gives every live point its own 3D null and links it. See below. |
| **Point 1–8 / Color 1–8** | The gradient points. |
| **Alpha 1–8** | Per-point opacity, 0–100 %, keyframeable. AE's colour picker has no alpha channel, so each Color has its own slider directly beneath it. See *Alpha* below. |
| **Opacity** | Mix of the result against the original layer. |
| **Blending Mode** | None (replace) plus the standard separable and non-separable modes. |
| **Alpha** | *Makes layer transparent*, on by default. See *Alpha* below. |

### Point Space

One 3D point parameter per point; this popup decides how its X/Y/Z is read.

**Equirect + Distance** (default)
- `X`, `Y` — position in the equirect frame, in pixels, exactly as the stock
  effect. Drag the point on the canvas as usual.
- `Z` — depth offset. `radius = 1 + Z / Depth Scale`.
- `Z = 0` reproduces a flat gradient, so this mode is a drop-in.

**World XYZ**
- `X`, `Y`, `Z` — Cartesian position with the viewer at the **centre of the
  frame**. Direction and radius are both derived from the vector.
- `radius = |P| / Depth Scale`, so a point at exactly `Depth Scale` away
  behaves like a sphere-surface point.
- AE's Y axis points down and is flipped internally, so expression-linking a
  point to a 3D null's `position` behaves the way you would expect — that is
  the reason this mode exists.

---

### Alpha

Each point's alpha travels through the gradient with it. Colour is mixed
**premultiplied**, so a transparent point fades the gradient out around it
without dragging its invisible colour into its neighbours — a red point next
to a 0 % blue one fades red → clear, never red → purple → clear. With every
alpha at 100 % the result is identical to the plain gradient.

What the gradient's alpha then does is set by the **Alpha** checkbox:

| Alpha — *Makes layer transparent* | Gradient alpha acts as |
|---|---|
| **On** (default) | The layer's transparency. Where a point is transparent the layer becomes see-through and whatever is below it in the comp shows. On a solid, this is almost always what you want. |
| **Off** | A fade on the effect only, like a layer style's gradient overlay: transparent points let the layer's own pixels through, and its alpha is left alone. On a white solid that means white. |

With **Blending Mode: None** the frame is replaced outright, so the gradient's
alpha becomes the layer's alpha either way.

AE's colour picker has no alpha channel and plug-ins cannot use the Layer
Styles gradient editor, so alpha is a separate keyframeable slider under each
Color rather than part of the colour.

### Create Nulls from Points

A button in the effect. Press it and every live point gets a 3D null sitting
exactly where the point already is, named after it — **Point 1**, **Point 2**
… — and linked with `toWorld`, so nothing moves. All of them are parented to
one null, **VR Color Gradients 3D Points MASTER**; move that to carry the lot.

It is a sync, not a one-shot, so press it again whenever:

- you raise **Points Number** — only the new points get nulls;
- you delete a null — that one is rebuilt where its point is.

Names you give the nulls yourself are kept. A point already driven by an
expression of your own is left alone. If a comp holds two gradient layers, the
second one's nulls get its layer name in front, because expressions find
layers by name.

### GPU rendering (1.3)

1.3 adds a GPU render path. The parameters, their order and their disk IDs are
unchanged from 1.2, so **projects saved with 1.2 open in 1.3 as they were**.

The effect's **About** box ends with the line *GPU: …* naming what this build
can use, e.g. `GPU: CUDA, OpenCL (CPU fallback)` on Windows.

| Platform | Frameworks | Notes |
|---|---|---|
| Windows | CUDA, OpenCL | AE's own GPU sniffer picks the framework. On an NVIDIA card with a current driver that is CUDA, and OpenCL devices are skipped. |
| macOS | Metal | Compiled from source when the GPU device is set up, with fast-math off. |

The GPU is only used when the kernel actually compiled for the framework AE is
running. Anything else — no GPU, an unsupported framework, a compile failure,
GPU acceleration switched off in the project — falls back to the CPU path,
which is unchanged from 1.2. **CPU and GPU give the same picture**: the tests
hold the kernel to the double-precision reference within a few 1e-6 across
every blend mode, stereo layout and alpha case.

### Projects saved with an older version

**1.2 and later will not open a project saved with 1.0 or 1.1 that uses this effect.**
AE refuses with *"effect control conversion required"* and then *"missing data
in file (33 :: 4)"*. Both releases inserted controls mid-list, which moved the
IDs AE uses to match saved values to controls.

To recover such a project, put the version it was saved with back, open the
project, remove the effect, save, then install 1.2 again. Earlier builds are in
this repo's history — 1.0 is `ChromaVRGradient3D.aex` / `.plugin` at commit
`a9f44c1`, 1.1 at `5b6b240`. From Git Bash or `cmd` — Windows PowerShell 5's
`>` re-encodes output and corrupts a binary:

```
git show a9f44c1:plugins/vr_color_gradients_3d/ChromaVRGradient3D.aex > ChromaVRGradient3D.aex
```

From 1.2 on the IDs are frozen, and the build refuses to compile if one moves,
so projects saved with 1.2 will keep opening in later versions.

## Installing

Both platforms are built and in this folder. Copy the one you need into After
Effects and restart:

```
Windows   ChromaVRGradient3D.aex      -> C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Plug-ins\Effects\
macOS     ChromaVRGradient3D.plugin   -> /Applications/Adobe After Effects <ver>/Plug-ins/Effects/
```

It then appears under **Effect → Immersive Video**, alongside After Effects'
own VR effects. Plug-ins put there survive After Effects updates. Needs
administrator rights on both — on macOS that means `sudo cp -R`.

The macOS build is a **universal bundle**, arm64 and x86_64, and is **ad-hoc
signed**. Do not re-zip or rewrite anything inside it: the signature hashes the
file contents, and an unsigned bundle is refused on Apple Silicon *silently* —
the effect simply never appears in the menu.

## Extras

- [`examples/BuildWorldXYZDemo.jsx`](examples/BuildWorldXYZDemo.jsx) — builds a
  worked World XYZ scene: an equirect comp whose gradient points are driven by
  3D nulls, with one light keyframed past the viewer so the depth falloff is
  visible without touching anything. **File → Scripts → Run Script File**.
- [`../../aftereffects/Scripts/VRGradient3DLinkNulls.jsx`](../../aftereffects/Scripts/VRGradient3DLinkNulls.jsx)
  — the script the **Create Nulls from Points** button grew out of. The button
  is the one to use now; the script is still here for **2D** nulls (X and Y
  only, each point keeps its Z), which the button does not make. It does not
  sync: points already linked are skipped, but each run makes a new parent
  null rather than reusing the last one.

## Building it yourself

Only necessary if you are changing it. The source is in [`src/`](src/).

**Windows** — needs the After Effects SDK and MSVC with the C++ workload:

```powershell
cd src
.\build.ps1                 # build to ..\ChromaVRGradient3D.aex
.\build.ps1 -Install        # build, then copy into After Effects (elevates)
.\build.ps1 -Clean          # wipe intermediates first
```

**macOS** — needs the After Effects SDK and Xcode:

```bash
cd src
./build-mac.sh              # build to ../ChromaVRGradient3D.plugin
./build-mac.sh --install    # build, then copy into After Effects (needs sudo)
./build-mac.sh --clean      # wipe intermediates first
```

**CUDA** is optional. If `build.ps1` finds a CUDA toolkit (12.x) it builds the
CUDA kernel in as well as OpenCL; without one it builds OpenCL only, and
`-NoCuda` forces that. It prints which it did (`GPU: CUDA + OpenCL, CPU
fallback`). The toolkit needs only `nvcc`, the runtime and the Visual Studio
integration — the display driver is not touched. After switching between the
two, use `-Clean`: a stale kernel object from the other kind of build breaks the
link. The OpenCL and Metal kernels need no SDK: the one kernel source in
`ChromaVRGradient3D_Kernel.h` is embedded as text and compiled by the driver
when AE sets the GPU device up.

Same three stages either way, but macOS wants a bundle rather than a flat
`.aex`, and the PiPL goes through `Rez` instead of `PiPLtool` + `rc`. The
bundle's `CFBundlePackageType` of `eFKT` and signature `FXTC` are what mark it
as an effect; without them After Effects never looks at it. The `.r` already
carried `CodeMacIntel64` and `CodeMacARM64`, so nothing in the source needed
changing to build for the Mac.

The build writes over the committed `.aex` one level up rather than into a
`build/` folder of its own, so a rebuild updates the copy people actually
download and `git status` says when it has drifted.

The SDK, Visual Studio and After Effects are all **found at run time** —
`vswhere` for VS, a search for `PiPLtool.exe` for the SDK, the highest-numbered
install for AE — with `-SdkRoot`, `-VsRoot` and `-AeRoot` to override. They used
to be hardcoded to one workstation, which broke the first time this was built on
a second: Visual Studio was on `G:` on one machine and `H:` on the other, and
the script only said so at the point of failure.

The script drives `cl` / `PiPLtool` / `rc` / `link` directly rather than going
through MSBuild, because the PiPL resource needs a three-stage preprocess that
is far easier to follow in a script than in a `.vcxproj` CustomBuild block.

## Tests

The geometry, colour interpolation and blend modes live in
`src/ChromaGradientMath.h`, which has no After Effects types in it at all and so
can be exercised directly:

```bash
cd src/tests
g++ -std=c++17 -O2 -I.. test_math.cpp -o test_math && ./test_math
g++ -std=c++17 -O2 -I.. preview.cpp  -o preview   && ./preview
```

`test_math` asserts the properties that matter — that `radius == 1` really is
the neutral value, that the chord distance matches `2 - 2*cos(theta)`, that
pulling a point in widens its colour and pushing it out tightens it, that
extreme exponents and a point sitting on the viewer stay finite, and that the
W3C blend formulas hold.

`preview` renders equirect PPMs and checks the things a still image would show
you: that a point reproduces its own colour at its own pixel, that the left and
right edges match (no wrap seam), and that the pole rows stay consistent.

`test_kernel` holds the GPU kernel to `chroma::shadePixel`, the double-precision
reference the CPU path also uses. It runs 30 scenarios — every blend mode, both
stereo layouts, a sub-region origin, the alpha cases and degenerate radii —
first with the kernel compiled as plain C++, then through the real OpenCL
compiler on this machine's GPU. On the Mac `test_kernel_metal` does the same
through Metal. Worst difference seen is a few 1e-6, with no outliers.
`build.ps1 -Test` and `./build-mac.sh --test` build and run all of them.

## Verified in After Effects

Checked (v1.0, before Alpha was added) in AE 2026 (26.0x67) by driving it with a startup script and comparing
the rendered frames:

| Check | Result |
|---|---|
| Plug-in loads | AE's `Plugin Loading.log`: *"The plugin has a PiPL"* |
| Registers | Applies by match name; all 29 params, correct order and defaults |
| Renders correctly | Max **1/255** difference from the offline reference across 131,072 pixels |
| `Z = 0` is neutral | Setting Z back to 0 reproduces the baseline frame |
| Z pulled in / pushed out | Visibly blooms / tightens, as the maths predicts |
| Gradient Blend 0 | Hard Voronoi cells |
| 8 points | All eight distinct |
| Stereo Over/Under | Top and bottom halves **identical** (max diff 0) |
| World XYZ | Render tracks the world position |
| 3D null link | Expression-linked null renders **pixel-identically** to the literal position |

1.2 was checked by hand in AE 2026 on Windows:

| Check | Result |
|---|---|
| Alpha, *Makes layer transparent* on | Transparent points make the layer see-through |
| Create Nulls from Points | Nulls named Point 1…n under **VR Color Gradients 3D Points MASTER**; nothing moves |
| Raise Points Number, press again | Only the new points get nulls |
| 1.0 project in 1.2 | Does not open — see *Projects saved with an older version* |

1.3 (GPU) was installed and checked by hand in AE 2026 on Windows (RTX 4090,
CUDA) and on macOS (Apple M3 Max, Metal): it loads and renders correctly. The
numerical check is the test suite — see *Tests* — not a screen comparison.

Not yet checked: that half-transparent areas composite as a clean blend rather
than a lightened one, i.e. that AE reads the effect's output with the alpha
convention it is written in. An automated render test for this is still to run.

### Gotchas when verifying a plug-in by script

- **`CompItem.saveFrameToPng` is asynchronous.** It returns before the file is
  on disk. Checking `File.exists` immediately reports a false failure, and
  calling `app.quit()` straight after loses the render entirely. Poll until the
  file appears. This masquerades as "the effect did not render".
- **`AfterFX.exe -r script.jsx` runs during startup**, in a half-initialised
  context where array-valued params (points, colours) cannot be read —
  `.value` throws *"invalid numeric result (divide by zero?)"*. **Stock Adobe
  effects fail identically**, so this is not a sign of a broken plug-in. Scalar
  params read fine, and `setValue` works throughout. Verify by rendering and
  comparing frames rather than by reading values back.
- **Do not set `Pref_SCRIPTING_FILE_NETWORK_SECURITY` to 1.** It is *"restrict
  scripts"*, not *"allow"* — `0` allows. Setting it to 1 takes effect on the
  next launch and then silently blocks all script file writes, including
  `saveFrameToPng`, with `File.open("w")` simply returning `false`.
- `app.scheduleTask("fn()", ms, false)` evaluates its string in a different
  scope, so functions defined in a `-r` script are not visible to it.

---

## Notes on the implementation

**The SDK's `PF_ADD_POINT_3D` macro is broken.** In SDK 25.6,
`Param_Utils.h:291` assigns `Y_DFLT` to `z_value`/`z_dephault` instead of
`Z_DFLT`, silently ignoring the Z default you pass. Asking for `Z = 0` would
have landed every point at its Y percentage — so each point would have started
pushed out in depth and the effect would not have matched a flat gradient out
of the box. The point params are therefore added by hand rather than through
the macro.

**Buffer origin.** The gradient is anchored to layer coordinates taken from
the pre-render `result_rect`, not from `in_data->output_origin_x`. That field
is the offset of the *input buffer within the output buffer* and is documented
as non-zero only when an effect changes buffer size; using it would leave the
gradient pinned to the buffer and make it slide whenever AE rendered less than
the whole layer (region of interest, partial repaints).

**Resolution independence.** Point parameters are rescaled by AE for the
current resolution but plain sliders are not, so `Depth Scale` is multiplied by
the downsample factor before being divided into point Z values. Without that,
Half resolution would not match Full.

**No VR metadata API.** The AE effect SDK exposes nothing to query a layer's
immersive/projection properties, so the stock effect's "Auto VR Properties"
checkbox has no public equivalent. Field of view is set explicitly instead;
the defaults (360 × 180) are right for ordinary equirectangular footage.

**Parameter IDs are forever.** Each parameter's `def.uu.id` is its disk ID:
AE matches a saved project's values to controls by it. Here the IDs are the
parameter enum's values, so inserting a row renumbers everything after it —
which is exactly how 1.1 and 1.2 broke 1.0 projects. New parameters go
immediately before `PARAM_COUNT`, and `static_assert`s pin the existing values.

**A button that runs a script.** Create Nulls from Points works out its own
comp, layer and effect through the AEGP suites, then runs ExtendScript with
`AEGP_ExecuteScript`. The script defines a global function and defers the call
with `app.scheduleTask`, because the button press arrives inside the effect's
own `USER_CHANGED_PARAM` and the script writes expressions onto that same
effect. The effect is picked out by its display name, which is unique on its
layer, passed as `\uXXXX` escapes so no name can break the script. The script
is in `src/CreateNullsScript.h`.

**Render path.** Smart Render, on the GPU where possible and otherwise on the
CPU (8 / 16 / 32-bit, float-aware, thread-safe, using AE's iterate suites).
Adobe's own VR effects are GPU-only; this one has no such requirement and
renders with GPU acceleration off.

**One kernel, four compilers.** The per-pixel shading is written once, in
`ChromaGradientMath.h` as `chroma::shadePixel` for the CPU, and once in
`ChromaVRGradient3D_Kernel.h` for the GPU, in the C subset that CUDA, OpenCL C
and Metal all accept. The kernel's parameter block is nothing but `float4` and
`int4`, so its 336-byte layout is identical in all four languages without a
padding byte; the host `static_assert`s the size. `PF_Cmd_GPU_DEVICE_SETUP`
only claims support for a framework once the kernel has actually compiled for
it, and `PreRender` only asks for a GPU render on such a device, so a failure to
compile is a CPU fallback and never a broken frame.
Colour params are read through `PF_GetFloatingPointColorFromColorDef` so they
arrive already converted into the project's working space.
