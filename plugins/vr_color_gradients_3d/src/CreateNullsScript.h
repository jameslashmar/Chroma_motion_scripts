/*
	CreateNullsScript.h

	The ExtendScript behind the effect's "Create Nulls from Points" button.

	Pressing the button defines one global function and schedules a call to
	it, rather than doing the work inline. The button press arrives while AE
	is still inside the effect's own USER_CHANGED_PARAM call, and this script
	writes expressions onto that same effect's parameters - deferring it with
	app.scheduleTask lets the effect call return first, so AE is never asked
	to edit an effect it is still in the middle of talking to.

	The button is a sync, not a one-shot:

	  - a point already driven by a working expression is left alone;
	  - a point with no expression, or one whose expression is broken (its
	    null was deleted), gets a null - reusing the one tagged for it if it
	    still exists, otherwise creating one exactly where the point is now;
	  - every null hangs off one rig null per effect, created on first use
	    and found again by its tag afterwards.

	So raising Points Number and pressing it again just adds the new ones.

	Nulls are named after the parameter they drive - "Point 3" - with the
	layer's name in front only if that name is already taken in the comp.
	They are found again by a tag in their layer comment, not by name, and
	each press brings a generated name ("Pt 3", "Point 3") back in step and
	rewrites the expression to match, so nulls from an older version get
	renamed too. A name you typed yourself is left alone.

	Kept under MSVC's 16 KB limit for a single string literal.
*/

#pragma once
#ifndef CHROMA_CREATE_NULLS_SCRIPT_H
#define CHROMA_CREATE_NULLS_SCRIPT_H

static const char kCreateNullsScript[] = R"JSX(
$.global.__chromaVRG3DSync = function (args) {
    var TITLE = "VR Color Gradients 3D";
    var LABELS = [9, 1, 11, 5, 4, 13, 2, 14];

    function find(group, name) {
        for (var i = 1; i <= group.numProperties; i++) {
            var p = group.property(i);
            if (!p) continue;
            if (p.name === name) return p;
            if (p.propertyType === PropertyType.INDEXED_GROUP ||
                p.propertyType === PropertyType.NAMED_GROUP) {
                var f = find(p, name);
                if (f) return f;
            }
        }
        return null;
    }

    function tagged(comp, tag) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var l = comp.layer(i);
            if (l.nullLayer && l.comment.indexOf(tag) === 0) return l;
        }
        return null;
    }

    function linked(point) {
        try {
            return point.expressionEnabled &&
                   point.expression.replace(/^\s+|\s+$/g, "") !== "" &&
                   point.expressionError === "";
        } catch (e) { return false; }
    }

    var MARK = "// Driven by the null ";

    function ours(point) {
        try { return point.expression.indexOf(MARK) === 0; } catch (e) { return false; }
    }

    function link(point, n) {
        var name = n.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        point.expression =
            MARK + '"' + n.name + '" - Create Nulls from Points.\r' +
            'thisComp.layer("' + name + '").toWorld([0,0,0])';
    }

    // "Point 3", named after the parameter it drives. Expressions find
    // layers by name, so if another layer already has that name (a second
    // gradient in the same comp, say) it is prefixed with this layer's.
    function nullName(comp, i, self) {
        var want = "Point " + i;
        for (var k = 1; k <= comp.numLayers; k++) {
            var l = comp.layer(k);
            if (l !== self && l.name === want) return layer.name + " Point " + i;
        }
        return want;
    }

    var comp = app.project.itemByID(args.comp);
    if (!(comp instanceof CompItem)) return;
    var layer = comp.layer(args.layer);
    var fx = layer.property("ADBE Effect Parade").property(args.fx);
    if (!fx) { alert("Could not find the effect on \"" + layer.name + "\".", TITLE); return; }

    var count = Math.round(find(fx, "Points Number").value);
    var key = "VRG3D " + layer.id + " " + fx.name;
    var made = 0, relinked = 0, renamed = 0;

    app.beginUndoGroup("Create Nulls from Points");
    try {
        var RIG_NAME = "VR Color Gradients 3D Points MASTER";
        var rig = tagged(comp, "[" + key + " rig]");

        // Earlier builds named the rig after the layer; bring it into line.
        // Nothing refers to the rig by name, so a duplicate is harmless.
        if (rig && rig.name === layer.name + " points") rig.name = RIG_NAME;

        for (var i = 1; i <= count; i++) {
            var point = find(fx, "Point " + i);
            if (!point) continue;

            var tag = "[" + key + " pt" + i + "]";
            var n = tagged(comp, tag);

            // A working expression that is not ours is someone's own rig.
            if (linked(point) && !(n && ours(point))) continue;

            if (n) {
                // Keep the name in step with the point, e.g. after an older
                // version named it differently or a clash has gone away.
                // Only names this button generated; one you chose is yours.
                var want = nullName(comp, i, n);
                if (n.name !== want && /(^|\s)(Pt|Point) \d+$/.test(n.name)) {
                    n.name = want;
                    renamed++;
                }
                if (linked(point)) { link(point, n); continue; }
            }

            if (!n) {
                if (!rig) {
                    rig = comp.layers.addNull(comp.duration);
                    rig.name = RIG_NAME;
                    rig.threeDLayer = true;
                    rig.label = 8;
                    rig.comment = "[" + key + " rig] Parent of the gradient point nulls. " +
                                  "Move this to carry them all.";
                    rig.property("Anchor Point").setValue([0, 0, 0]);
                    rig.property("Position").setValue([comp.width / 2, comp.height / 2, 0]);
                    rig.moveBefore(layer);
                }

                // The value without any (broken) expression, so the null lands
                // where the point really is and linking it moves nothing.
                var v = point.valueAtTime(comp.time, true);

                n = comp.layers.addNull(comp.duration);
                n.name = nullName(comp, i, n);
                n.threeDLayer = true;
                n.label = LABELS[(i - 1) % LABELS.length];
                n.comment = tag + " Drives " + fx.name + " > Point " + i + ".";
                n.property("Anchor Point").setValue([0, 0, 0]);
                n.property("Position").setValue([v[0], v[1], v[2]]);
                n.parent = rig;          // keeps its world position
                n.moveBefore(layer);
                made++;
            } else {
                relinked++;
            }

            link(point, n);
        }
    } catch (e) {
        alert("Create Nulls from Points failed:\n" + e.toString(), TITLE);
    } finally {
        app.endUndoGroup();
    }

    if (made === 0 && relinked === 0 && renamed === 0) {
        alert("All " + count + " live points already have nulls.", TITLE);
    }
};
)JSX";

#endif	/* CHROMA_CREATE_NULLS_SCRIPT_H */
