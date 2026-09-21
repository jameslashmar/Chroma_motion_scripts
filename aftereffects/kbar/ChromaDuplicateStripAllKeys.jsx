/**
 * Chroma - Duplicate + strip all keyframes
 *
 * As ChromaDuplicateStripPSR, but the copy loses every keyframe on the
 * layer -- transform, effects, masks, text, shapes, styles -- and not
 * only the three transform sets. Markers and expressions are left.
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

(function ChromaDuplicateStripAllKeys() {

    var SCRIPT_NAME = "Chroma - Duplicate + strip all keyframes";

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

    var MODE_LABELS = {
        position: "Position",
        rotation: "Rotation",
        scale: "Scale",
        psr: "PSR",
        all: "all"
    };

    /**
     * The one-layer version: make the duplicate as well. Select the animated
     * layer, click once, and it is duplicated, the copy is stripped and the
     * copy is parented to it -- the same end state as duplicating by hand and
     * then clicking PSR, in a single undo step.
     *
     * Several selected layers each get their own duplicate, parented to
     * themselves and not to each other, and the duplicates are left selected
     * because the duplicate is the layer you go on to animate.
     *
     * No loop check here, unlike stripAndParent: a layer created a moment ago
     * cannot already be somewhere in its source's parent chain.
     */
    function duplicateStripParent(mode) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) {
            alert("Open a composition first.", SCRIPT_NAME);
            return;
        }
        var originals = comp.selectedLayers;
        if (!originals.length) {
            alert("Select the layer to duplicate.", SCRIPT_NAME);
            return;
        }

        var time = comp.time;
        var removed = 0;
        var made = [];
        var notDuplicated = [];
        var notParented = [];

        app.beginUndoGroup("Chroma: Duplicate + strip " + MODE_LABELS[mode] + " keys + parent");
        try {
            for (var i = 0; i < originals.length; i++) {
                var original = originals[i];
                var dup = null;
                try {
                    dup = original.duplicate();
                } catch (e) {
                    notDuplicated.push(original.name);
                    continue;
                }

                // The duplicate of a locked layer is locked too, and a locked
                // layer takes neither key removal nor a parent. Unlock it for
                // the work; the lock goes back on at the end.
                var relock = false;
                try {
                    if (dup.locked) {
                        dup.locked = false;
                        relock = true;
                    }
                } catch (e) {}

                removed += stripLayer(dup, mode, time);

                try {
                    dup.parent = original;
                } catch (e) {
                    notParented.push(dup.name);
                }
                made.push({ layer: dup, relock: relock });
            }

            for (var d = 0; d < originals.length; d++) {
                try { originals[d].selected = false; } catch (e) {}
            }
            for (var m = 0; m < made.length; m++) {
                try { made[m].layer.selected = true; } catch (e) {}
            }

            // Locks go back on last, because a locked layer cannot be selected.
            for (var r = 0; r < made.length; r++) {
                if (made[r].relock) {
                    try { made[r].layer.locked = true; } catch (e) {}
                }
            }
        } catch (e) {
            alert("Error: " + e.toString(), SCRIPT_NAME);
            return;
        } finally {
            app.endUndoGroup();
        }

        // Silent on success, like the strip buttons: the new layer is there in
        // the timeline to see. Only what did not happen is worth a dialog.
        if (notDuplicated.length || notParented.length) {
            var message = plural(removed, MODE_LABELS[mode] + " key") + " removed on " +
                plural(made.length, "duplicate") + ".";
            if (notDuplicated.length) message += "\nNot duplicated: " + notDuplicated.join(", ");
            if (notParented.length) message += "\nNot parented: " + notParented.join(", ");
            alert(message, SCRIPT_NAME);
        }
    }

    duplicateStripParent("all");

})();
