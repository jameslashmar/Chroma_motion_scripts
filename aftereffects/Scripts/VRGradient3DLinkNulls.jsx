/**
 * VR Color Gradients 3D - link points to nulls
 *
 * Select a layer carrying VR Color Gradients 3D, run this, and every live
 * gradient point gets its own null, sitting exactly where the point already
 * is and driving it from then on. Nothing moves when you run it.
 *
 * Why bother: a gradient point is a parameter, so it cannot be parented,
 * expression-linked to a camera, or driven by anything in the scene. A null
 * can be all three. Once the points are on nulls you can group them, parent
 * the lot to a camera, link them to imported 3D geometry, or just drag them
 * in the viewer instead of scrubbing three numbers.
 *
 *   3D nulls  drive X, Y and Z. This is the useful one, and the only one
 *             worth having in World XYZ, where Z is what puts a point in
 *             front of you rather than 90 degrees off to the side.
 *   2D nulls  drive X and Y only; each point keeps whatever Z it has now.
 *             Fine in Equirect + Distance when you only want to slide points
 *             around the flat frame.
 *
 * The link is the same in both point spaces:
 *
 *     thisComp.layer("...").toWorld([0,0,0])
 *
 * and it needs no correction term, because a null placed at the point's
 * current value reproduces that value exactly. In Equirect + Distance the
 * point is already an absolute frame position. In World XYZ the effect
 * subtracts the frame centre itself, so a null at the centre of the comp is
 * the origin and the viewer sits there.
 *
 * Windows + macOS. ExtendScript only: no shell calls, no platform branches.
 *
 * Install: <AE install>/Support Files/Scripts/
 * Then: File > Scripts > VRGradient3DLinkNulls.jsx
 */

