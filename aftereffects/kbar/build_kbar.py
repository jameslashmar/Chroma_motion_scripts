#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate the one-action kBar scripts in this folder from the Mini panel.

A kBar button runs a .jsx file and gives it nowhere to put a status line, so
each button wants a script that does exactly one thing, says nothing when it
works and puts up a dialog when it cannot. That is precisely how the Mini
panel's tool functions already behave, so they are the source: this script
lifts them out, wraps one call in an IIFE and writes a standalone file.

Lifting rather than copying by hand is the whole point. The panels already
carry two copies of the tool logic -- deliberately, so each stays a one-file
install -- and a third and fourth hand-maintained copy is where they would
start to drift. Change the Mini panel, re-run this, and the buttons follow.

    python3 aftereffects/kbar/build_kbar.py           # write the scripts
    python3 aftereffects/kbar/build_kbar.py --check   # fail if they are out of date

How the lifting works: the panel writes every top-level declaration at four
spaces and closes it at four spaces, so a block runs from `    function name(`
to the next line that is exactly `    }`. That is a textual rule, which means
no brace counting and nothing to get wrong inside a string, a comment or a
regex literal. Each script then gets the transitive closure of the blocks its
entry point actually uses, and the closure is checked afterwards: if an
emitted file mentions a name it does not define, this exits non-zero rather
than shipping a script that throws on click.
"""

import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, os.pardir, "ScriptUI Panels", "Chroma Utilities Mini.jsx")
CRLF = "\r\n"

# A block starts at one of these at four spaces and ends at the next line that
# is exactly "    }" or "    };" -- or on the same line, for a one-line var.
BLOCK_START = re.compile(r"^    (?:function (\w+)\(|var (\w+) =)")
BLOCK_END = ("    }", "    };")

# Blocks that belong to the panel and never to a button: its chrome, its
# hand-drawn buttons, its embedded icons, and its own name.
UI_ONLY = set("""
    SCRIPT_NAME ICON_FOLDERS_PNG ICON_KEYFRAMES_PNG ICON_TRANSFER_PNG
    embeddedImage clamp01 grey backgroundLevel roundRectPath drawButton
    redraw trackState buildUI BUTTON_SIZE CORNER_RADIUS BASE_BACKGROUND
    FACE_RATIO BORDER_RATIO TEXT_RATIO HOVER_BORDER_LIFT DOWN_FACE_LIFT
    TOOL_SUFFIX
""".split())

# Replaced rather than lifted -- see the comment in the stub itself.
ALT_STUB = """
    /**
     * Always false here, where the panel's would read the Alt (Option) key.
     *
     * In the panel, Alt is a modifier on a click: it swaps which selected
     * layer counts as the original, and which layer is the expression source.
     * A standalone script has no click. It runs from a kBar button or from a
     * keyboard shortcut, and a shortcut with Alt in it -- Ctrl+Alt+D, say --
     * would hold Alt down at the moment the script looked, silently doing the
     * other thing every time. So it never looks, and one button means one
     * action. The panel is still there when the swap is wanted.
     */
    function altPressed() {
        return false;
    }
