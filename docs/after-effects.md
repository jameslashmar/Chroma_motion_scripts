# After Effects

*The panels, the scripts and the kBar buttons. Part of [Chroma Motion Scripts](../README.md).*

The `aftereffects/` tree mirrors After Effects' own layout, so installing is a straight copy of both folders. `Scripts/` holds things you run once from the File menu; `ScriptUI Panels/` holds dockable panels that live in the Window menu.

### `ScriptUI Panels/Chroma Utilities.jsx`

A dockable panel of small tools. Three so far.

<img src="images/chroma-utilities.png" alt="Chroma Utilities panel docked in After Effects: a Create Shot Folders button under Project, then Position, Rotation, Scale, PSR and All keyframes buttons under Strip keys from duplicate, parent to original, with a status line reading Shape Layer 2 → Shape Layer 1: 11 all keys removed, parented" width="621">

#### Create Shot Folders

Creates a run of numbered shot bins in the Project panel — `SHOT001` … `SHOT010` — from a prefix, zero-padding, start number, step and count.

<img src="images/create-shot-folders.png" alt="Create Shot Folders dialog, showing prefix, padding, start number, step and count fields above a live preview reading SHOT001 … SHOT010" width="344">

The step is there for edits that number in tens or twenties so there's room to insert later, and the padding is separate from the start number so `1` can render as `001` without typing leading zeros. A live preview shows the first and last name before you commit, which catches an off-by-one in the count before it becomes forty bins to delete. Optionally the whole run drops inside a parent bin, and the batch is a single undo step.

The same dialog ships standalone as `Scripts/CreateShotFolders.jsx` for File → Scripts. The panel embeds the code rather than looking for that file, so it's a single-file install with nothing to locate on disk.

#### Duplicate, strip keys, parent to original

Duplicate an animated layer, select the original and the duplicate, click a button. The duplicate loses its keyframes and is parented to the original, so it follows the original's animation rather than carrying its own copy of it. Five buttons: **Position**, **Rotation**, **Scale**, **PSR** (all three) and **All keyframes** (everything on the layer — effects, masks, text, shape contents, layer styles — but not markers, and expressions are left alone).

A sixth, **Duplicate + strip PSR**, does the whole thing from one layer: select the animated layer, click once, and it is duplicated, the copy's Position, Scale and Rotation keys come off and the copy is parented back to it — still one undo step. Nothing to duplicate by hand and nothing to select twice, which is what makes it the one worth putting on a key (see [the kBar buttons](#kbar) below). Alt-click it to strip every keyframe on the copy instead of only the transforms. The new duplicate is left selected, because the duplicate is the layer you go on to animate; several selected layers each get their own, parented to themselves rather than to each other.

The details that matter:

- **Which layer is the original.** If the names differ only by a trailing number (`Hero` / `Hero 2`, `Shape Layer 1` / `Shape Layer 2`, `SHOT_010` / `SHOT_011`) the un-numbered or lowest-numbered one is the original. Otherwise it's the lowest selected layer in the stack, because Ctrl/Cmd+D puts the copy directly above its source. Hold **Alt** (Option) while clicking to swap. The status line says which way it went.
- One original with several duplicates works — select them all.
- Each stripped property holds its value at the current time, the same as switching the stopwatch off, so the duplicate keeps whatever pose it had when you clicked.
- Parenting uses After Effects' own compensation (no jump), so the duplicate stays put on screen. After a full PSR strip its transform ends up relative to the original, which is the point.
- Position covers separated X/Y/Z too; Rotation covers X/Y/Z and Orientation on 3D layers.
- Every click is one undo step.

#### Transfer expressions

Copies expressions from one layer to others: the expressions only, never keyframes or values. Click the source layer, Ctrl/Cmd-click each target, then click **Transfer**. One source can go to any number of targets in a single click.

