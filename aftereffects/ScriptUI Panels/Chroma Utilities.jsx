/**
 * Chroma Utilities
 *
 * A dockable panel of small tools for After Effects.
 *
 *   Create Shot Folders
 *     Numbered shot bins in the Project panel: SHOT001 ... SHOT010. Same
 *     dialog as the standalone Scripts/CreateShotFolders.jsx, embedded here
 *     so the panel is a single-file install.
 *
 *   Strip keys from duplicate + parent to original
 *     Duplicate an animated layer, select the original and the duplicate,
 *     click a button. The duplicate loses its keyframes (Position, Rotation,
 *     Scale, all three, or every keyframe on the layer) and is parented to
 *     the original, so it follows the original's animation instead of
 *     carrying its own copy. One original with several duplicates works too.
 *
 *     Which layer is the original: if the names differ only by a trailing
 *     number ("Hero" / "Hero 2", "Shape Layer 1" / "Shape Layer 2") the
 *     un-numbered or lowest-numbered one is the original. Otherwise the
 *     lowest selected layer in the stack is, because Ctrl/Cmd+D puts the
 *     copy directly above it. Hold Alt (Option) while clicking to swap.
 *
 *     Each stripped property keeps its value at the current time -- the same
 *     result as switching the stopwatch off. Expressions and layer markers
 *     are left alone. Parenting uses After Effects' own compensation, so the
 *     duplicate stays where it is on screen rather than jumping.
 *
 *   Transfer expressions
 *     Click the source layer, then one or more targets, and click Transfer.
 *     Every expression on the source is copied to each target -- or, if a
 *     property is selected on the source (Position, an effect, a shape
 *     group), only the expressions it covers. Expressions only: keyframes
 *     and values stay as they are, and a property the target doesn't have
 *     (a missing effect, say) is skipped and reported rather than created.
 *     An expression's on/off switch travels with it.
 *
 *     The source is whichever selected layer has expressions to give, so
 *     click order only matters when more than one does: then it is the one
 *     clicked first, or last with Alt (Option) held.
 *
 * Windows + macOS. ExtendScript only: no shell calls, no platform branches.
 *
 * Install: <AE install>/Support Files/Scripts/ScriptUI Panels/
 * Then: Window > Chroma Utilities
 */