(function vrGradient3DLinkNulls() {

    var SCRIPT_NAME = "VR Gradient 3D - link nulls";
    var MATCH_NAME  = "CHRM VR Color Gradients 3D";
    var MAX_POINTS  = 8;

    // Label colours, so the rig reads at a glance in the timeline.
    var LABELS = [9, 1, 11, 5, 4, 13, 2, 14];

    // ---------------------------------------------------------------- helpers

    /** Find an effect parameter by display name, through any group. */
    function findParam(group, name) {
        for (var i = 1; i <= group.numProperties; i++) {
            var prop = group.property(i);
            if (!prop) continue;
            if (prop.name === name) return prop;
            if (prop.propertyType === PropertyType.INDEXED_GROUP ||
                prop.propertyType === PropertyType.NAMED_GROUP) {
                var found = findParam(prop, name);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * The effect to work on: one the user has selected if they have, otherwise
     * the first on the layer. Null if the layer has none.
     */
    function findEffect(layer) {
        var parade = null;
        try {
            parade = layer.property("ADBE Effect Parade");
        } catch (e) {}
        if (!parade) return null;

        var selected = [];
        try {
            selected = layer.selectedProperties;
        } catch (e) {}
        for (var s = 0; s < selected.length; s++) {
            var prop = selected[s];
            try {
                if (prop.matchName === MATCH_NAME) return prop;
                // A selected parameter counts as selecting its effect.
                if (prop.parentProperty && prop.parentProperty.matchName === MATCH_NAME) {
                    return prop.parentProperty;
                }
            } catch (e) {}
        }

        for (var i = 1; i <= parade.numProperties; i++) {
            var fx = parade.property(i);
            try {
                if (fx.matchName === MATCH_NAME) return fx;
            } catch (e) {}
        }
        return null;
    }

    function plural(count, noun) {
        return count + " " + noun + (count === 1 ? "" : "s");
    }

    // ------------------------------------------------------------------ dialog

    /** Returns { threeD, group } or null if cancelled. */
    function ask(pointCount, spaceName) {
        var dlg = new Window("dialog", SCRIPT_NAME);
        dlg.alignChildren = ["fill", "top"];
        dlg.spacing = 10;
        dlg.margins = 16;

        var info = dlg.add("statictext", undefined,
            plural(pointCount, "live point") + ", point space: " + spaceName);
        info.alignment = ["fill", "top"];

        var kind = dlg.add("panel", undefined, "Create");
        kind.alignChildren = ["left", "top"];
        kind.margins = [12, 16, 12, 12];
        kind.spacing = 5;

        var three = kind.add("radiobutton", undefined, "3D nulls - drive X, Y and Z");
        var two   = kind.add("radiobutton", undefined, "2D nulls - drive X and Y, keep each Z");
        three.value = true;

        var warn = kind.add("statictext", undefined, "", { multiline: true });
        warn.alignment = ["fill", "top"];
        warn.preferredSize.height = 28;
        warn.graphics.font = ScriptUI.newFont(
            warn.graphics.font.name, "ITALIC", warn.graphics.font.size);

        function updateWarning() {
            if (two.value && spaceName === "World XYZ") {
                warn.text = "In World XYZ, Z is what puts a point in front of the " +
                            "viewer. 2D nulls cannot reach it.";
            } else {
                warn.text = "";
            }
            dlg.layout.layout(true);
        }
        three.onClick = two.onClick = updateWarning;

        var groupChk = dlg.add("checkbox", undefined, "Group them under one parent null");
        groupChk.value = true;

        var buttons = dlg.add("group");
        buttons.alignment = ["fill", "top"];
        buttons.alignChildren = ["fill", "center"];
        buttons.add("button", undefined, "Cancel", { name: "cancel" });
        buttons.add("button", undefined, "Create", { name: "ok" });

        updateWarning();
        if (dlg.show() !== 1) return null;
        return { threeD: three.value, group: groupChk.value };
    }

    // ------------------------------------------------------------------- work

    function run() {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) {
            alert("Open a composition first.", SCRIPT_NAME);
            return;
        }

        var selected = comp.selectedLayers;
        if (selected.length !== 1) {
            alert("Select the one layer carrying VR Color Gradients 3D.", SCRIPT_NAME);
            return;
        }
        var layer = selected[0];

        var fx = findEffect(layer);
        if (!fx) {
            alert("\"" + layer.name + "\" has no VR Color Gradients 3D on it.", SCRIPT_NAME);
            return;
        }

        var countProp = findParam(fx, "Points Number");
        var spaceProp = findParam(fx, "Point Space");
        if (!countProp || !spaceProp) {
            alert("That effect is not the one this script knows about -- it has no " +
                  "Points Number / Point Space.", SCRIPT_NAME);
            return;
        }

        var pointCount = Math.max(1, Math.min(MAX_POINTS, Math.round(countProp.value)));
        var spaceName = (spaceProp.value === 2) ? "World XYZ" : "Equirect + Distance";

        var choice = ask(pointCount, spaceName);
        if (!choice) return;

        var made = [];
        var skipped = [];

        app.beginUndoGroup("Chroma: link VR Gradient 3D points to nulls");
        try {
            var parent = null;
            if (choice.group) {
                parent = comp.layers.addNull(comp.duration);
                parent.name = layer.name + " VRG3D rig";
                parent.threeDLayer = choice.threeD;
                parent.label = 8;
                parent.comment = "Parent of the gradient point nulls. Move this to " +
                                 "carry the whole constellation.";
                parent.property("Anchor Point").setValue([0, 0, 0]);
                parent.property("Position").setValue(
                    choice.threeD ? [comp.width / 2, comp.height / 2, 0]
                                  : [comp.width / 2, comp.height / 2]);
            }

            for (var i = 1; i <= pointCount; i++) {
                var point = findParam(fx, "Point " + i);
                if (!point) { skipped.push("Point " + i); continue; }

                // An expression already on it is someone's work; leave it be.
                var hasExpression = false;
                try {
                    hasExpression = point.expressionEnabled &&
                                    point.expression.replace(/^\s+|\s+$/g, "") !== "";
                } catch (e) {}
                if (hasExpression) { skipped.push("Point " + i + " (already linked)"); continue; }

                var value = point.value;   // [x, y, z] in the point's own space

                var n = comp.layers.addNull(comp.duration);
                n.name = layer.name + " Pt " + i;
                n.threeDLayer = choice.threeD;
                n.label = LABELS[(i - 1) % LABELS.length];
                n.comment = "Drives " + fx.name + " > Point " + i + " (" + spaceName + ")";
                n.property("Anchor Point").setValue([0, 0, 0]);

                // Placed at the point's current value, so linking changes nothing.
                n.property("Position").setValue(
                    choice.threeD ? [value[0], value[1], value[2]]
                                  : [value[0], value[1]]);

                if (parent) n.parent = parent;

                point.expression = choice.threeD
                    ? [
                        '// Driven by the 3D null "' + n.name + '".',
                        'thisComp.layer("' + n.name + '").toWorld([0,0,0])'
                      ].join("\r")
                    : [
                        '// Driven by the 2D null "' + n.name + '".',
                        '// Z is not on the null, so it stays where it was.',
                        'var p = thisComp.layer("' + n.name + '").toWorld([0,0]);',
                        '[p[0], p[1], ' + value[2] + ']'
                      ].join("\r");

                made.push(n);
            }
        } catch (e) {
            alert("Error: " + e.toString(), SCRIPT_NAME);
            return;
        } finally {
            app.endUndoGroup();
        }

        var message = plural(made.length, (choice.threeD ? "3D" : "2D") + " null") +
                      " created and linked.";
        if (skipped.length) message += "\n\nLeft alone: " + skipped.join(", ");
        alert(message, SCRIPT_NAME);
    }

    run();

})();
