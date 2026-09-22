# Chroma Motion Scripts for C4D & AFX

Everything in this repo is free: small scripts for After Effects and Cinema 4D, and the Windows and Deadline tasks around them, written by hand or with AI assistance. If they save you time, please consider taking a look at our paid plugins on [aescripts](https://aescripts.com/authors/chroma/) and [store.chroma.london](https://store.chroma.london/):

- [Gulp — CGI shot builder for AFX](https://aescripts.com/gulp/)
- [VoxMark](https://aescripts.com/voxmark/)
- [VoxMark for Cinema 4D](https://store.chroma.london/l/tdkzz)
- [Redshift Light Manager](https://store.chroma.london/l/zlizze)
- [Redshift ID Manager](https://store.chroma.london/l/vgwstr)
- [Octane to Redshift Converter](https://store.chroma.london/l/oeziqg)
- [SuperSolo for C4D](https://store.chroma.london/l/lxhbxy)
- [Mega Bundle](https://store.chroma.london/l/bjczda)

---

## What's in here

Each area has its own page, because each one goes deep enough to deserve it.

### [After Effects →](docs/after-effects.md)

| | |
|---|---|
| **Chroma Utilities** | Dockable panel: duplicate a layer and strip its keys, parent it back, transfer expressions between layers, build numbered shot folders |
| **Chroma Utilities Mini** | The same tools as one row of square buttons, for a strip above the timeline |
| **Chroma Purge After Render** | Watches a render and clears the disk cache when it finishes |
| **Export Shapes to C4D** | Shape layers to JSON with their animation baked, for the Cinema 4D importer |
| **kBar buttons** | The same tools as nine one-action scripts, and an importable toolbar — [own page](aftereffects/kbar/README.md) |
| **VR Color Gradients 3D** | A C++ effect plugin: the stock VR gradient, with a Z axis on every point — [own page](plugins/vr_color_gradients_3d/README.md) |

### [Cinema 4D →](docs/cinema-4d.md)

| | |
|---|---|
| **Import AE Shapes** | Rebuilds After Effects shape layers as splines, Sweeps and Trim-Paths growth |
| **XPresso tooling** | Find the node for a selected object and back again, plus the diagnostics behind them |
| **Bulk object scripts** | Instances and connect-and-delete, one at a time rather than all at once |
| **Chroma Utilities plugin** | The C4D-side plugin — [own page](plugins/chroma_utilities/README.md) |

### [Windows and Deadline →](docs/windows.md)

| | |
|---|---|
| **C4D migration** | Moves a Cinema 4D setup from one release to the next (legacy — superseded) |
| **Deadline custom delay** | Takes a workstation out of the farm for a couple of hours and puts it back |
| **Shutdown / standby** | Delayed shutdown or suspend, for the end of an overnight render |

### Reference

- [XPresso API notes](docs/xpresso-api-notes.md) — what changed in the 2026 API, and why older forum examples break. Read this before writing new XPresso tooling.

---

## Installing

**After Effects** — copy the contents of `aftereffects/` into the matching folders inside the After Effects install. The tree mirrors After Effects' own layout, so it is a straight folder copy, and scripts placed there survive updates. Full steps, including the `kbar/` exception and the one preference `Chroma Purge After Render` needs: [After Effects → Installing](docs/after-effects.md#installing-the-after-effects-scripts).

**Cinema 4D** — drop the `.py` files into the user scripts folder and run them from **Extensions → User Scripts**. Full steps: [Cinema 4D → Installing](docs/cinema-4d.md#installing-the-python-scripts).

**kBar** — import [`aftereffects/kbar/Chroma Utilities.kbar`](aftereffects/kbar/) and all nine buttons arrive as one toolbar with the scripts inside it, so there is nothing to install first: [kBar → Installing](aftereffects/kbar/README.md#installing).

**Windows** — double-click. They all prompt for their input, so there are no arguments to remember.

---

## Compatibility

The After Effects scripts were written against **After Effects 2026** using ExtendScript and the classic `app` API. They use only the `File`/`Folder` API for disk work — no shell calls and no platform branches — so they run on macOS and Windows alike. Anything version-dependent, notably the disk cache preference key, is probed at runtime rather than hardcoded.

The XPresso scripts were written and tested against **Cinema 4D 2026 / Python 3.11**, using the classic `c4d` API and `c4d.modules.graphview`. Several API surfaces changed in ways that break older forum examples — those differences are documented in [docs/xpresso-api-notes.md](docs/xpresso-api-notes.md), which is worth reading before writing any new XPresso tooling.

`VR Color Gradients 3D` is a compiled effect plugin rather than a script, built against the **After Effects SDK 25.6** and shipped as source. The build script is Windows/MSVC; the source itself is portable and carries the Mac entry points in its PiPL, but only the Windows build has been exercised.

The batch and command files are Windows-only.
