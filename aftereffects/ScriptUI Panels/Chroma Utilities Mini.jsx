/**
 * Chroma Utilities Mini
 *
 * The one-row toolbar version of Chroma Utilities: the same tools, no
 * status line, sized to sit in a strip above the timeline or down the side
 * of the Project panel. Dock it and forget it.
 *
 *   Project    [folders]                  Create Shot Folders dialog
 *   Parenting  [P] [S] [R] [PSR] [keys]   Strip keys from duplicate, parent to original
 *
 * P, S, R and PSR strip Position, Scale, Rotation or all three; the
 * keyframes icon strips every keyframe on the layer. Select the original
 * and its duplicate(s) first; hold Alt (Option) while clicking to swap
 * which is the original. The tool logic is a copy of the full panel's --
 * see Chroma Utilities.jsx for how the original is inferred and what is
 * left alone.
 *
 * Failures come up as dialogs; success is silent.
 *
 * All six buttons are drawn by one function, so they cannot drift apart.
 * After Effects leaves no way to have it draw them: a ScriptUI "iconbutton"
 * comes out round whatever size it is given, and graphics.drawOSControl() --
 * the documented way to ask for the native frame underneath a custom onDraw
 * -- silently paints nothing here, which is why the icon buttons had no
 * frame and no rollover. So the frame, the rollover and the pressed state
 * are drawn by hand, in colours sampled from After Effects itself and scaled
 * to whatever UI brightness is set.
 *
 * The icons are embedded as PNG bytes rather than kept beside the script,
 * so this stays a single-file install. Icons: Royyan Wijaya, The Noun
 * Project.
 *
 * Windows + macOS. ExtendScript only: no shell calls, no platform branches.
 *
 * Install: <AE install>/Support Files/Scripts/ScriptUI Panels/
 * Then: Window > Chroma Utilities Mini
 */