"""

# ---------------------------------------------------------------- the buttons

SCRIPTS = [
    {
        "file": "ChromaDuplicateStripPSR.jsx",
        "title": "Chroma - Duplicate + strip PSR",
        "label": "Dup PSR",
        "entry": 'duplicateStripParent("psr");',
        "blurb": [
            "Select the animated layer and run this. It is duplicated, the copy",
            "loses its Position, Scale and Rotation keyframes, and the copy is",
            "parented back to the layer it came from -- one undo step, nothing to",
            "duplicate by hand and nothing to select twice.",
            "",
            "The duplicate is left selected, because the duplicate is the layer",
            "you go on to animate. Several selected layers each get their own.",
        ],
    },
    {
        "file": "ChromaDuplicateStripAllKeys.jsx",
        "title": "Chroma - Duplicate + strip all keyframes",
        "label": "Dup all",
        "entry": 'duplicateStripParent("all");',
        "blurb": [
            "As ChromaDuplicateStripPSR, but the copy loses every keyframe on the",
            "layer -- transform, effects, masks, text, shapes, styles -- and not",
            "only the three transform sets. Markers and expressions are left.",
        ],
    },
    {
        "file": "ChromaStripPosition.jsx",
        "title": "Chroma - Strip Position keys + parent",
        "label": "P",
        "entry": 'stripAndParent("position");',
        "blurb": [
            "Select the original layer and its duplicate(s). The duplicate loses",
            "its Position keyframes, including separated X/Y/Z, and is parented",
            "to the original so it follows the original's animation instead.",
        ],
    },
    {
        "file": "ChromaStripScale.jsx",
        "title": "Chroma - Strip Scale keys + parent",
        "label": "S",
        "entry": 'stripAndParent("scale");',
        "blurb": [
            "Select the original layer and its duplicate(s). The duplicate loses",
            "its Scale keyframes and is parented to the original.",
        ],
    },
    {
        "file": "ChromaStripRotation.jsx",
        "title": "Chroma - Strip Rotation keys + parent",
        "label": "R",
        "entry": 'stripAndParent("rotation");',
        "blurb": [
            "Select the original layer and its duplicate(s). The duplicate loses",
            "its Rotation keyframes -- X/Y/Z and Orientation on 3D layers -- and",
            "is parented to the original.",
        ],
    },
    {
        "file": "ChromaStripPSR.jsx",
        "title": "Chroma - Strip PSR keys + parent",
        "label": "All PSR",
        "entry": 'stripAndParent("psr");',
        "blurb": [
            "Select the original layer and its duplicate(s). The duplicate loses",
            "its Position, Scale and Rotation keyframes and is parented to the",
            "original.",
        ],
    },
    {
        "file": "ChromaStripAllKeys.jsx",
        "title": "Chroma - Strip all keyframes + parent",
        "label": "All keys",
        "entry": 'stripAndParent("all");',
        "blurb": [
            "Select the original layer and its duplicate(s). The duplicate loses",
            "every keyframe on the layer -- transform, effects, masks, text,",
            "shapes, styles -- but keeps its markers and expressions, and is",
            "parented to the original.",
        ],
    },
    {
        "file": "ChromaTransferExpressions.jsx",
        "title": "Chroma - Transfer expressions",
        "label": "Ex",
        "entry": "transferAndReport();",
        "blurb": [
            "Click the source layer, then the target(s), and run this. Every",
            "expression on the source is copied to each target -- or, with a",
            "property selected on the source, only the expressions it covers.",
            "",
            "Expressions only: keyframes and values are left alone, and a",
            "property the target does not have is reported, not created.",
        ],
    },
    {
        "file": "ChromaCreateShotFolders.jsx",
        "title": "Chroma - Create Shot Folders",
        "label": "Shot bin",
        "entry": "createShotFolders();",
        "blurb": [
            "The Create Shot Folders dialog: numbered shot bins in the Project",
            "panel, SHOT001 ... SHOT010, with the prefix, padding, start, step",
            "and count all editable. This one opens a dialog, so it is the odd",
            "button out -- the rest act on the selection and say nothing.",
        ],
    },
]


# ------------------------------------------------------------------- lifting

def read_source():
    with io.open(SOURCE, encoding="utf-8", newline="") as handle:
        return handle.read().split(CRLF)


def lift_blocks(lines):
    """Every top-level block in the panel, by name, with its leading comment."""
    blocks = {}
    index = 0
    while index < len(lines):
        match = BLOCK_START.match(lines[index])
        if not match:
            index += 1
            continue

        name = match.group(1) or match.group(2)
        if match.group(2) and lines[index].rstrip().endswith(";"):
            end = index
        else:
            end = None
            for probe in range(index + 1, len(lines)):
                if lines[probe] in BLOCK_END:
                    end = probe
                    break
            if end is None:
                sys.exit("build_kbar: no closing line for %s (line %d)" % (name, index + 1))

        # Walk back over the comment sitting directly above it.
        start = index
        while start > 0:
            above = lines[start - 1].strip()
            if above.startswith("*") or above.startswith("/*") or above.startswith("//"):
                start -= 1
            else:
                break

        blocks[name] = {"text": CRLF.join(lines[start:end + 1]), "order": index}
        index = end + 1
    return blocks


def strip_comments(text):
    """Comments removed, so a name mentioned in prose is not read as a use."""
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n\r]*", " ", text)
    return text


def names_used(text, known):
    code = strip_comments(text)
    return set(name for name in known if re.search(r"\b%s\b" % re.escape(name), code))


def closure(entry_text, blocks):
    """Every block the entry point reaches, directly or through another."""
    known = set(blocks)
    needed = names_used(entry_text, known)
    while True:
        grown = set(needed)
        for name in needed:
            grown |= names_used(blocks[name]["text"], known)
        if grown == needed:
            return needed
        needed = grown


# ------------------------------------------------------------------ emitting

def banner(title, blurb):
    out = ["/**", " * " + title, " *"]
    for line in blurb:
        out.append((" * " + line).rstrip())
    out += [
        " *",
        " * Silent when it works. A dialog only when something could not be done,",
        " * because a kBar button has nowhere to put a line of status text.",
        " *",
        " * One action and no UI of its own, so it suits a kBar button or a",
        " * keyboard shortcut. Unlike the panel it never reads Alt -- see",
        " * altPressed() below for why.",
        " *",
        " * GENERATED FILE -- do not edit this, edit the panel and rebuild:",
        " *   Source:  aftereffects/ScriptUI Panels/Chroma Utilities Mini.jsx",
        " *   Rebuild: python3 aftereffects/kbar/build_kbar.py",
        " *",
        " * Windows + macOS. ExtendScript only: no shell calls, no platform branches.",
        " *",
        " * Install: anywhere kBar can reach it. Dropped in",
        " * <AE install>/Support Files/Scripts/ it also appears under",
        " * File > Scripts, where Edit > Keyboard Shortcuts can bind it to a key.",
        " */",
    ]
    return CRLF.join(out)


def render(spec, blocks):
    entry = spec["entry"]
    needed = closure(entry, blocks) - UI_ONLY
    needed.discard("altPressed")

    wants_alt = "altPressed" in names_used(
        CRLF.join([blocks[name]["text"] for name in needed]) + CRLF + entry,
        set(blocks) | {"altPressed"},
    )

    ordered = sorted(needed, key=lambda name: blocks[name]["order"])

    parts = [banner(spec["title"], spec["blurb"]), ""]
    parts.append("(function %s() {" % re.sub(r"\W", "", spec["file"].replace(".jsx", "")))
    parts.append("")
    parts.append('    var SCRIPT_NAME = "%s";' % spec["title"])
    parts.append("")
    if wants_alt:
        parts.append(ALT_STUB.strip("\n").replace("\n", CRLF))
        parts.append("")
    for name in ordered:
        parts.append(blocks[name]["text"])
        parts.append("")
    parts.append("    " + entry)
    parts.append("")
    parts.append("})();")
    parts.append("")

    text = CRLF.join(parts)

    # The closure must be complete: a name used but not defined here would
    # throw the moment the button is clicked, and nothing else would catch it.
    defined = set(ordered) | {"SCRIPT_NAME"} | ({"altPressed"} if wants_alt else set())
    missing = names_used(text, set(blocks) | {"altPressed"}) - defined - UI_ONLY
    if missing:
        sys.exit("build_kbar: %s uses undefined %s" % (spec["file"], ", ".join(sorted(missing))))

    return text


def main():
    check_only = "--check" in sys.argv
    blocks = lift_blocks(read_source())

    for required in ("stripAndParent", "duplicateStripParent", "transferAndReport",
                     "createShotFolders"):
        if required not in blocks:
            sys.exit("build_kbar: %s is not in the panel any more" % required)

    stale = []
    for spec in SCRIPTS:
        text = render(spec, blocks)
        path = os.path.join(HERE, spec["file"])
        current = None
        if os.path.exists(path):
            with io.open(path, encoding="utf-8", newline="") as handle:
                current = handle.read()
        if current == text:
            print("  unchanged  %s" % spec["file"])
            continue
        if check_only:
            stale.append(spec["file"])
            print("  STALE      %s" % spec["file"])
            continue
        with io.open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        print("  written    %s  (%d lines)" % (spec["file"], text.count(CRLF) + 1))

    if stale:
        sys.exit("build_kbar: %d file(s) out of date -- run without --check" % len(stale))


if __name__ == "__main__":
    main()