- **Whole layer or one property.** With only layers selected, every expression on the source is copied: transform, effects, masks, shape contents, text animators. Select a property on the source first (Position, say, or a whole effect or shape group) and only the expressions it covers are copied.
- **Which layer is the source.** Whichever selected layer has expressions to give. If more than one does, as when re-running after an earlier transfer, it's the one you clicked first, since After Effects reports layers in the order they were selected. Hold **Alt** (Option) to use the one clicked last instead.
- **How properties are matched.** Each property is found on the target by where it sits in the layer, using match names, so it works across renamed layers and in any interface language. Effects, masks and shape groups are matched by name, then by position, and must be the same kind either way, so a blur's expression never lands on some other effect that happens to be second in the stack.
- **Nothing is created.** If a target lacks the property (most often an expression control the source has and the target doesn't) that expression is skipped and the status line lists it. An expression that goes on but can't evaluate on the target, typically because it refers to an effect the target is missing, is listed too.
- Expressions are copied as written, so one that refers to a layer or effect by name still refers to that name on the target.
- An expression that is switched off on the source arrives switched off.
- A target's existing expressions are replaced only where the source has one; the rest are left alone.
- Every click is one undo step.

### `ScriptUI Panels/Chroma Utilities Mini.jsx`

The same tools as one row of square buttons, for docking in a strip above the timeline or down the side of the Project panel where a full-width panel won't fit.

<img src="images/chroma-utilities-mini.png" alt="Chroma Utilities Mini panel docked in After Effects: one row holding a Project section with a shot-folders icon button, and a Parenting section with P, S, R, PSR and a keyframes icon button" width="287">

Three outlined sections: **Project**, holding the Create Shot Folders button; **Parenting**, holding **P**, **S**, **R**, **PSR**, a keyframes icon for every keyframe on the layer, and **Dup** for the one-click duplicate-and-parent; and **Expressions**, holding the transfer button (`=→`). No status line — the result is visible in the comp, so success is silent. Only a refused parent, or an expression that was skipped or won't evaluate on its target, raises a dialog. Everything else behaves exactly as the full panel does, Alt-click included.

Both panels can be installed side by side; they are independent, and the mini one carries its own copy of the tool code so it stays a single file. The icons are embedded in the script as PNG bytes rather than sitting in a folder beside it, for the same reason.

Every button is drawn by one `onDraw` function, so they cannot drift apart. After Effects leaves no way to have it draw them consistently: a ScriptUI `iconbutton` comes out round whatever size it is given, and `graphics.drawOSControl()` — the documented way to ask for the native frame underneath a custom `onDraw` — silently paints nothing, so an icon button ends up with no frame and no rollover. The frame, the rollover and the pressed state are therefore drawn by hand, in colours sampled from After Effects' own buttons and expressed as multiples of the dock background so a different UI brightness carries them with it.

Folder and keyframe icons by Royyan Wijaya, [The Noun Project](https://thenounproject.com/).

### `ScriptUI Panels/Chroma Purge After Render.jsx`

Renders the render queue and purges caches after each item, so a long queue doesn't degrade as memory and the disk cache fill up.

<img src="images/chroma-purge-after-render.png" alt="Chroma Purge After Render panel docked in After Effects, with cache checkboxes, the two render modes, and the disk cache section showing a resolved path of D:\AeCache" width="415">

Two modes, because they trade against each other:

- **One item at a time** — parks the queue, renders a single item, purges, repeats. The purge never lands while the render engine is mid-frame. Slightly slower, since each item pays its own `render()` startup.
- **Whole queue** — hands everything to After Effects in one `render()` call and purges from each item's `onStatusChanged` callback. Faster between items, but the purge runs while AE is still inside the render.

Memory caches, undo and snapshots go through `app.purge()`. The disk cache has no scripting API at all — Adobe never exposed the Empty Disk Cache button — so it is cleared by deleting the cached frames directly.

That means the cache location matters, and it is nearly always moved off the default onto a fast scratch drive. The panel reads it from preferences at runtime rather than assuming a path. The preference key carries a version suffix that Adobe bumps between releases (`Folder 7` in 26.0), so it probes the range and takes the first hit; if resolution ever fails there's a **Set…** override that persists. The panel also measures the cache, and reveals the folder.

Two constraints on deletion, which matter if the cache root is pointed somewhere populated: only files ending `.aecache` are removed, and only ones inside a `*.noindex` folder. Directories are never touched — After Effects reuses the empty `00`–`ff` buckets.

Worth knowing before relying on it: deleting cached frames under a running After Effects leaves its cache index referencing frames that are gone. AE handles the miss by re-rendering, so nothing breaks, but it is not identical to the Preferences button. If the real goal is that a long queue shouldn't degrade at all, one `aerender` process per item is the stronger answer — the process exits and the OS reclaims everything, with nothing left to purge.

Settings persist between sessions via `app.settings`.

### `Scripts/ExportShapesToC4D.jsx`

The After Effects half of getting a shape layer into Cinema 4D with its animation. Run it with a comp open, choose the selected shape layers or every shape layer in the comp, pick the work area or the whole comp, and it writes a JSON file that [`import_ae_shapes-AE2C4D.py`](cinema-4d.md#import_ae_shapes-ae2c4dpy) rebuilds on the C4D side.

Adobe's own Cinema 4D exporter brings a shape layer across as an empty Null, because it carries layer transforms and not path data. This writes the paths themselves, sampled on every frame, along with strokes, Trim Paths and group transforms. Every value is read after expressions, so expression-driven animation comes across baked.

Scripting has no way to ask for a layer's world matrix, so the script borrows the expression engine: four temporary 3D Point Controls evaluate `toWorld()` at the origin and along each axis, and are removed again when it's done. Parents, 3D rotation, orientation and auto-orient all come along with it. It's one undo step, and a locked layer is unlocked for the duration and relocked.

Needs **Allow Scripts to Write Files and Access Network** enabled, like the purge panel.

### `kbar/`

One-action copies of the same tools, for [kBar](https://aescripts.com/kbar/) — the aescripts toolbar extension — or for a plain keyboard shortcut. A kBar button runs a `.jsx` file and gives it nowhere to put a status line, so each of these does exactly one thing, says nothing when it works, and raises a dialog only when something could not be done.

`ChromaDuplicateStripPSR.jsx` is the one worth a key: it replaces duplicate → select both → click PSR with a single press. The rest are the panel's other buttons one file each, plus `ChromaDuplicateStripAllKeys.jsx`.

None of them reads Alt, unlike the panels. A shortcut with Alt in it — `Ctrl+Alt+D`, say — holds Alt down at the moment the script would look, so the button would silently do the other thing every time. One button, one action; the panels are still there when the swap is wanted.

They are **generated**, not hand-written: `build_kbar.py` lifts the tool functions out of `Chroma Utilities Mini.jsx`, works out the transitive closure of what each entry point uses, and wraps one call in an IIFE. Change the panel, re-run it, and the buttons follow; `--check` exits non-zero if any is out of date. The panels already carry two copies of the tool logic on purpose, so each stays a one-file install — nine hand-maintained copies on top of that is where they would drift.

Install and per-button labels: [`aftereffects/kbar/README.md`](../aftereffects/kbar/README.md). Not yet run inside kBar.

### Installing the After Effects scripts

Copy the contents of `aftereffects/` into the matching folders inside the After Effects install:

```
Windows   C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Scripts\
macOS     /Applications/Adobe After Effects <ver>/Scripts/
```

Needs administrator rights on Windows. Scripts placed here survive After Effects updates.

Restart After Effects afterwards. Panels then appear at the bottom of the **Window** menu; plain scripts under **File → Scripts**.

`kbar/` is the exception: it is not part of After Effects' own layout, so don't copy the folder in. Leave it somewhere that an After Effects update won't wipe and point kBar at it, or copy the `.jsx` files — the files, not the folder — into `Scripts/` to get them under **File → Scripts** where **Edit → Keyboard Shortcuts** can bind a key to each.

`Chroma Purge After Render` needs **Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network** enabled before it can clear the disk cache. Everything else in it works without that.

### `plugins/vr_color_gradients_3d/`

An effect plugin — C++ rather than a script — that does what After Effects' own **VR Color Gradients** does, with one addition: **every gradient point carries a Z axis**, so the points sit in 3D space instead of being pinned to the surface of the sphere.

Adobe's version gives each of its eight points a direction only. You can move a colour around the 360 frame, but not change how far its influence spreads — the falloff exponent is global, so tightening one point tightens all of them. A distance per point makes spread a local property.

#### Why Z = 0 changes nothing

A gradient point is treated as a position rather than a direction, `P = radius * direction`, and the falloff uses the real 3D distance from that point to wherever the pixel's ray meets the unit sphere:

```
|P - d|^2  =  radius^2 + 1 - 2 * radius * (direction . d)
```

At `radius == 1` that collapses to the chord distance `2*sin(theta/2)` — a pure angular falloff, which is exactly how a point stuck to the sphere behaves. So `Z = 0` reproduces a flat gradient *exactly*, and the Z axis is strictly additive: it can never shift a look you already had.

Pull a point inward and its distance to every direction evens out, so its colour blooms wide across the sphere. Push it outward and the colour tightens into a hotspot.

#### Two point spaces, one set of controls

Each point is a single 3D point parameter; a **Point Space** popup decides how its X/Y/Z is read, rather than doubling eight points' worth of UI.

- **Equirect + Distance** — X/Y is the position in the equirect frame in pixels, draggable on the canvas exactly as Adobe's is, and Z is depth: `radius = 1 + Z / Depth Scale`. A drop-in.
- **World XYZ** — Cartesian, viewer at the centre of the frame, with direction *and* falloff derived from the vector. After Effects' Y axis points down and is flipped internally, so expression-linking a point to a 3D null's `position` behaves the way you'd expect. That is the reason the mode exists: the gradient can be driven by something you animate in the 3D viewport.

The rest matches the original — frame layout (monoscopic or either stereo pair), horizontal and vertical field of view, 1–8 points with a colour each, a falloff exponent, opacity and the usual blending modes. **Gradient Blend** at 0 % collapses the mix to hard Voronoi cells, which is useful on its own.

Unlike Adobe's, which is GPU-only and refuses to render without acceleration, this one is a CPU smart-render effect: 8-, 16- and 32-bit, float-aware, multi-threaded, and it works with GPU acceleration switched off.

This is an independent implementation of the standard maths — equirectangular projection plus inverse-distance-weighted interpolation. No Adobe code is reproduced.

#### Installing it

**The built plug-in is in the repo** — [`plugins/vr_color_gradients_3d/ChromaVRGradient3D.aex`](../plugins/vr_color_gradients_3d/). Copy it into `Support Files\Plug-ins\Effects\`, where it survives After Effects updates, and restart. The effect then appears under **Effect → Immersive Video**, alongside After Effects' own VR effects. Windows x64 only; the source carries the Mac entry points but no Mac build has been made.

Shipping source alone was the wrong call for this one: everybody who wants the effect is a motion designer, not a C++ developer.

#### Building it yourself

Only if you're changing it. The source moved into [`src/`](../plugins/vr_color_gradients_3d/src/) when the binary took its place, and needs the After Effects SDK and MSVC with the C++ workload:

```powershell
cd src
.\build.ps1 -Install     # builds, then copies into After Effects (elevates)
```

The build overwrites the committed `.aex` one level up rather than hiding in a `build/` folder, so a rebuild updates the copy people download and `git status` says when it has drifted. The SDK, Visual Studio and After Effects locations are all found at run time — `vswhere`, a search for `PiPLtool.exe`, and the highest-numbered AE install — with `-SdkRoot`, `-VsRoot` and `-AeRoot` to override. They were hardcoded to one workstation until a second machine came along and the paths silently stopped existing.

The geometry, interpolation and blend modes live in a header with no After Effects types in it, so `tests/` compiles and runs them under plain `g++` — including an offline renderer that writes equirect stills. Its [README](../plugins/vr_color_gradients_3d/README.md) covers the parameters in full, and the SDK and scripting traps worth knowing about, among them a bug in the SDK's own `PF_ADD_POINT_3D` macro, which discards the Z default you pass it.
