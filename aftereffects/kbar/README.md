# kBar buttons

One-action copies of the Chroma Utilities tools, for [kBar](https://aescripts.com/kbar/)
— the aescripts toolbar extension for After Effects — or for a plain keyboard shortcut.

A kBar button runs a `.jsx` file and gives it nowhere to put a status line. These are
built for that: each does exactly one thing, says nothing when it works, and puts up a
dialog only when something could not be done.

## The buttons

| Script | Suggested label | What it does | Select first |
|---|---|---|---|
| `ChromaDuplicateStripPSR.jsx` | `Dup PSR` | Duplicates the layer, strips Position/Scale/Rotation keys off the copy, parents the copy back to it | one layer |
| `ChromaDuplicateStripAllKeys.jsx` | `Dup all` | The same, but every keyframe comes off the copy | one layer |
| `ChromaStripPosition.jsx` | `P` | Strips Position keys off the duplicate, parents it to the original | original + duplicate(s) |
| `ChromaStripScale.jsx` | `S` | Strips Scale keys, parents | original + duplicate(s) |
| `ChromaStripRotation.jsx` | `R` | Strips Rotation keys, parents | original + duplicate(s) |
| `ChromaStripPSR.jsx` | `PSR` | Strips all three, parents | original + duplicate(s) |
| `ChromaStripAllKeys.jsx` | `All keys` | Strips every keyframe, parents | original + duplicate(s) |
| `ChromaTransferExpressions.jsx` | `Exp` | Copies every expression from the source layer to the targets | source, then target(s) |
| `ChromaCreateShotFolders.jsx` | `Shots` | Opens the numbered-shot-bins dialog | nothing |

`ChromaDuplicateStripPSR` is the one worth a key. It replaces duplicate → select both →
click PSR with a single press, and it is one undo step.

## Installing

### The quick way: import `Chroma Utilities.kbar`

In After Effects: **Window → Extensions → KBar** → the **pencil** (Settings) →
**Import** → pick `Chroma Utilities.kbar`. All nine buttons arrive as one toolbar named
*Chroma Utilities*, already labelled.

The file is **baked**: it carries its own copies of the nine scripts inside it, so there
is nothing to install first and no paths to fix up. It works the same on a machine that
has never seen this repo. Importing **adds** a toolbar — kBar calls `addToolbar`, not a
replace — so an existing kBar setup is left alone.

Rebuild it after changing anything:

```sh
python3 aftereffects/kbar/build_kbar.py          # regenerate the scripts
python3 aftereffects/kbar/build_kbar_toolbar.py  # rebake them into the .kbar
```

### Adding buttons by hand instead

Put the `.jsx` files anywhere kBar can reach them and keep them there — an unbaked
button stores the path you browse to, so moving them later breaks it. Somewhere an
After Effects update will not wipe, so not inside the AE install:

```
Windows   C:\Users\<you>\Documents\Chroma\kbar\
macOS     ~/Documents/Chroma/kbar/
```

Then in kBar: **pencil → Add Button → JSX/JSXBIN file** → browse to the script → give it
a label or an icon → **OK**. kBar ships its own icon library and takes custom PNG or SVG,
which is why there are no icons in this folder; the suggested labels are in the table
above. Keep a text label to **8 characters or fewer** or kBar draws the button wide — a
newline in the label gives a second row instead.

**For a keyboard shortcut instead:** copy the `.jsx` files — the files, not this folder —
into the After Effects install:

```
Windows   C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Scripts\
macOS     /Applications/Adobe After Effects <ver>/Scripts/
```

Restart After Effects. They appear under **File → Scripts**, and
**Edit → Keyboard Shortcuts** will bind a key to each one. Both routes can be used at
once; the files are identical.

## Why there is no Alt here

In the panels, Alt (Option) is a modifier on a click: it swaps which selected layer
counts as the original, and which layer is the expression source. These scripts never
read it. A shortcut that contains Alt — `Ctrl+Alt+D`, say — holds Alt down at the moment
the script would look, so the button would silently do the other thing every time. One
button, one action. The panels are still there when the swap is wanted.

That is also why `Dup PSR` and `Dup all` are two files rather than one with a modifier.

## The `.kbar` format

Undocumented, so it was read out of kBar 3.1.5's own `js/common.js` — the export builder
and the schema migrator. A `.kbar` is a zip holding `manifest.json` (version 1, one
`toolbar`, plus `scripts`/`presets`/`shell` arrays naming what was baked in) and, when
baked, `scripts/<file>.jsx`. A script button is `type: 1` (`InvokeScript`) and points at
its baked copy with `filePath: "kzip://scripts/<index>"`. An icon is
`{type, path, color}`, where type `0` is text and `path` **is** the label.

If an import ever fails, re-read those two functions in the installed kBar before
assuming `build_kbar_toolbar.py` is wrong — a future kBar could move the format.

## These are generated

Do not edit them. They are lifted out of `../ScriptUI Panels/Chroma Utilities Mini.jsx`
by `build_kbar.py`, which takes the tool functions, works out the transitive closure of
what each entry point actually uses, and wraps one call in an IIFE.

```sh
python3 aftereffects/kbar/build_kbar.py           # rewrite the scripts
python3 aftereffects/kbar/build_kbar.py --check   # exit non-zero if any is out of date
```

Change the Mini panel, re-run it, and the buttons follow. The generator fails loudly
rather than shipping a broken button: if a script would use a name it does not define,
or a tool function has been renamed out of the panel, it exits non-zero and writes
nothing.

The panels already carry two copies of the tool logic on purpose, so that each stays a
one-file install. Nine hand-maintained copies on top of that is where they would start
to drift, which is what the generator is for.

## Status

Written 2026-09-21. Every script is checked to parse and to define every name it calls,
and the logic is lifted verbatim from the Mini panel rather than rewritten. The `.kbar`
is validated against kBar 3.1.5's own import assertions — archive integrity, manifest
shape, every `kzip://scripts/N` index in range and its baked file present.

**Not yet imported into kBar, and none of the buttons has been clicked.** The format was
read out of kBar's source rather than round-tripped through its own export, so the
import is the first real test.
