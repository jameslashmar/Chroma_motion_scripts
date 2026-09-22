# Cinema 4D

*The XPresso tooling, the shape importer and the Chroma Utilities plugin. Part of [Chroma Motion Scripts](../README.md).*

Run from **Extensions → User Scripts**. See [Installing the Python scripts](#installing-the-python-scripts) below.

The `-OM2XP` / `-XP2OM` / `-AE2C4D` suffixes are direction: Object Manager → XPresso, back again, and After Effects → Cinema 4D.

### `import_ae_shapes-AE2C4D.py`

Rebuilds After Effects shape layers in Cinema 4D from the file [`ExportShapesToC4D.jsx`](after-effects.md#scriptsexportshapestoc4djsx) writes, animated.

- **Paths become bezier splines**, one per path, under a Null named after the layer. An animated path is keyed with Point Level Animation. Keys that change nothing are dropped, so a path that holds still for forty frames costs two keys, not forty.
- **Strokes become Sweeps.** Stroke width becomes the radius of a circle profile, through a **1 px = _n_ cm** scale set in the dialog, and is keyed if it animates. Group scale above the stroke scales the width, as it does in After Effects. Round and projecting caps become outside bevels exactly half the stroke width deep, so the tube reaches past the path's end by the same amount AE's cap does.
- **Trim Paths drive Start and End Growth.** Sweep growth runs on true arc length, so percentages match. Offset is the awkward part, because a trim window can slide past the first vertex and come back round, and a Sweep's growth cannot wrap. A closed path whose window ever crosses its first vertex is swept along a copy of the loop that runs round twice, so growth passes through the seam in one continuous tube. An open path gets a second `(wrap)` Sweep for the piece that has come round to the start again. **Trim Multiple Shapes: Individually** is honoured too: the window is shared out across the paths by length, top path first.
- **Rectangles, ellipses, stars and polygons** are converted to beziers with After Effects' own start vertex and direction, so a trim draws on from the same place without running Convert to Bezier Path first.
- **Layer transform:** bake it into the points (exact, including 3D layers and parent chains), or animate it on the layer's Null (cleaner when a static shape just moves around). The Null can't hold skew, and the importer says so if the transform has any.
- **Origin** at comp centre or top-left, the layer's in and out points become visibility keys on its Null, and the project frame rate and range can be set to match the comp.
- Merge Paths, Repeater, Offset Paths and the other path operators aren't reproduced. The import finishes with a list of anything it skipped, rather than quietly ignoring it.

One Cinema 4D detail worth knowing if you ever write splines from Python: **C4D evaluates a bezier tangent at 4/3 of its length.** A cubic bezier's control offset has to be multiplied by ¾ before `SetTangent`, or every curve bulges outwards. A circle of radius 100 comes out 110 across the diagonal, and trims no longer land where they should. You can see it in C4D's own Circle: made editable, its tangents are 0.415 r, not the textbook 0.552 r.

### `find_xpresso_node-OM2XP.py`

Select an object (or tag) in the Object Manager, run the script, and it selects the XPresso node(s) that reference that object.

It searches **every** XPresso tag in the scene, so you don't need to know which rig the object is wired into or have the right tag selected first. Nodes nested inside XGroups are found too. Matching is on object identity first, falling back to a name match if nothing exact turns up — useful in a rig with several objects called `Sweep`. If nothing matches, it prints every node and what it references so you can see why.

It then opens the XPresso editor on the right graph and **jumps straight to the node** — centred on screen and zoomed in, ready to work on. No hunting around a 2,000-unit-wide graph for a highlighted box.

The zoom level is yours to set. Open the script and change `CENTRE_ZOOM` near the top:

```python
CENTRE_ZOOM = 2.0     # 200%. 1.0 = 100%, 0.5 = zoomed out, 4.0 = right in
```

Where several graphs matched, the first is shown and the rest are named in the console — their nodes stay selected, so switching to one of those tags shows the selection already made.

Written for a 61-node rig (since grown to 80) where hunting for "which node drives this null?" by eye was the bottleneck.

<sub>How the centring works, and the several obvious approaches that don't: [docs/xpresso-api-notes.md](xpresso-api-notes.md).</sub>

### `select_xpresso_reference-XP2OM.py`

The reverse lookup. Select node(s) in the XPresso editor, run the script, and it selects whatever they reference — object, tag or material — in the Object Manager or Material Manager.

It expands collapsed hierarchy on the way, so the target is actually visible on screen rather than selected somewhere inside a folded group. Handles multiple selected nodes across multiple graphs at once, de-duplicates targets, and prints the full path of everything it selected.

### `probe_xpresso_view.py`, `probe_xpresso_commands.py` — diagnostics

Not tools, but the instruments that worked the view transform out, kept because the same questions will come up again.

`probe_xpresso_view.py` reads and writes zoom, view position and the root XGroup's position, reporting each separately so they can't be confused. `probe_xpresso_commands.py` enumerates every command plugin and logs which are enabled, which is how "XPresso registers no view commands at all" was established rather than assumed.

### One at a time, not all at once

The next two both exist for the same reason: **they apply an operation to each selected object individually, instead of treating the selection as one thing.** That's the difference between doing something fifty times and doing it once to fifty objects, and Cinema 4D gives you the second when you usually want the first.

#### `multiple-instances_from_multiple-selected.py`

An Instance of **every** selected object, one each, named `<original>_instance`.

Select fifty objects and you get fifty instances — not one instance of the first, and no clicking through them one at a time. Beyond the batching:

- Each instance is inserted as a **sibling directly after its source**, so the hierarchy stays readable instead of everything piling up at the bottom of the Object Manager.
- It copies the source's relative **and frozen** P/R/S, so each instance lands exactly on top of its original rather than at the parent's origin. That's the part that's fiddly to get right by hand.
- The whole batch is **one undo step**.
- The selection is swapped to the new instances afterwards, so you can move them straight away.

#### `connect_&_delete_multiple_selected_objects.py`

**Connect Objects + Delete** run on each selected object individually, rather than merging the whole selection into one mesh.

C4D's built-in command collapses a multi-object selection into a single object — which is right when you want one mesh, and wrong when you have fifty separate assemblies to flatten. This iterates instead: fifty selected nulls with children become fifty connected meshes, each keeping its own identity. `c4d.EventAdd()` fires once at the end so the Object Manager redraws cleanly.

### `plugins/chroma_utilities/`

A background listener that starts with Cinema 4D and runs for the whole session — no button, nothing to launch. It does five things, each switchable on its own.

**Parent renamer.** A generator takes the name of the object you put inside it. Alt-click Extrude on a spline called `Logo Outline` and you get an Extrude called `Logo Outline`, not `Extrude`. Works for any generator type, and for children dragged in later — it watches for the result rather than for the click.

**Text object renamer.** Spline Text and MoText objects name themselves after the first four words of their own text, and keep up as you edit. `Welcome to the show tonight` becomes `Welcome to the show`.

**Auto-enumerator.** Duplicates count up properly instead of collecting C4D's `.1` suffix: `Light` → `Light_02` → `Light_03`. Whatever numbering the original used is normalised onto the same form, and matching children are renumbered alongside their parent, so duplicating `Camera 02` containing `target 02` gives `Camera_03` containing `target_03`. Replaces Romain Rosi's Smart Increment — don't run both.

**Multi-wire.** Select several XPresso nodes, drag a connection onto a port of one of them, and the same connection is made on all of them — one drag instead of twenty when wiring a rig control into a row of nodes. Disconnecting mirrors too, with a prompt about removing the emptied port. Ports are created when the node accepts them, and existing connections are replaced.

**Duplicate-wire.** Copy an XPresso node and it keeps whatever was feeding it, instead of arriving with every input empty. Only incoming connections — an XPresso input port holds one wire, so reconnecting the copy's output would unplug the original rather than duplicate anything. Duplicating a whole selection works too: the wires between the copied nodes survive on their own, and only the inputs from outside are put back. It never replaces a connection that's already there.

The three renamers only ever touch a name that's still the type default or one the plugin assigned itself, so a hand-typed name is safe, and everything already in a document when it opened is left alone. Settings are constants at the top of the `.pyp`. See [its README](../plugins/chroma_utilities/README.md) for the full rules, install and limitations.

Installs to `plugins\`, not `library\scripts\`. Ships as a compiled `.pypv`; the `.pyp` source is kept private.

### Installing the Python scripts

Drop the `.py` files from `cinema4d/` into your Cinema 4D script folder:

```
%APPDATA%\Maxon\Maxon Cinema 4D 2026_<hash>\library\scripts\
```

They appear under **Extensions → User Scripts**, where they can be bound to a keyboard shortcut or dragged onto a palette.

Cinema 4D caches script files aggressively. If an edit doesn't appear to take effect, reload scripts or restart before assuming the change didn't save.
