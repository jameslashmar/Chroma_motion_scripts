/**
 * Chroma - Strip PSR keys + parent
 *
 * Select the original layer and its duplicate(s). The duplicate loses
 * its Position, Scale and Rotation keyframes and is parented to the
 * original.
 *
 * Silent when it works. A dialog only when something could not be done,
 * because a kBar button has nowhere to put a line of status text.
 *
 * One action and no UI of its own, so it suits a kBar button or a
 * keyboard shortcut. Unlike the panel it never reads Alt -- see
 * altPressed() below for why.
 *
 * GENERATED FILE -- do not edit this, edit the panel and rebuild:
 *   Source:  aftereffects/ScriptUI Panels/Chroma Utilities Mini.jsx
 *   Rebuild: python3 aftereffects/kbar/build_kbar.py
 *
 * Windows + macOS. ExtendScript only: no shell calls, no platform branches.
 *
 * Install: anywhere kBar can reach it. Dropped in
 * <AE install>/Support Files/Scripts/ it also appears under
 * File > Scripts, where Edit > Keyboard Shortcuts can bind it to a key.
 */

(function ChromaStripPSR() {

    var SCRIPT_NAME = "Chroma - Strip PSR keys + parent";

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

        var ranked = rankLayers(selected, altPressed());
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

    stripAndParent("psr");

})();
