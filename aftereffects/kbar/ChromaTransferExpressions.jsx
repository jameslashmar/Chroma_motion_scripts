/**
 * Chroma - Transfer expressions
 *
 * Click the source layer, then the target(s), and run this. Every
 * expression on the source is copied to each target -- or, with a
 * property selected on the source, only the expressions it covers.
 *
 * Expressions only: keyframes and values are left alone, and a
 * property the target does not have is reported, not created.
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

(function ChromaTransferExpressions() {

    var SCRIPT_NAME = "Chroma - Transfer expressions";

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

    function plural(count, noun) {
        return count + " " + noun + (count === 1 ? "" : "s");
    }

    /**
     * Where a property sits on its layer, as steps from the layer down, so
     * the same property can be found on another layer. Null if the property
     * can't be walked.
     */
    function propertyPath(prop) {
        var steps = [];
        var current = prop;
        var guard = 0;
        try {
            while (current && current.propertyDepth > 0 && guard++ < 100) {
                var parent = current.parentProperty;
                steps.unshift({
                    matchName: current.matchName,
                    name: current.name,
                    index: current.propertyIndex,
                    // Children of an indexed group -- effects, masks, shape
                    // groups, text animators -- share match names.
                    indexed: current.propertyDepth > 1 &&
                        parent.propertyType === PropertyType.INDEXED_GROUP
                });
                current = parent;
            }
        } catch (e) {
            return null;
        }
        return steps.length ? steps : null;
    }

    function pathKey(steps) {
        var parts = [];
        for (var i = 0; i < steps.length; i++) parts.push(steps[i].index);
        return parts.join("/");
    }

    // "Position", "Slider Control › Slider", "Box › Rectangle Path 1 › Size":
    // the top-level group (Transform, Effects, Masks, Contents) and a shape
    // group's own inner Contents are noise.
    function pathLabel(steps) {
        var names = [];
        for (var i = (steps.length > 1 ? 1 : 0); i < steps.length; i++) {
            if (steps[i].matchName !== "ADBE Vectors Group") names.push(steps[i].name);
        }
        return names.join(" › ");
    }

    /**
     * The same property on another layer, or null. Named groups are found by
     * match name. An indexed group's child is found by name, then by
     * position, and has to be the same kind of thing either way, so a Blur
     * expression never lands on whatever effect happens to be second.
     */
    function resolvePath(layer, steps) {
        var current = layer;
        for (var i = 0; i < steps.length; i++) {
            var step = steps[i];
            var next = null;
            if (step.indexed) {
                try {
                    next = current.property(step.name);
                } catch (e) {}
                if (!next || next.matchName !== step.matchName) {
                    next = null;
                    try {
                        if (step.index <= current.numProperties) next = current.property(step.index);
                    } catch (e) {}
                    if (next && next.matchName !== step.matchName) next = null;
                }
            } else {
                try {
                    next = current.property(step.matchName);
                } catch (e) {}
            }
            if (!next) return null;
            current = next;
        }
        return current;
    }

    function hasExpression(prop) {
        try {
            return prop.propertyType === PropertyType.PROPERTY &&
                prop.canSetExpression && prop.expression !== "";
        } catch (e) {
            return false;
        }
    }

    function collectExpressions(group, found) {
        var total = 0;
        try {
            total = group.numProperties;
        } catch (e) {
            return;
        }
        for (var i = 1; i <= total; i++) {
            var prop = null;
            try {
                prop = group.property(i);
            } catch (e) {}
            if (!prop) continue;
            try {
                if (prop.propertyType === PropertyType.PROPERTY) {
                    if (hasExpression(prop)) found.push(prop);
                } else {
                    collectExpressions(prop, found);
                }
            } catch (e) {}
        }
    }

    /**
     * The expressions a layer's property selection covers. A selected group
     * (an effect, Transform, a shape group) covers everything inside it --
     * unless something inside it is selected as well, as happens when
     * clicking an effect's parameter selects the effect too. Then only the
     * inner selection counts.
     */
    function selectedExpressions(layer) {
        var selected = [];
        try {
            selected = layer.selectedProperties;
        } catch (e) {}

        var keys = [];
        for (var i = 0; i < selected.length; i++) {
            var steps = propertyPath(selected[i]);
            keys.push(steps ? pathKey(steps) : null);
        }

        var found = [];
        for (i = 0; i < selected.length; i++) {
            var prop = selected[i];
            if (keys[i] === null) continue;
            try {
                if (prop.propertyType === PropertyType.PROPERTY) {
                    if (hasExpression(prop)) found.push(prop);
                    continue;
                }
            } catch (e) {
                continue;
            }
            var narrowed = false;
            for (var k = 0; k < keys.length; k++) {
                if (keys[k] !== null && keys[k].indexOf(keys[i] + "/") === 0) {
                    narrowed = true;
                    break;
                }
            }
            if (!narrowed) collectExpressions(prop, found);
        }
        return found;
    }

    function hasSelectedProperties(layer) {
        try {
            return layer.selectedProperties.length > 0;
        } catch (e) {
            return false;
        }
    }

    /**
     * Copy expressions from one selected layer to every other selected
     * layer. Only the expression text and its on/off switch travel: no
     * keyframes, no values, and nothing is created on a target that lacks
     * the property.
     *
     * With properties selected, only those are copied; otherwise every
     * expression on the layer. The source is the selected layer that has
     * expressions to give. If several have, it is the one clicked first --
     * or last, with Alt held.
     *
     * Returns what happened, for the caller to report: { error } when
     * nothing was attempted.
     */
    function transferExpressions() {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) return { error: "Open a composition first." };
        var selected = comp.selectedLayers;
        if (selected.length < 2) {
            return { error: "Select the source layer, then the layer(s) to copy its expressions to." };
        }

        var byProperty = false;
        for (var i = 0; i < selected.length; i++) {
            if (hasSelectedProperties(selected[i])) {
                byProperty = true;
                break;
            }
        }

        var candidates = [];
        for (i = 0; i < selected.length; i++) {
            var props = [];
            if (byProperty) {
                props = selectedExpressions(selected[i]);
            } else {
                collectExpressions(selected[i], props);
            }
            if (props.length) candidates.push({ layer: selected[i], props: props });
        }
        if (!candidates.length) {
            return {
                error: byProperty
                    ? "None of the selected properties has an expression."
                    : "None of the selected layers has an expression."
            };
        }

        var last = altPressed();
        var source = candidates[last ? candidates.length - 1 : 0];

        // Read everything off the source before writing anything.
        var entries = [];
        var seen = {};
        for (i = 0; i < source.props.length; i++) {
            var prop = source.props[i];
            var steps = propertyPath(prop);
            if (!steps) continue;
            var key = pathKey(steps);
            if (seen[key]) continue;
            seen[key] = true;
            var enabled = true;
            try {
                enabled = prop.expressionEnabled;
            } catch (e) {}
            entries.push({ steps: steps, label: pathLabel(steps), expression: prop.expression, enabled: enabled });
        }

        var targets = [];
        for (i = 0; i < selected.length; i++) {
            if (selected[i].index !== source.layer.index) targets.push(selected[i]);
        }

        var result = {
            source: source.layer.name,
            targets: [],
            byProperty: byProperty,
            labels: [],
            copied: 0,
            missing: [],
            failed: [],
            broken: []
        };
        for (i = 0; i < entries.length; i++) result.labels.push(entries[i].label);
        for (i = 0; i < targets.length; i++) result.targets.push(targets[i].name);

        app.beginUndoGroup("Chroma: Transfer expressions");
        try {
            for (var t = 0; t < targets.length; t++) {
                var target = targets[t];
                for (var n = 0; n < entries.length; n++) {
                    var entry = entries[n];
                    var where = target.name + ": " + entry.label;
                    var dest = resolvePath(target, entry.steps);
                    var settable = false;
                    try {
                        settable = dest && dest.propertyType === PropertyType.PROPERTY && dest.canSetExpression;
                    } catch (e) {}
                    if (!settable) {
                        result.missing.push(where);
                        continue;
                    }
                    try {
                        dest.expression = entry.expression;
                    } catch (e) {
                        result.failed.push(where + " (" + e.toString() + ")");
                        continue;
                    }
                    try {
                        if (dest.expressionEnabled !== entry.enabled) dest.expressionEnabled = entry.enabled;
                    } catch (e) {}
                    result.copied++;
                    // It went on, but doesn't evaluate here -- typically a
                    // reference to an effect this layer doesn't have.
                    var problem = "";
                    try {
                        problem = dest.expressionError;
                    } catch (e) {}
                    if (problem) result.broken.push(where);
                }
            }
        } finally {
            app.endUndoGroup();
        }
        return result;
    }

    // No status line on the mini panel: success is silent, anything
    // skipped or broken is worth a dialog.
    function transferAndReport() {
        var result = transferExpressions();
        if (result.error) {
            alert(result.error, SCRIPT_NAME);
            return;
        }
        if (!result.missing.length && !result.failed.length && !result.broken.length) return;
        var lines = [result.source + " → " + result.targets.join(", ") + ": " +
            plural(result.copied, "expression") + " copied."];
        if (result.missing.length) lines.push("Not on target:\n" + result.missing.join("\n"));
        if (result.failed.length) lines.push("Failed:\n" + result.failed.join("\n"));
        if (result.broken.length) lines.push("Errors in:\n" + result.broken.join("\n"));
        alert(lines.join("\n\n"), SCRIPT_NAME);
    }

    transferAndReport();

})();
