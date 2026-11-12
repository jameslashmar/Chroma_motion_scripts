# XPresso scripting notes — Cinema 4D 2026

Notes gathered while writing `find_xpresso_node-OM2XP.py` and `select_xpresso_reference-XP2OM.py` against Cinema 4D 2026 / Python 3.11 (`c4d` classic API, `c4d.modules.graphview`).

These are the things that went wrong repeatedly. The API surface is not what autocomplete or older forum posts suggest, and most of these fail *silently* — the script runs, finds nothing, and looks broken rather than incomplete. Worth reading before writing any new XPresso tooling.

## Walking the graph

**`GvNodeMaster` has no node list.** There is no `GetNodes()`, no `GetFirst()`. You reach the graph with `master.GetRoot()`, which returns the top-level XGroup as a `GvNode`, then walk from `root.GetDown()`.

**Nodes nest, so iteration must recurse.** `root.GetChildren()` returns only the direct children of the top XGroup — anything inside a sub-group is invisible to it. On a real rig almost everything lives inside groups, so a non-recursive walk finds nothing. Walk `GetDown()` / `GetNext()` recursively.

**`GetUp()` returns a fresh Python wrapper every call.** This one is nasty because it fails silently: grouping nodes by `id(node.GetUp())` puts every node in its own bucket even when they share a parent, because the wrapper objects differ. Compare with `==` (which does compare the underlying node), or better, group siblings during the recursive walk so identity never comes up.

## Reading a node's references

**`GvNode` has no `GetOperatorObject()`.** The "Reference" field visible in the node's Attribute Manager is a link stored in the node's own data container. Get the container — `GetOpContainerInstance()`, falling back to `GetOperatorContainer()` / `GetDataInstance()` across versions — then resolve links with `bc.GetLink(id, doc)`.

Scanning every id in the container rather than hardcoding `GV_OBJECT_OBJECT_ID` means the same helper catches object, tag and material links from any node type.

**`BaseContainer` has no `GetCount()` in 2026.** Use `len(bc)` with `GetIndexId(i)` to enumerate parameter ids. Enumerate ids rather than iterating values directly — link values need a document to resolve and can throw during conversion.

## Selection and redraw

**`GvNode` has no `GetTitle()` or `SetSelected()`.** Use `GetName()` for the label, and `SetBit(c4d.BIT_ACTIVE)` / `DelBit(c4d.BIT_ACTIVE)` for selection. Call `c4d.modules.graphview.RedrawMaster(master)` afterwards or the editor won't repaint and the selection change is invisible.

## Driving the editor's view (2026-08-07, corrected twice)

**The view transform is readable and writable.** An earlier version of this file said centring was impossible and that zoom "cannot be set by any plugin in any language". Both were wrong. It all lives on the **root XGroup's operator container**:

```python
bc = (master.GetRoot().GetDataInstance()
        .GetContainerInstance(c4d.ID_SHAPECONTAINER)
        .GetContainerInstance(c4d.ID_OPERATORCONTAINER))

bc[104]        # zoom, float, 1.0 = 100%
bc[102], bc[103]   # view top-left, in graph units
bc[100], bc[101]   # the root XGroup's OWN position - not the view
```

The mapping, measured against a live 2026 session:

```
view_centre_in_graph_units = -scroll
```

so centring on a point is just `scroll = -point`. **No viewport size is involved**, which matters because C4D gives no way to ask how big the editor is.

**How to pin this down, because it is easy to get wrong.** Press `h` (frame all) and `s` (frame selection) in the editor and read the container after each. Both leave `scroll` at exactly `(0, 0)` — `h` with the graph's bounding box symmetric about the origin, `s` with the selected node's centre on it. The editor **re-bases every node coordinate** so the view centre is the origin, rather than keeping a scroll offset. That is also why node coordinates jump wholesale between runs: framing rebases them. Reading node position and scroll in the same run is therefore always correct; comparing coordinates *across* runs is meaningless.

**The sign has to be measured.** Writing `scroll = (500, 0)` moves the node to the **right** — the view centre goes to `-500`. Fitting a model to a single hand-centred sample cannot tell you this: a sign error silently absorbs into whatever viewport size you invent, the numbers look self-consistent, and every centring lands mirrored about the origin. Two known states (`h` and `s`) settle it in seconds; one fitted sample never will.

