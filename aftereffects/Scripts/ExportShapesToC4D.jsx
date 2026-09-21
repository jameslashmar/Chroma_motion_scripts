// ExportShapesToC4D.jsx
// After Effects script: writes shape layers to a JSON file for
// import_ae_shapes-AE2C4D.py in Cinema 4D, sampled on every frame.
// Exports either the selected shape layers or every shape layer in the comp.
// Carries paths (bezier, rectangle, ellipse, star), group transforms, strokes,
// Trim Paths, and the layer's full transform (parents, 3D, auto-orient) as a
// matrix per frame. Expressions are baked, since every value is read post-expression.
//
// Needs Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network.

(function exportShapesToC4D() {

    var TITLE = "Export Shapes to C4D";
    var FORMAT = "chroma-ae-shapes";
    var VERSION = 1;
    var PROBE_NAME = "__Chroma C4D export probe ";

    // ---- JSON (ExtendScript has no JSON object) -----------------------------
    // Escapes are built from character codes so the source file itself never
    // contains a control character; AE's script parser stops on a raw NUL.

    function quote(s) {
        var out = '"';
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            var code = s.charCodeAt(i);
            if (ch === '"' || ch === "\\") {
                out += "\\" + ch;
            } else if (code < 32) {
                var hex = code.toString(16);
                out += "\\" + "u" + (hex.length < 2 ? "000" : "00") + hex;
            } else {
                out += ch;
            }
        }
        return out + '"';
    }

    function toJSON(v) {
        if (v === null || v === undefined) { return "null"; }
        if (typeof v === "number") { return isFinite(v) ? String(v) : "0"; }
        if (typeof v === "boolean") { return v ? "true" : "false"; }
        if (typeof v === "string") { return quote(v); }
        var parts = [], i;
        if (v instanceof Array) {
            for (i = 0; i < v.length; i++) { parts.push(toJSON(v[i])); }
            return "[" + parts.join(",") + "]";
        }
        for (var key in v) {
            if (v.hasOwnProperty(key) && v[key] !== undefined) {
                parts.push(quote(key) + ":" + toJSON(v[key]));
            }
        }
        return "{" + parts.join(",") + "}";
    }

    // ---- sampling -------------------------------------------------------------

    function roundTo(x, places) {
        var f = Math.pow(10, places);
        return Math.round(x * f) / f;
    }

    function convert(v) {
        if (v instanceof Shape) {
            return { v: convert(v.vertices), i: convert(v.inTangents), o: convert(v.outTangents), c: v.closed };
        }
        if (v instanceof Array) {
            var out = [];
            for (var i = 0; i < v.length; i++) { out.push(convert(v[i])); }
            return out;
        }
        return (typeof v === "number") ? roundTo(v, 4) : v;
    }

    // {k: value} when the property can't change, otherwise {f: [value per frame]}
    function sample(prop, ctx) {
        if (!prop) { return undefined; }
        if (!prop.isTimeVarying) { return { k: convert(prop.value) }; }
        var values = [], first = null, same = true;
        for (var f = 0; f < ctx.times.length; f++) {
            var val = convert(prop.valueAtTime(ctx.times[f], false));
            var text = toJSON(val);
            if (f === 0) { first = text; } else if (text !== first) { same = false; }
            values.push(val);
        }
        return same ? { k: values[0] } : { f: values };
    }

    function child(group, matchName) {
        if (!group) { return null; }
        try { return group.property(matchName); } catch (e) { return null; }
    }

    function staticValue(group, matchName, fallback) {
        var p = child(group, matchName);
        return p ? p.value : fallback;
    }

    // ---- shape contents ---------------------------------------------------------

    function walkContents(group, ctx) {
        var items = [];
        if (!group) { return items; }
        for (var i = 1; i <= group.numProperties; i++) {
            var p = group.property(i);
            var it = { name: p.name, mn: p.matchName, enabled: p.enabled };
            switch (p.matchName) {
                case "ADBE Vector Group":
                    var tr = child(p, "ADBE Vector Transform Group");
                    it.type = "group";
                    it.transform = {
                        anchor: sample(child(tr, "ADBE Vector Anchor"), ctx),
                        position: sample(child(tr, "ADBE Vector Position"), ctx),
                        scale: sample(child(tr, "ADBE Vector Scale"), ctx),
                        skew: sample(child(tr, "ADBE Vector Skew"), ctx),
                        skewAxis: sample(child(tr, "ADBE Vector Skew Axis"), ctx),
                        rotation: sample(child(tr, "ADBE Vector Rotation"), ctx)
                    };
                    it.contents = walkContents(child(p, "ADBE Vectors Group"), ctx);
                    break;
                case "ADBE Vector Shape - Group":
                    it.type = "path";
                    it.direction = staticValue(p, "ADBE Vector Shape Direction", 1);
                    it.shape = sample(child(p, "ADBE Vector Shape"), ctx);
                    break;
                case "ADBE Vector Shape - Rect":
                    it.type = "rect";
                    it.direction = staticValue(p, "ADBE Vector Shape Direction", 1);
                    it.size = sample(child(p, "ADBE Vector Rect Size"), ctx);
                    it.position = sample(child(p, "ADBE Vector Rect Position"), ctx);
                    it.roundness = sample(child(p, "ADBE Vector Rect Roundness"), ctx);
                    break;
                case "ADBE Vector Shape - Ellipse":
                    it.type = "ellipse";
                    it.direction = staticValue(p, "ADBE Vector Shape Direction", 1);
                    it.size = sample(child(p, "ADBE Vector Ellipse Size"), ctx);
                    it.position = sample(child(p, "ADBE Vector Ellipse Position"), ctx);
                    break;
                case "ADBE Vector Shape - Star":
                    it.type = "star";
                    it.direction = staticValue(p, "ADBE Vector Shape Direction", 1);
                    it.starType = staticValue(p, "ADBE Vector Star Type", 1);
                    it.points = sample(child(p, "ADBE Vector Star Points"), ctx);
                    it.position = sample(child(p, "ADBE Vector Star Position"), ctx);
                    it.rotation = sample(child(p, "ADBE Vector Star Rotation"), ctx);
                    it.innerRadius = sample(child(p, "ADBE Vector Star Inner Radius"), ctx);
                    it.outerRadius = sample(child(p, "ADBE Vector Star Outer Radius"), ctx);
                    // sic: Adobe's match names really are spelled "Roundess"
                    it.innerRoundness = sample(child(p, "ADBE Vector Star Inner Roundess"), ctx);
                    it.outerRoundness = sample(child(p, "ADBE Vector Star Outer Roundess"), ctx);
                    break;
                case "ADBE Vector Graphic - Stroke":
                case "ADBE Vector Graphic - G-Stroke":
                    var dashes = child(p, "ADBE Vector Stroke Dashes");
                    it.type = "stroke";
                    it.gradient = (p.matchName === "ADBE Vector Graphic - G-Stroke");
                    it.color = it.gradient ? undefined : sample(child(p, "ADBE Vector Stroke Color"), ctx);
                    it.width = sample(child(p, "ADBE Vector Stroke Width"), ctx);
                    it.cap = staticValue(p, "ADBE Vector Stroke Line Cap", 1);
                    it.join = staticValue(p, "ADBE Vector Stroke Line Join", 1);
                    it.dashes = !!(dashes && dashes.numProperties > 0);
                    break;
                case "ADBE Vector Graphic - Fill":
                case "ADBE Vector Graphic - G-Fill":
                    it.type = "fill";
                    break;
                case "ADBE Vector Filter - Trim":
                    it.type = "trim";
                    it.start = sample(child(p, "ADBE Vector Trim Start"), ctx);
                    it.end = sample(child(p, "ADBE Vector Trim End"), ctx);
                    it.offset = sample(child(p, "ADBE Vector Trim Offset"), ctx);
                    it.mode = staticValue(p, "ADBE Vector Trim Type", 1);
                    break;
                default:
                    it.type = "other";
            }
            items.push(it);
        }
        return items;
    }

    // ---- layer transform --------------------------------------------------------
    // Scripting has no layer-to-world matrix, but expressions do. Four temporary
    // 3D Point Controls evaluate toWorld() at the origin and at 100 px along each
    // axis; the differences are the matrix columns. Everything AE folds into a
    // layer's transform (parents, 3D, orientation, auto-orient) comes along for free.

    function sampleLayerMatrix(layer, ctx) {
        var offsets = ["[0,0,0]", "[100,0,0]", "[0,100,0]", "[0,0,100]"];
        var names = [], i, f;
        var wasLocked = layer.locked;
        if (wasLocked) { layer.locked = false; }
        try {
            for (i = 0; i < 4; i++) {
                var effect = layer.property("ADBE Effect Parade").addProperty("ADBE Point3D Control");
                effect.name = PROBE_NAME + i;
                names.push(effect.name);
                effect.property(1).expression =
                    "var p = thisLayer.toWorld(" + offsets[i] + "); [p[0], p[1], p.length > 2 ? p[2] : 0];";
            }
            var probes = [];
            for (i = 0; i < 4; i++) {
                probes.push(layer.property("ADBE Effect Parade").property(names[i]).property(1));
            }
            var values = [], first = null, same = true;
            for (f = 0; f < ctx.times.length; f++) {
                var p = [];
                for (i = 0; i < 4; i++) { p.push(probes[i].valueAtTime(ctx.times[f], false)); }
                if (f === 0 && probes[0].expressionError) {
                    throw new Error("Layer transform expression failed on \"" + layer.name + "\": " + probes[0].expressionError);
                }
                var m = [];
                for (i = 1; i <= 3; i++) {
                    for (var axis = 0; axis < 3; axis++) { m.push(roundTo((p[i][axis] - p[0][axis]) / 100, 6)); }
                }
                for (axis = 0; axis < 3; axis++) { m.push(roundTo(p[0][axis], 4)); }
                var text = toJSON(m);
                if (f === 0) { first = text; } else if (text !== first) { same = false; }
                values.push(m);
            }
            return same ? { k: values[0] } : { f: values };
        } finally {
            var parade = layer.property("ADBE Effect Parade");
            for (i = names.length - 1; i >= 0; i--) {
                try { parade.property(names[i]).remove(); } catch (e) {}
            }
            if (wasLocked) { layer.locked = true; }
        }
    }

    // ---- main -------------------------------------------------------------------

    function plural(n, word) {
        return n + " " + word + (n === 1 ? "" : "s");
    }

    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) {
        alert("Open a composition first.", TITLE);
        return;
    }
    var allLayers = [], selectedLayers = [], i;
    for (i = 1; i <= comp.numLayers; i++) {
        var candidate = comp.layer(i);
        if (candidate instanceof ShapeLayer) {
            allLayers.push(candidate);
            if (candidate.selected) { selectedLayers.push(candidate); }
        }
    }
    if (!allLayers.length) {
        alert("\"" + comp.name + "\" has no shape layers.", TITLE);
        return;
    }

    var dlg = new Window("dialog", TITLE);
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 10;
    dlg.margins = 16;
    dlg.add("statictext", undefined, "Composition: " + comp.name);

    var layerPanel = dlg.add("panel", undefined, "Layers");
    layerPanel.alignChildren = ["left", "top"];
    layerPanel.margins = [12, 16, 12, 10];
    var rbSelected = layerPanel.add("radiobutton", undefined, "Selected shape layers (" + selectedLayers.length + ")");
    var rbAll = layerPanel.add("radiobutton", undefined, "All shape layers in the comp (" + allLayers.length + ")");
    rbSelected.enabled = selectedLayers.length > 0;
    rbSelected.value = selectedLayers.length > 0;
    rbAll.value = !rbSelected.value;

    var rangePanel = dlg.add("panel", undefined, "Frames");
    rangePanel.alignChildren = ["left", "top"];
    rangePanel.margins = [12, 16, 12, 10];
    var rbWork = rangePanel.add("radiobutton", undefined, "Work area");
    var rbComp = rangePanel.add("radiobutton", undefined, "Whole composition");
    rbWork.value = true;

    var buttons = dlg.add("group");
    buttons.alignment = ["right", "top"];
    buttons.add("button", undefined, "Cancel", { name: "cancel" });
    buttons.add("button", undefined, "Export...", { name: "ok" });
    if (dlg.show() !== 1) { return; }

    var layers = rbSelected.value ? selectedLayers : allLayers;

    var fd = comp.frameDuration;
    var startTime = rbWork.value ? comp.workAreaStart : 0;
    var endTime = rbWork.value ? comp.workAreaStart + comp.workAreaDuration : comp.duration;
    var ctx = { frames: [], times: [] };
    var firstFrame = Math.round(startTime / fd), lastFrame = Math.round(endTime / fd) - 1;
    for (var frame = firstFrame; frame <= Math.max(firstFrame, lastFrame); frame++) {
        ctx.frames.push(frame);
        ctx.times.push(frame * fd);
    }

    var safeName = comp.name.replace(/[\\\/:*?"<>|]/g, "_");
    var file = new File(Folder.desktop.fsName + "/" + safeName + "_shapes.json")
        .saveDlg("Save shape data for Cinema 4D", $.os.indexOf("Windows") !== -1 ? "JSON:*.json" : undefined);
    if (!file) { return; }
    if (!/\.json$/i.test(file.name)) { file = new File(file.fsName + ".json"); }

    var data = {
        format: FORMAT,
        version: VERSION,
        exporter: "ExportShapesToC4D.jsx",
        comp: {
            name: comp.name, width: comp.width, height: comp.height, pixelAspect: comp.pixelAspect,
            frameRate: comp.frameRate, frameDuration: fd
        },
        frames: ctx.frames,
        layers: []
    };

    app.beginUndoGroup(TITLE);
    try {
        for (i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var entry = {
                name: layer.name,
                index: layer.index,
                threeD: layer.threeDLayer,
                inFrame: Math.round(layer.inPoint / fd),
                outFrame: Math.round(layer.outPoint / fd),
                contents: walkContents(layer.property("ADBE Root Vectors Group"), ctx)
            };
            entry.matrix = sampleLayerMatrix(layer, ctx);
            data.layers.push(entry);
        }
    } catch (err) {
        alert("Export failed: " + err.toString(), TITLE);
        return;
    } finally {
        app.endUndoGroup();
    }

    try {
        file.encoding = "UTF-8";
        file.lineFeed = "Unix";
        if (!file.open("w")) { throw new Error(file.error || "could not open the file"); }
        file.write(toJSON(data));
        file.close();
    } catch (writeErr) {
        alert("Could not write " + file.fsName + "\n\n" + writeErr.toString() +
            "\n\nCheck Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network.",
            TITLE);
        return;
    }

    alert("Exported " + plural(layers.length, "layer") + ", " + plural(ctx.frames.length, "frame") +
        ", to\n" + file.fsName, TITLE);
})();
