# VR Color Gradients 3D

An After Effects effect plug-in: an equirectangular (360 / VR) multi-point
colour gradient in the spirit of Adobe's own **VR Color Gradients**, with one
addition — every gradient point carries a **Z axis**, so the points sit in 3D
space rather than being pinned to the surface of the sphere.

- Effect name: **VR Color Gradients 3D**
- Category: **Immersive Video** (sits next to the stock VR effects)
- Match name: `CHRM VR Color Gradients 3D`
- Windows x64, After Effects 2026

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
| **Point 1–8 / Color 1–8** | The gradient points. |
| **Opacity** | Mix of the result against the original layer. |
| **Blending Mode** | None (replace) plus the standard separable and non-separable modes. |

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

## Installing

**`ChromaVRGradient3D.aex` in this folder is the built plug-in.** Copy it into
After Effects and restart:

```
Windows   C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Plug-ins\Effects\
```

It then appears under **Effect → Immersive Video**, alongside After Effects' own VR effects. Plug-ins put there survive After
Effects updates. Needs administrator rights on Windows.

Windows x64 only. The source carries the Mac entry points in its PiPL and has
no Windows-specific rendering code, but there is no Mac build here — that needs
Xcode and someone to test it.

## Building it yourself

Only necessary if you are changing it. The source is in [`src/`](src/), and
needs the After Effects SDK and MSVC with the C++ workload.

```powershell
cd src
.\build.ps1                 # build to ..\ChromaVRGradient3D.aex
.\build.ps1 -Install        # build, then copy into After Effects (elevates)
.\build.ps1 -Clean          # wipe intermediates first
```

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

## Verified in After Effects

Checked in AE 2026 (26.0x67) by driving it with a startup script and comparing
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

**Render path.** CPU Smart Render, 8 / 16 / 32-bit, float-aware and
thread-safe, using AE's iterate suites. Adobe's own VR effects are GPU-only;
this one has no such requirement and will render with GPU acceleration off.
Colour params are read through `PF_GetFloatingPointColorFromColorDef` so they
arrive already converted into the project's working space.