(function chromaUtilities(thisObj) {

    var SCRIPT_NAME = "Chroma Utilities";

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
     * The Create Shot Folders dialog. Returns a one-line summary for the
     * panel's status line, or null if cancelled.
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

    function stripAndParent(mode, setStatus) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) {
            setStatus("Open a composition first.");
            return;
        }
        var selected = comp.selectedLayers;
        if (selected.length < 2) {
            setStatus("Select the original layer and its duplicate(s).");
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
            setStatus("Error: " + e.toString());
            return;
        } finally {
            app.endUndoGroup();
        }

        var dupNames = [];
        for (var d = 1; d < ranked.length; d++) dupNames.push(ranked[d].layer.name);

        var message = dupNames.join(", ") + " → " + original.name + ": " +
            plural(removed, MODE_LABELS[mode] + " key") + " removed";
        if (parented) message += ", parented";
        if (failed.length) message += ". Not parented: " + failed.join(", ");
        setStatus(message);
    }

    // ------------------------------------------------- transfer expressions

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

        var last = false;
        try {
            last = ScriptUI.environment.keyboardState.altKey;
        } catch (e) {}
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

    function transferAndReport(setStatus) {
        var result = transferExpressions();
        if (result.error) {
            setStatus(result.error);
            return;
        }
        var what = result.byProperty
            ? " (" + (result.labels.length <= 3 ? result.labels.join(", ") : result.labels.length + " properties") + ")"
            : "";
        var message = result.source + " → " + result.targets.join(", ") + ": " +
            plural(result.copied, "expression") + " copied" + what;
        if (result.missing.length) message += ". Not on target: " + result.missing.join(", ");
        if (result.failed.length) message += ". Failed: " + result.failed.join(", ");
        if (result.broken.length) message += ". Errors in: " + result.broken.join(", ");
        setStatus(message);
    }

    // ---------------------------------------------------------------------- UI

    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        win.alignChildren = ["fill", "top"];
        win.spacing = 8;
        win.margins = 12;

        // --- project
        var projectGroup = win.add("panel", undefined, "Project");
        projectGroup.alignChildren = ["fill", "top"];
        projectGroup.margins = [12, 16, 12, 12];
        projectGroup.spacing = 5;

        var btnShotFolders = projectGroup.add("button", undefined, "Create Shot Folders…");
        btnShotFolders.helpTip = "Numbered shot bins in the Project panel: SHOT001 … SHOT010.";

        // --- strip + parent
        var stripGroup = win.add("panel", undefined, "Strip keys from duplicate, parent to original");
        stripGroup.alignChildren = ["fill", "top"];
        stripGroup.margins = [12, 16, 12, 12];
        stripGroup.spacing = 5;

        var hint = stripGroup.add("statictext", undefined,
            "Select the original and its duplicate(s). Alt-click to swap.");
        hint.alignment = ["fill", "top"];

        var rowA = stripGroup.add("group");
        rowA.alignment = ["fill", "top"];
        rowA.alignChildren = ["fill", "center"];
        var btnPosition = rowA.add("button", undefined, "Position");
        var btnRotation = rowA.add("button", undefined, "Rotation");
        var btnScale = rowA.add("button", undefined, "Scale");

        var rowB = stripGroup.add("group");
        rowB.alignment = ["fill", "top"];
        rowB.alignChildren = ["fill", "center"];
        var btnPSR = rowB.add("button", undefined, "PSR");
        var btnAll = rowB.add("button", undefined, "All keyframes");

        var tipSuffix = " from the duplicate, then parent it to the original.";
        btnPosition.helpTip = "Remove Position keyframes (including separated X/Y/Z)" + tipSuffix;
        btnRotation.helpTip = "Remove Rotation keyframes (X/Y/Z and Orientation on 3D layers)" + tipSuffix;
        btnScale.helpTip = "Remove Scale keyframes" + tipSuffix;
        btnPSR.helpTip = "Remove Position, Scale and Rotation keyframes" + tipSuffix;
        btnAll.helpTip = "Remove every keyframe on the layer -- transform, effects, masks, " +
            "text, shapes, styles -- but not markers or expressions" + tipSuffix;

        // --- transfer expressions
        var transferGroup = win.add("panel", undefined, "Transfer expressions");
        transferGroup.alignChildren = ["fill", "top"];
        transferGroup.margins = [12, 16, 12, 12];
        transferGroup.spacing = 5;

        var transferHint = transferGroup.add("statictext", undefined,
            "Click the source, then the target(s). Select properties to copy just those.");
        transferHint.alignment = ["fill", "top"];

        var btnTransfer = transferGroup.add("button", undefined, "Transfer");
        btnTransfer.helpTip = "Copy expressions from the source layer to every other selected layer. " +
            "Only the expressions: no keyframes or values. With a property selected on the " +
            "source (Position, an effect, a shape group) only those are copied, otherwise every " +
            "expression on the layer. The source is the selected layer with expressions; if " +
            "several have them, the one clicked first -- Alt-click for the one clicked last.";

        // --- status
        var status = win.add("statictext", undefined, "", { truncate: "end" });
        status.alignment = ["fill", "top"];

        function setStatus(message) {
            status.text = message;
            status.helpTip = message; // the full line, when it's truncated
            try {
                win.update();
            } catch (e) {}
        }

        function guarded(fn) {
            return function () {
                try {
                    fn();
                } catch (e) {
                    setStatus("Error: " + e.toString());
                }
            };
        }

        btnShotFolders.onClick = guarded(function () {
            var summary = createShotFolders();
            if (summary) setStatus(summary);
        });

        btnPosition.onClick = guarded(function () { stripAndParent("position", setStatus); });
        btnRotation.onClick = guarded(function () { stripAndParent("rotation", setStatus); });
        btnScale.onClick = guarded(function () { stripAndParent("scale", setStatus); });
        btnPSR.onClick = guarded(function () { stripAndParent("psr", setStatus); });
        btnAll.onClick = guarded(function () { stripAndParent("all", setStatus); });
        btnTransfer.onClick = guarded(function () { transferAndReport(setStatus); });

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