(function chromaUtilitiesMini(thisObj) {

    var SCRIPT_NAME = "Chroma Utilities Mini";

    // Transform properties by match name. Position and rotation each have
    // several: separated dimensions for position, the three axes plus
    // orientation for 3D layers. Missing ones (cameras have no scale, 2D
    // layers keep hidden X/Y rotation) are simply skipped.
    var TRANSFORM_SETS = {
        position: ["ADBE Position", "ADBE Position_0", "ADBE Position_1", "ADBE Position_2"],
        rotation: ["ADBE Rotate Z", "ADBE Rotate X", "ADBE Rotate Y", "ADBE Orientation"],
        scale: ["ADBE Scale"]
    };

    // Keyframes on these are not what anyone means by "keyframes".
    var SKIP_MATCH_NAMES = { "ADBE Marker": true };

    // "Hero 2" -> stem "Hero", 2 · "SHOT_010" -> "SHOT", 10 · "Hero" -> "Hero", null
    var TRAILING_NUMBER_RE = /^(.*?)[\s_\-]*(\d+)$/;

    // ---------------------------------------------------------------- helpers

    function padNumber(num, width) {
        var s = "" + Math.abs(num);
        while (s.length < width) s = "0" + s;
        return (num < 0 ? "-" : "") + s;
    }

    function parseIntStrict(value) {
        // NaN unless the whole string is a clean integer
        if (!/^-?\d+$/.test(value)) return NaN;
        return parseInt(value, 10);
    }

    function splitName(name) {
        var text = String(name || "");
        var match = text.match(TRAILING_NUMBER_RE);
        if (match) {
            return { stem: match[1].replace(/\s+$/, "").toLowerCase(), num: parseInt(match[2], 10) };
        }
        return { stem: text.replace(/\s+$/, "").toLowerCase(), num: null };
    }

    function plural(count, noun) {
        return count + " " + noun + (count === 1 ? "" : "s");
    }

    // ----------------------------------------------------- create shot folders

    /**
     * The Create Shot Folders dialog. Returns a one-line summary (unused
     * here -- the mini panel has no status line), or null if cancelled.
     */
    function createShotFolders() {
        var dlg = new Window("dialog", "Create Shot Folders");
        dlg.alignChildren = ["fill", "top"];
        dlg.spacing = 10;
        dlg.margins = 16;

        function addRow(parent, labelText, defaultValue) {
            var row = parent.add("group");
            row.alignment = ["fill", "top"];
            var lbl = row.add("statictext", undefined, labelText);
            lbl.preferredSize.width = 150;
            var fld = row.add("edittext", undefined, "" + defaultValue);
            fld.characters = 12;
            fld.alignment = ["fill", "center"];
            return fld;
        }

        var prefixFld = addRow(dlg, "Prefix:", "SHOT");
        var padFld = addRow(dlg, "Padding (digits):", 3);
        var startFld = addRow(dlg, "Start number:", 1);
        var stepFld = addRow(dlg, "Increment / step:", 1);
        var countFld = addRow(dlg, "How many shots:", 10);

        var parentGroup = dlg.add("group");
        parentGroup.alignment = ["fill", "top"];
        var parentChk = parentGroup.add("checkbox", undefined, "Group inside a parent folder named:");
        parentChk.value = false;
        var parentNameFld = parentGroup.add("edittext", undefined, "SHOTS");
        parentNameFld.characters = 12;
        parentNameFld.enabled = false;
        parentChk.onClick = function () { parentNameFld.enabled = this.value; };

        var preview = dlg.add("statictext", undefined, "");
        preview.alignment = ["fill", "top"];
        preview.graphics.font = ScriptUI.newFont(
            preview.graphics.font.name, "ITALIC", preview.graphics.font.size);

        function updatePreview() {
            var prefix = prefixFld.text;
            var pad = parseIntStrict(padFld.text);
            var start = parseIntStrict(startFld.text);
            var step = parseIntStrict(stepFld.text);
            var count = parseIntStrict(countFld.text);
            if (isNaN(pad) || isNaN(start) || isNaN(step) || isNaN(count) ||
                count < 1 || pad < 0 || step === 0) {
                preview.text = "Preview: —";
                return;
            }
            var first = prefix + padNumber(start, pad);
            var last = prefix + padNumber(start + step * (count - 1), pad);
            preview.text = (count === 1)
                ? ("Preview: " + first)
                : ("Preview: " + first + "  …  " + last + "   (" + count + " folders)");
        }

        var watchFields = [prefixFld, padFld, startFld, stepFld, countFld];
        for (var i = 0; i < watchFields.length; i++) watchFields[i].onChanging = updatePreview;
        updatePreview();

        var btns = dlg.add("group");
        btns.alignment = ["fill", "top"];
        btns.alignChildren = ["right", "center"];
        btns.add("button", undefined, "Cancel", { name: "cancel" });
        btns.add("button", undefined, "Create", { name: "ok" });

        if (dlg.show() !== 1) return null;

        var prefix = prefixFld.text;
        var pad = parseIntStrict(padFld.text);
        var start = parseIntStrict(startFld.text);
        var step = parseIntStrict(stepFld.text);
        var count = parseIntStrict(countFld.text);

        if (isNaN(pad) || pad < 0) {
            alert("Padding must be a whole number (0 or more).", SCRIPT_NAME);
            return null;
        }
        if (isNaN(start)) {
            alert("Start number must be a whole number.", SCRIPT_NAME);
            return null;
        }
        if (isNaN(step) || step === 0) {
            alert("Step / increment must be a whole number and not zero.", SCRIPT_NAME);
            return null;
        }
        if (isNaN(count) || count < 1) {
            alert("Number of shots must be a whole number of 1 or more.", SCRIPT_NAME);
            return null;
        }
        if (count > 5000) {
            if (!confirm("That will create " + count + " folders. Continue?", false, SCRIPT_NAME)) {
                return null;
            }
        }

        var firstName = prefix + padNumber(start, pad);
        var lastName = prefix + padNumber(start + step * (count - 1), pad);

        app.beginUndoGroup("Create Shot Folders");
        try {
            var parentFolder = null;
            if (parentChk.value && parentNameFld.text !== "") {
                parentFolder = app.project.items.addFolder(parentNameFld.text);
            }
            for (var n = 0; n < count; n++) {
                var folder = app.project.items.addFolder(prefix + padNumber(start + step * n, pad));
                if (parentFolder !== null) folder.parentFolder = parentFolder;
            }
        } catch (e) {
            alert("Error creating folders:\n" + e.toString(), SCRIPT_NAME);
            return null;
        } finally {
            app.endUndoGroup();
        }

        return "Created " + plural(count, "folder") +
            (count === 1 ? ": " + firstName : ": " + firstName + " … " + lastName) +
            (parentFolder ? " in " + parentFolder.name : "");
    }

    // ------------------------------------------------------- strip + parent

    /**
     * Remove every keyframe from one property, leaving it static at the value
     * it had at `time`. Returns the number of keys removed.
     */
    function stripKeys(prop, time) {
        var count;
        try {
            if (!prop || prop.propertyType !== PropertyType.PROPERTY) return 0;
            if (!prop.canVaryOverTime) return 0;
            count = prop.numKeys;
        } catch (e) {
            return 0;
        }
        if (!count) return 0;

        var held = null;
        var haveValue = false;
        try {
            held = prop.valueAtTime(time, true); // pre-expression: the keyed value
            haveValue = true;
        } catch (e) {}

        try {
            while (prop.numKeys > 0) prop.removeKey(1);
        } catch (e) {
            // Whatever is left is reported honestly in the count.
        }
        var removed = count - prop.numKeys;

        if (haveValue && prop.numKeys === 0) {
            try {
                prop.setValue(held);
            } catch (e) {}
        }
        return removed;
    }

    function stripTransformSet(layer, matchNames, time) {
        var removed = 0;
        var transform = null;
        try {
            transform = layer.property("ADBE Transform Group");
        } catch (e) {}
        if (!transform) return 0;

        for (var i = 0; i < matchNames.length; i++) {
            var prop = null;
            try {
                prop = transform.property(matchNames[i]);
            } catch (e) {}
            if (prop) removed += stripKeys(prop, time);
        }
        return removed;
    }

    function stripEverything(group, time) {
        var removed = 0;
        var total = 0;
        try {
            total = group.numProperties;
        } catch (e) {
            return 0;
        }
        for (var i = 1; i <= total; i++) {
            var prop = null;
            try {
                prop = group.property(i);
            } catch (e) {}
            if (!prop) continue;
            try {
                if (SKIP_MATCH_NAMES[prop.matchName]) continue;
                if (prop.propertyType === PropertyType.PROPERTY) {
                    removed += stripKeys(prop, time);
                } else {
                    removed += stripEverything(prop, time);
                }
            } catch (e) {}
        }
        return removed;
    }

    function stripLayer(layer, mode, time) {
        if (mode === "all") return stripEverything(layer, time);

        var removed = 0;
        if (mode === "position" || mode === "psr") {
            removed += stripTransformSet(layer, TRANSFORM_SETS.position, time);
        }
        if (mode === "rotation" || mode === "psr") {
            removed += stripTransformSet(layer, TRANSFORM_SETS.rotation, time);
        }
        if (mode === "scale" || mode === "psr") {
            removed += stripTransformSet(layer, TRANSFORM_SETS.scale, time);
        }
        return removed;
    }

    /**
     * Rank the selected layers, original first. Names that differ only by a
     * trailing number rank by that number (none, then ascending); anything
     * else ranks by stack position, lowest layer first, since a duplicate is
     * created directly above its source. `reverse` flips the whole order.
     */
    function rankLayers(layers, reverse) {
        var ranked = [];
        for (var i = 0; i < layers.length; i++) {
            ranked.push({ layer: layers[i], parsed: splitName(layers[i].name), index: layers[i].index });
        }

        var sameStem = true;
        for (i = 1; i < ranked.length; i++) {
            if (ranked[i].parsed.stem !== ranked[0].parsed.stem) {
                sameStem = false;
                break;
            }
        }

        ranked.sort(function (a, b) {
            if (sameStem) {
                var an = a.parsed.num;
                var bn = b.parsed.num;
                if (an === null && bn !== null) return -1;
                if (bn === null && an !== null) return 1;
                if (an !== null && bn !== null && an !== bn) return an - bn;
            }
            return b.index - a.index;
        });

        if (reverse) ranked.reverse();
        return ranked;
    }

    function isDescendantOf(layer, ancestor) {
        var guard = 0;
        var current = layer;
        while (current && guard++ < 500) {
            var parent = null;
            try {
                parent = current.parent;
            } catch (e) {}
            if (!parent) return false;
            if (parent === ancestor || parent.index === ancestor.index) return true;
            current = parent;
        }
        return false;
    }

    var MODE_LABELS = {
        position: "Position",
        rotation: "Rotation",
        scale: "Scale",
        psr: "PSR",
        all: "all"
    };

    function stripAndParent(mode) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) {
            alert("Open a composition first.", SCRIPT_NAME);
            return;
        }
        var selected = comp.selectedLayers;
        if (selected.length < 2) {
            alert("Select the original layer and its duplicate(s).", SCRIPT_NAME);
            return;
        }

        var swap = false;
        try {
            swap = ScriptUI.environment.keyboardState.altKey;
        } catch (e) {}

        var ranked = rankLayers(selected, swap);
        var original = ranked[0].layer;
        var time = comp.time;

        var removed = 0;
        var parented = 0;
        var failed = [];

        app.beginUndoGroup("Chroma: Strip " + MODE_LABELS[mode] + " keys + parent");
        try {
            for (var i = 1; i < ranked.length; i++) {
                var dup = ranked[i].layer;
                removed += stripLayer(dup, mode, time);

                if (isDescendantOf(original, dup)) {
                    // Parenting would make a loop; AE refuses, so say why.
                    failed.push(dup.name + " (is a parent of " + original.name + ")");
                    continue;
                }
                try {
                    dup.parent = original;
                    parented++;
                } catch (e) {
                    failed.push(dup.name);
                }
            }
        } catch (e) {
            alert("Error: " + e.toString(), SCRIPT_NAME);
            return;
        } finally {
            app.endUndoGroup();
        }

        // No status line on the mini panel: success is silent (the result is
        // visible in the comp), only a refused parent is worth a dialog.
        if (failed.length) {
            alert(plural(removed, MODE_LABELS[mode] + " key") + " removed" +
                (parented ? ", " + plural(parented, "layer") + " parented" : "") +
                ".\nNot parented: " + failed.join(", "), SCRIPT_NAME);
        }
    }

    // ------------------------------------------------------------------ icons

    // 20x20 white-on-transparent PNGs, byte for byte.
    var ICON_FOLDERS_PNG =
        "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00\x14\x00\x00\x00\x14\x08\x06\x00\x00\x00" +
        "\x8D\x89\x1D\x0D\x00\x00\x00\x09pHYs\x00\x00\x00\xDD\x00\x00\x00\xDD\x01pS\xA2\x07\x00\x00\x00" +
        "\xD4IDAT8\x8D\xED\x94\xDD\x0D\x820\x14\x85?\x88\x030\x02#t\x03\x19\xC1\x11\x18\xC1Q\xDC@Wp\x03" +
        "\xDC\xA0#8\x02\x1B\x1C\x1F\xB8%\x15hm\x22\x0F>x\x92\x9B\x94\xDE\xC3\xD7\xBF\xDC[IbO\x1D2\xB9." +
        "\x1A\x8F\x80\xFF\x06\xE8\x816\x828`\x00z\x83\xA7%i\x19\x9D\xA4Q\x92\x8B\xE6\x1AI^\xD2e\xC3\xFF" +
        "\x16\xCB\x09g\xC0a\xC3\xEC\x94\xD6\xBCP\xFC\x837P\x0A\x98\x8A\xDE\xA0\x9D$\xEA\xE8\x01Z\xE0\x5Cr" +
        "\xF1\x0B\xDD\x80G\xF8\xA8\xA3\x84\xA7\xF0%s\xAA?[\xFE\xC0_\x00\x8E\xC0\x91\xA9\xCCJ\xE4,\x80\xED" +
        "Z\xF6\xC0\x1D\xB8\x16B\x1D\xF0d\xAA\xF5ds8\x99\xB1)\xDC\xE50\x8F2\x0D!\x17\xCE\xCAs\xE5\xAF\xAC" +
        "\xC16\xB6JKY\xB5\x84c\xBAe\x22\x00\x03te(:f\x02\xB8\x8B^a\x88\x22\x015\x0E\xEA\xAF\x00\x00\x00" +
        "\x00IEND\xAEB`\x82";

    var ICON_KEYFRAMES_PNG =
        "\x89PNG\x0D\x0A\x1A\x0A\x00\x00\x00\x0DIHDR\x00\x00\x00\x14\x00\x00\x00\x14\x08\x06\x00\x00\x00" +
        "\x8D\x89\x1D\x0D\x00\x00\x00\x09pHYs\x00\x00\x00\xDD\x00\x00\x00\xDD\x01pS\xA2\x07\x00\x00\x00" +
        "\xECIDAT8\x8D\xCD\x94a\x0D\x83@\x0C\x85\xCB2\x01H@\x02\x12\x90\x80\x04$ \x05\x09H@\x02\x12n\x0E&" +
        "\x01\x07\xDF~\xF0n#\xB7\x1E\xD9\x16H\xD6\xA4\xB9r\xED{\x05\xEE]\x0B\xC0\x8E\xB4\xCB\xA1lg\x10^wr" +
        "\x8D\xD6\xC5\xCC\x82\xE2\xDA\xCCJ\xC5\xB3\x8B\x02<\xEF\x81\x05\x18X\xAD\x02j\xC5\x83r\xBD\x87" +
        "\xF5\xC8:\x01[=\xB7\x22\x8B\x0D\xE2\x1E\xAA\xDD%\x8C\xC0ma\x09\x04`t\x1A/\xC2\xB8\x84\x95\x0AR`" +
        "\x90\x97\xCE\xD7\x8C\xC2T\x1Ea\x00\xA6\x040\x00\xF7\x0CY\xF4I\xD87B\x1C\xE0\xBC\xF9\x979/\x855" +
        "\xE0\x5Ca\xDF\xCClJ\xF2\xC1\xCCF{i\xCF\xB3I\xD8\xD5\x92W\xF7\x0Ee\xFE\xE0P\x9E\xB9\x9Cl\xFA\xA4" +
        "\x91w`Q\xFCY\xD9DOE\xDB9\x92J\xC5\xBFK\xB8\x15\xED\xBC\xD1Y\x9D\xEC\xBD\xDD\x12\xC0\x0A\xF2\xF3" +
        "\xB0\xD1\xFA\xD5p\xD8#\xFC\xC9\xFE\x7F\xC0>\x00\xE11\x9Bk\xF5\xF9\xB4L\x00\x00\x00\x00IEND\xAEB`" +
        "\x82";

    /**
     * ScriptUI takes the PNG bytes directly as a string. If this build will
     * not, fall back to writing them to the temp folder and loading from
     * there. Returns null if neither works; the button then keeps its text.
     */
    function embeddedImage(pngBytes, fileName) {
        var img = null;
        try {
            img = ScriptUI.newImage(pngBytes);
            if (img && img.size && img.size[0] > 0) return img;
        } catch (e) {}
        try {
            var file = new File(Folder.temp.fsName + "/" + fileName);
            file.encoding = "BINARY";
            if (file.open("w")) {
                file.write(pngBytes);
                file.close();
            }
            if (file.exists) {
                img = ScriptUI.newImage(file);
                if (img && img.size && img.size[0] > 0) return img;
            }
        } catch (e) {}
        return null;
    }

    // ---------------------------------------------------------------------- UI

    // Square, and big enough for a 20px icon inside a frame or for "PSR".
    var BUTTON_SIZE = 30;
    var CORNER_RADIUS = 3;

    /**
     * After Effects 2026, default UI brightness, sampled off a screenshot of
     * this panel: the dock is #1d1d1d, a button face is #0e0e0e and its
     * border #303030, with lettering around #b0b0b0. Everything is expressed
     * as a multiple of the dock colour so that a different UI brightness --
     * the Appearance slider in Preferences -- carries the buttons with it,
     * when the background can be read back at all.
     */
    var BASE_BACKGROUND = 29 / 255;
    var FACE_RATIO = 14 / 29;
    var BORDER_RATIO = 48 / 29;
    var TEXT_RATIO = 176 / 29;

    // Hover and pressed are the same face, lifted. AE lightens the border on
    // hover and the whole face on press.
    var HOVER_BORDER_LIFT = 1.9;
    var DOWN_FACE_LIFT = 2.6;

    var TOOL_SUFFIX = " from the duplicate, then parent it to the original. " +
        "Select the original and its duplicate(s) first; Alt-click to swap.";

    function clamp01(value) {
        if (value < 0) return 0;
        if (value > 1) return 1;
        return value;
    }

    function grey(level) {
        var v = clamp01(level);
        return [v, v, v, 1];
    }

    /**
     * The dock's background as a 0..1 grey, so the button palette can be
     * derived from it. Falls back to the sampled default when ScriptUI will
     * not report a colour, which is the common case.
     */
    function backgroundLevel(win) {
        try {
            var bg = win.graphics.backgroundColor;
            if (bg && bg.color && bg.color.length >= 3) {
                var level = (bg.color[0] + bg.color[1] + bg.color[2]) / 3;
                // A reported black or white is ScriptUI declining to answer
                // rather than a real dock colour; don't build a palette on it.
                if (level > 0.02 && level < 0.98) return level;
            }
        } catch (e) {}
        return BASE_BACKGROUND;
    }

    /**
     * Trace a rounded rectangle. ScriptUI's path API has lines and nothing
     * else, so each corner is a short fan of segments; at a 3px radius four
     * of them per corner is already indistinguishable from an arc.
     */
    function roundRectPath(g, x, y, w, h, r) {
        var pts = [];
        var segments = 4;
        var corners = [
            [x + w - r, y + r, -Math.PI / 2, 0],           // top right
            [x + w - r, y + h - r, 0, Math.PI / 2],        // bottom right
            [x + r, y + h - r, Math.PI / 2, Math.PI],      // bottom left
            [x + r, y + r, Math.PI, Math.PI * 1.5]         // top left
        ];
        for (var c = 0; c < corners.length; c++) {
            var cx = corners[c][0], cy = corners[c][1];
            var a0 = corners[c][2], a1 = corners[c][3];
            for (var i = 0; i <= segments; i++) {
                var a = a0 + (a1 - a0) * (i / segments);
                pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
        }
        g.newPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (var p = 1; p < pts.length; p++) g.lineTo(pts[p][0], pts[p][1]);
        g.closePath();
    }

    /**
     * Draw one button: the frame, then either its icon or its letters.
     *
     * Every button on the panel is drawn by this one function, which is the
     * point of it. Two things rule out letting After Effects draw them: a
     * ScriptUI "iconbutton" comes out round whatever size it is given, and
     * graphics.drawOSControl() -- the documented way to ask for the native
     * frame under a custom onDraw -- silently paints nothing here. Mixing a
     * native widget with a hand-drawn one gives a row that does not match,
     * so nothing is native and the row matches itself.
     */
    function drawButton() {
        var g = this.graphics;
        var w = this.size.width;
        var h = this.size.height;
        var level = this.chromaLevel || BASE_BACKGROUND;
        var state = this.chromaState || "normal";

        var face = level * FACE_RATIO;
        var border = level * BORDER_RATIO;
        if (state === "hover") {
            border = border * HOVER_BORDER_LIFT;
        } else if (state === "down") {
            face = face * DOWN_FACE_LIFT;
            border = border * HOVER_BORDER_LIFT;
        }

        // Half-pixel inset so the 1px stroke lands on the pixel, not across it
        roundRectPath(g, 0.5, 0.5, w - 1, h - 1, CORNER_RADIUS);
        try {
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, grey(face)));
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, grey(border), 1));
        } catch (e) {}

        var img = this.chromaImage;
        if (img) {
            try {
                g.drawImage(img,
                    Math.round((w - img.size[0]) / 2),
                    Math.round((h - img.size[1]) / 2));
            } catch (e) {}
            return;
        }

        var label = this.chromaLabel || "";
        if (!label) return;
        try {
            var font = g.font;
            var dim = g.measureString(label, font);
            // "PSR" does not fit a 30px button at the default size
            if (dim.width > w - 6) {
                font = ScriptUI.newFont(font.name, font.style,
                    Math.max(9, font.size - 2));
                dim = g.measureString(label, font);
            }
            g.drawString(label,
                g.newPen(g.PenType.SOLID_COLOR, grey(level * TEXT_RATIO), 1),
                Math.round((w - dim.width) / 2),
                Math.round((h - dim.height) / 2),
                font);
        } catch (e) {}
    }

    /**
     * Ask for a repaint. ScriptUI has no invalidate(); notify("onDraw") is
     * the usual way and works in After Effects, but if a build disagrees,
     * nudging the size forces the same thing. Without this the hover and
     * pressed states would be computed and never shown.
     */
    function redraw(control) {
        try {
            control.notify("onDraw");
            return;
        } catch (e) {}
        try {
            control.size = [control.size.width, control.size.height];
        } catch (e) {}
    }

    function trackState(btn) {
        if (!btn.addEventListener) return;
        function set(state) {
            return function () {
                btn.chromaState = state;
                redraw(btn);
            };
        }
        try {
            btn.addEventListener("mouseover", set("hover"));
            btn.addEventListener("mouseout", set("normal"));
            btn.addEventListener("mousedown", set("down"));
            btn.addEventListener("mouseup", set("hover"));
        } catch (e) {}
    }

    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        win.orientation = "row";
        win.alignChildren = ["left", "top"];
        win.spacing = 6;
        win.margins = 6;

        var level = backgroundLevel(win);

        var buttons = [
            { section: "Project", label: "Shots", action: "folders",
              png: ICON_FOLDERS_PNG, file: "chroma-mini-folders.png",
              tip: "Create Shot Folders: numbered shot bins in the Project panel, " +
                   "SHOT001 … SHOT010." },
            { section: "Parenting", label: "P", action: "position",
              tip: "Remove Position keyframes (including separated X/Y/Z)" + TOOL_SUFFIX },
            { section: "Parenting", label: "S", action: "scale",
              tip: "Remove Scale keyframes" + TOOL_SUFFIX },
            { section: "Parenting", label: "R", action: "rotation",
              tip: "Remove Rotation keyframes (X/Y/Z and Orientation on 3D layers)" +
                   TOOL_SUFFIX },
            { section: "Parenting", label: "PSR", action: "psr",
              tip: "Remove Position, Scale and Rotation keyframes" + TOOL_SUFFIX },
            { section: "Parenting", label: "All", action: "all",
              png: ICON_KEYFRAMES_PNG, file: "chroma-mini-all.png",
              tip: "Remove every keyframe on the layer -- transform, effects, masks, " +
                   "text, shapes, styles -- but not markers or expressions" + TOOL_SUFFIX }
        ];

        function guarded(fn) {
            return function () {
                try {
                    fn();
                } catch (e) {
                    alert("Error: " + e.toString(), SCRIPT_NAME);
                }
            };
        }

        function handler(action) {
            if (action === "folders") {
                return guarded(function () { createShotFolders(); });
            }
            return guarded(function () { stripAndParent(action); });
        }

        var sections = {};
        for (var i = 0; i < buttons.length; i++) {
            var spec = buttons[i];

            var section = sections[spec.section];
            if (!section) {
                section = win.add("panel", undefined, spec.section);
                section.orientation = "row";
                section.alignChildren = ["center", "center"];
                section.margins = [6, 12, 6, 6];
                section.spacing = 4;
                sections[spec.section] = section;
            }

            // The text is still set even though onDraw paints the label: if a
            // build ever ignores onDraw, a plain readable button is a better
            // failure than a blank one.
            var btn = section.add("button", undefined, spec.label);

            // Held on the button so they outlive this loop and are there for
            // every repaint.
            btn.chromaImage = spec.png ? embeddedImage(spec.png, spec.file) : null;
            btn.chromaLabel = spec.label;
            btn.chromaLevel = level;
            btn.chromaState = "normal";
            btn.onDraw = drawButton;
            trackState(btn);

            // preferredSize rather than size: layout(true) recomputes from
            // preferredSize and would throw a fixed size away.
            btn.preferredSize = [BUTTON_SIZE, BUTTON_SIZE];
            btn.minimumSize = [BUTTON_SIZE, BUTTON_SIZE];
            btn.maximumSize = [BUTTON_SIZE, BUTTON_SIZE];
            btn.alignment = ["center", "center"];
            btn.helpTip = spec.tip;
            btn.onClick = handler(spec.action);
        }

        win.onResizing = win.onResize = function () {
            this.layout.resize();
        };

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
            win.layout.resize();
        }

        return win;
    }

    buildUI(thisObj);

})(this);