**Writing the view does not edit the graph.** Shifting scroll by thousands of units and root position by hundreds changed **0 of 80** node coordinates on a production rig. Verified explicitly, because 100/101 are node-position ids everywhere else and confusing them with 102/103 would silently offset a whole graph.

**Coordinates are per-canvas.** Each XGroup has its own, so a nested node cannot be centred by scrolling the root — aim at its top-level ancestor instead.

### Dead ends, so nobody repeats them

**There is no command that centres an XPresso graph.** Enumerating all 3,390 command plugins (`probe_xpresso_commands.py`) shows the entire classic XPresso family is:

| id | name |
|---|---|
| 1001138 | XPresso Pool |
| 1001145 | XPresso Manager |
| 1001148 | *(blank — the editor itself)* |
| 1001149 | XPresso |

None frames anything. There are exactly three Zoom In/Out pairs in the list: `14063`/`14064` (3D viewport), `1016010`/`1016011`, and `465002325`/`465002326`. The third also owns `Center Selected`, `Arrange Selected Nodes` and `Show All Ports` — but it is the **new node editor** (scene and material nodes), not XPresso.

**`13038` is a 3D viewport command.** Per Ferdinand at Maxon it "is grouped together with a whole architecture of viewport commands which first check if they can get hold of the active viewport" ([topic/13176](https://developers.maxon.net/topic/13176)). It frames the viewport whichever manager has focus. Every "manager focus" theory built on it was chasing the wrong thing.

**The editor's `s` / `h` keys do frame the graph** — they are hardcoded dialog keys, not commands, which is why no id reaches them and why they can't be bound in Customise Commands. Driving them with a synthetic Windows keystroke works, and was the shipped solution briefly. It is strictly worse than writing the transform: Windows-only, has to be timed against the editor taking keyboard focus, gives no control over zoom, and frames the 3D viewport if focus lands elsewhere. Keep `s` as a manual fallback only.

**A script cannot defer work into a C4D message loop.** `RegisterMessagePlugin` fails from the Script Manager with `cannot find pyp file - plugin registration failed`, so `SpecialEventAdd` has nothing to wake. Also `c4d.PLUGINTYPE_MESSAGE` does not exist in 2026 Python (C++ SDK only) — `FindPlugin`'s type argument is optional, so omit it.

**`master.GetPrefs()` id 105 is not zoom.** It reads `80.0` and looks like a percentage, but holds steady while the view zooms. Six unrelated settings, as originally recorded.

**Method note.** Three sessions were spent on "which command is it?" when the answer was that it isn't a command. What broke it open was enumerating the actual command list and noticing XPresso contributes *nothing* to it, then dumping every container while the mouse moved and diffing. Enumerate and diff before theorising — and treat one unreproduced observation as noise.

## Node layout

**Node position lives three containers deep:** `node.GetDataInstance()` → `GetContainerInstance(c4d.ID_SHAPECONTAINER)` → `GetContainerInstance(c4d.ID_OPERATORCONTAINER)`, then ids 100 and 101 for x/y position and 108 and 109 for x/y size, all via `GetReal` / `SetReal`.

Coordinates are relative to the containing group's canvas, so never mix nodes from different groups in a single alignment pass.

## Matching objects

**Object names are not unique.** Match on object identity (`==`) first and only fall back to name comparison — a rig will happily contain several objects called `Sweep`.

## Known unknown: editor selection in 2026

An adapted version of Arttu Rautio's (aturtur) node line-up script reported "nothing to line up" in at least one case where nodes were visibly selected in the editor, after the recursion and sibling-grouping bugs above were fixed. The remaining suspect is the selection flag itself — it assumes editor selection is stored as `c4d.BIT_ACTIVE` on the node, which is what worked in R25.

If you hit this: print a per-graph diagnostic (`XPresso on '<host>': 61 nodes, 3 selected`) before doing any work. A non-zero selected count with nodes that don't move means the fault is in the alignment maths. Zero selected while nodes are clearly highlighted means `BIT_ACTIVE` is the wrong flag in 2026, and the next step is dumping `GetAllBits()` and `GetNBit()` for a known-selected node to find where the editor actually records selection.

## Material graph nodes referenced from XPresso

Worked out on 2026-11-12 against Cinema 4D 2027 in `c4dpy`, for `select_xpresso_reference-XP2OM.py`.

**A Node Editor node referenced by XPresso is a stand-in `BaseList2D`.** The graph is not made of `BaseList2D`, so C4D keeps one stand-in per node or port that something classic points at (an animation track, an XPresso Object node). They live in the material's `Nodes` branch with type `300001078`. They are not `BaseMaterial`, `BaseObject` or `BaseTag`, so code that sorts link targets into those three drops them silently.

```python
mat = standin.GetMain()                       # the material
for space_id, nimbus in mat.GetAllNimbusRefs():
    node = nimbus.GetGraphNodeFromBaseList(standin)   # maxon.GraphNode
    if node.GetGraph() == nimbus.GetGraph():          # see below
        break
```

**`GetGraphNodeFromBaseList` ignores which nimbus you call it on.** It answers from the graph that owns the stand-in. A material with graphs in two node spaces returns the same valid node from both nimbus refs; only the `GetGraph()` comparison tells you which one to open. `nimbus.FindCorrespondingBaseList(node.GetPath()) == standin` is an equivalent check.

**A port stand-in resolves to the port**, kind `8`, path `node<port`. `port.GetAncestor(maxon.NODE_KIND.NODE)` gives the node to select. The stand-in's `GetName()` is the port's label (`Scale`), and a node's label is `node.GetValue(maxon.EffectiveName)`.

**Selecting needs a transaction.** `maxon.GraphModelHelper.SelectNode(node)` outside `graph.BeginTransaction()` raises `No current transaction for modification of NodesGraphModel`.

**Opening the editor:** `nimbus.OpenInEditor()`, optionally with the `NodePath` of a group. Framing is command `465002307` (Frame Selected) from the Node Editor block; `465002308` is Center Selected.

**The method names in older posts are wrong for 2027.** There is no `FindOrCreateBaseList`; it is `FindOrCreateCorrespondingBaseList` / `FindCorrespondingBaseList`.

**Legacy Redshift shader graphs are XPresso graphs**, so the link is an ordinary `GvNode`: `node.GetNodeMaster().GetOwner()` is the material, selection is `BIT_ACTIVE`, and the editor opens with `c4d.CallButton(mat, c4d.REDSHIFT_GRAPH_BUTTON_EDIT)`. Redshift registers no command for it. In `c4dpy` the root has no shape container until the graph has been opened in a GUI, so the view transform can't be read headless.

**Not yet confirmed in the GUI:** whether Frame Selected is accepted straight after `OpenInEditor` from a script, whether `OpenInEditor(group_path)` enters a group, and whether the 102/103/104 view transform applies to the legacy Redshift editor as it does to XPresso. The script reports rather than fails on each.

## Redshift materials

A Redshift branch reached through `redshift.GetRSMaterialNodeMaster()` only supports legacy RS materials. Node-space Redshift materials return `None` — report that rather than failing silently. Supporting them properly means going through the `maxon` nodes API, which is a separate piece of work.

## Related: driving two Sweeps from one slider

Not an API note, but the problem that prompted these scripts, and the answer is worth keeping.

To drive two Sweeps sequentially from a single 0–100% slider, don't use the Time node (unreliable under network rendering) or the Memory node. Memory's History Depth counts **evaluation passes, not frames** — a pass happens on every scene evaluation, so scrubbing, viewport interaction and frame-jumping all desynchronise it, and each render node starts with an empty history buffer. It's built for feedback loops, not time offsets.

Offset in slider space with Range Mappers instead: Sweep A takes input 0–50 → output 0–100, Sweep B takes 50–100 → output 0–100, both with Clamp Lower and Clamp Upper enabled. The clamping is what holds A at fully grown while B is still at zero. Overlap the ranges (0–55 and 45–100) for a softer handover. Pure maths off a single value with no retained state, so it's identical on every frame, every scrub and every render node.

Watch for percentage data types carrying 0–1 rather than 0–100 in XPresso — if a Sweep snaps to full growth instantly or barely moves, set the Range Mapper's input and output data types to Percent explicitly.
