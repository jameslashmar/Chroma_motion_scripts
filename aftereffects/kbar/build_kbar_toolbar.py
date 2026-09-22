#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build `Chroma Utilities.kbar` - a ready-made kBar toolbar of all nine buttons.

kBar's Settings > Import takes a `.kbar` file, which is a zip holding a
`manifest.json` and, when "baked", the scripts themselves. Baked is what we
want: the file carries its own copies, so importing it on any machine gets
working buttons with no paths to fix up and nothing to install first.

The format is not documented anywhere; it was read out of kBar 3.1.5's own
`js/common.js` (the export builder and the schema migrator), so a future kBar
could change it. If an import ever fails, re-read those two functions before
assuming this script is wrong. What it expects:

    manifest.json           version 1, one `toolbar`, plus `scripts`/`presets`/
                            `shell` arrays naming what was baked in
    scripts/<file>.jsx      one per InvokeScript button
    button.filePath         "kzip://scripts/<index into manifest.scripts>"
    button.icon             {type: 0 text | 1 FontAwesome | 2 custom, path, color}
                            for a text icon `path` IS the label; over 8
                            characters it is drawn wide, and a newline in it
                            gives a second row
    button.type             1 = InvokeScript (8 = Spacer, 5 = menu item, ...)

Importing *adds* a toolbar - `addToolbar`, not a replace - so an existing kBar
setup is left alone.

    python3 aftereffects/kbar/build_kbar_toolbar.py

Run build_kbar.py first if the panel has changed: this bakes in whatever the
.jsx files currently say.
"""

import io
import json
import os
import sys
import uuid
import zipfile
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from build_kbar import SCRIPTS  # noqa: E402  - the one list of buttons

OUT = os.path.join(HERE, "Chroma Utilities.kbar")

TOOLBAR_NAME = "Chroma Utilities"
NOTES = ("Chroma Utilities - duplicate/strip/parent, transfer expressions and shot "
         "folders. Each button does one thing, is silent when it works and only "
         "raises a dialog when it cannot. github.com/jameslashmar/Chroma_motion_scripts")

# kBar's own default toolbar carries all seven, every one null.
NO_MODIFIERS = {
    "ctrl": None, "alt": None, "shift": None,
    "altshift": None, "ctrlalt": None, "ctrlshift": None, "ctrlaltshift": None,
}

BUTTON_TYPE_INVOKE_SCRIPT = 1
ICON_TYPE_TEXT = 0


def wrap_for_rendering(label):
    """kBar's own line-breaking for a text icon, from `wrapForRendering`.

    It breaks on **character count alone**. Spaces and newlines mean nothing
    to it, so "PSR" comes out as "PS" / "R" and "Shots" as "Sho" / "ts". A
    label only looks right when its space happens to land on the boundary,
    which is a thing to design for rather than discover in a screenshot."""
    n = len(label)
    if not label:
        return []
    if n <= 2:
        return [label]
    if n <= 4:
        return [label[0:2], label[2:4]]
    if n <= 6:
        return [label[0:3], label[3:6]]
    if n <= 8:
        return [label[0:4], label[4:8]]
    if n <= 12:
        return [label[0:6], label[6:12]]
    return [label[0:8], label[8:16]]


def check_label(label):
    """Complain about a label kBar would break mid-word, or draw wide.

    Each line goes into its own div and is XML-escaped but not otherwise
    touched, so a space at the edge of a line collapses in the HTML and a
    label whose space lands on the boundary reads correctly."""
    problems = []
    if len(label) > 8:
        problems.append("over 8 characters, so kBar draws it wide and this "
                        "button will not match the others")
    words = label.split()
    rendered = [line.strip() for line in wrap_for_rendering(label)]
    if any(line and line not in words for line in rendered):
        problems.append("breaks mid-word: kBar renders it %r" % (" / ".join(rendered)))
    return problems


def button(spec, index):
    """One InvokeScript button pointing at the copy baked in beside it."""
    return {
        "name": spec["title"].replace("Chroma - ", "Chroma: "),
        "description": spec["blurb"][0],
        "icon": {"type": ICON_TYPE_TEXT, "path": spec["label"], "color": ""},
        "type": BUTTON_TYPE_INVOKE_SCRIPT,
        "filePath": "kzip://scripts/%d" % index,
        "argument": "",
        "id": str(uuid.uuid4()),
        "modifiers": dict(NO_MODIFIERS),
    }


def main():
    missing = [s["file"] for s in SCRIPTS if not os.path.exists(os.path.join(HERE, s["file"]))]
    if missing:
        sys.exit("build_kbar_toolbar: run build_kbar.py first - missing %s"
                 % ", ".join(missing))

    # A bad label is invisible until the toolbar is on screen, so refuse it here.
    bad = [(s["label"], p) for s in SCRIPTS for p in check_label(s["label"])]
    if bad:
        for label, problem in bad:
            print("  BAD LABEL  %-10r %s" % (label, problem), file=sys.stderr)
        sys.exit("build_kbar_toolbar: %d label problem(s) - fix SCRIPTS in build_kbar.py"
                 % len(bad))

    manifest = {
        "version": 1,
        "toolbar": {
            "name": TOOLBAR_NAME,
            "buttons": [button(spec, i) for i, spec in enumerate(SCRIPTS)],
        },
        "isBaked": True,
        "notes": NOTES,
        "createdDate": datetime.datetime.now(datetime.timezone.utc)
                               .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "scripts": [{"source": spec["file"]} for spec in SCRIPTS],
        "presets": [],
        "shell": [],
    }

    # kBar writes it with an indent of 3. Matching that is cosmetic, but it
    # makes a hand-diff against a file kBar exported itself actually readable.
    payload = json.dumps(manifest, indent=3)

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", payload)
        for spec in SCRIPTS:
            archive.write(os.path.join(HERE, spec["file"]), "scripts/" + spec["file"])

    print("written    %s" % os.path.basename(OUT))
    print("           %d buttons, %d scripts baked in, %d bytes"
          % (len(SCRIPTS), len(SCRIPTS), os.path.getsize(OUT)))
    for spec in SCRIPTS:
        print("             [%-8s] %s" % (spec["label"], spec["file"]))


if __name__ == "__main__":
    main()
