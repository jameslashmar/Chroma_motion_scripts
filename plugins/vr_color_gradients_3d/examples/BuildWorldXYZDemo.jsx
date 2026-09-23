/**
 * VR Color Gradients 3D - World XYZ demo builder
 *
 * Builds a worked example of the plug-in's World XYZ point space: an
 * equirectangular comp whose gradient points are driven by 3D nulls, so the
 * colour sources sit at real places in the scene instead of at places in the
 * flattened frame.
 *
 * What it makes
 *
 *   VRG3D - World XYZ demo      2048 x 1024 (2:1 equirect), 25 fps, 10 s
 *     LIGHT Flyby               animated: passes close by the viewer
 *     LIGHT Window              up and to the right
 *     LIGHT Fire                down and forward
 *     LIGHT Neon                left and behind
 *     VIEWER                    the 360 nodal point - the origin of it all
 *     BG                        solid carrying the effect
 *
 * Each light null drives one gradient point through an expression, and the
 * flyby one is keyframed straight past the viewer so the depth falloff is
 * visible without touching anything: as it closes, its radius drops and its
 * colour blooms wide across the sphere; as it recedes the colour tightens back
 * into a hotspot. That behaviour is the whole point of the Z axis, and it is
 * the thing Equirect + Distance cannot give you.
 *
 * The expression, and why it looks like that
 *
 *     var rel = L.toWorld([0,0,0]) - V.toWorld([0,0,0]);
 *     [rel[0] + thisComp.width/2, rel[1] + thisComp.height/2, rel[2]]
 *
 *   - Subtracting the viewer makes the vector relative to the 360 nodal point.
 *     The effect has no camera input: "world" means relative to a viewer at
 *     the origin looking down +Z, so anything that moves the viewer has to be
 *     taken out here.
 *   - Adding the frame centre back is not decoration. The effect computes
 *     (x - width/2) and -(y - height/2) on the point it is handed, so a vector
 *     that is already centred would be shifted half a frame if it were passed
 *     in raw.
 *   - Nothing flips Y by hand. After Effects' Y points down and the effect
 *     flips it internally, so a null physically above the viewer lands above
 *     the horizon. Same for Z: AE's +Z goes away from the viewer, which is the
 *     forward the effect wants.
 *
 * Needs the plug-in installed and After Effects restarted. Run it from
 * File > Scripts > Run Script File, or drop it in the Scripts folder.
 *
 * Windows + macOS. ExtendScript only: no shell calls, no platform branches.
 */

(function buildWorldXYZDemo() {

    var SCRIPT_NAME = "VR Gradient 3D - World XYZ demo";
    var MATCH_NAME  = "CHRM VR Color Gradients 3D";

    var COMP_NAME = "VRG3D - World XYZ demo";
    var WIDTH     = 2048;          // 2:1, the equirect convention
    var HEIGHT    = 1024;
    var FPS       = 25;
    var DURATION  = 10;

    // Pixels per one unit of sphere radius. A light this far from the viewer
    // lands on radius 1, which behaves exactly like a flat equirect point --
    // so this is the number to match to your scene's working distance, and
    // the one to tune first if everything looks washed out or pinpricked.
    var DEPTH_SCALE = 500;

    /**
     * The lights. Position is in comp pixels relative to the VIEWER, in After
     * Effects' own axes: +x right, +y DOWN, +z away from the viewer. The
     * effect flips y for you, so "up" here is negative.
     */
    var LIGHTS = [
        { name: "LIGHT Neon",   color: [0.15, 0.45, 1.00], label: 9,
          offset: [-900, -120, -700],
          note:   "left and behind - wraps round the back of the sphere" },
        { name: "LIGHT Fire",   color: [1.00, 0.35, 0.07], label: 1,
          offset: [250, 520, 600],
          note:   "down and forward - a practical on the floor" },
        { name: "LIGHT Window", color: [0.85, 0.90, 1.00], label: 11,
          offset: [700, -640, 900],
          note:   "up and to the right - cool daylight spill" },
        { name: "LIGHT Flyby",  color: [0.20, 1.00, 0.55], label: 5,
          offset: null,   // keyframed below
          note:   "passes close by the viewer - watch it bloom then tighten" }
    ];

    // The flyby runs right past the viewer's ear. At its nearest the radius is
    // 150/500 = 0.3 and the colour floods; at the ends it is 5.0 and pins down
    // to a hotspot.
    var FLYBY = { near_z: 150, sweep_x: 2500, y: 0 };

    // ------------------------------------------------------------- helpers

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

    function setParam(effect, name, value) {
        var prop = findParam(effect, name);
        if (!prop) throw new Error('the effect has no parameter called "' + name + '"');
        prop.setValue(value);
        return prop;
    }

    /**
     * The link from a light null to a gradient point. See the header for why
     * the viewer is subtracted and the frame centre added back.
     */
    function pointExpression(lightName, viewerName) {
        return [
            '// Driven by the 3D null "' + lightName + '".',
            '// Relative to the viewer, because the effect has no camera input.',
            'var L = thisComp.layer("' + lightName + '");',
            'var V = thisComp.layer("' + viewerName + '");',
            'var rel = L.toWorld([0,0,0]) - V.toWorld([0,0,0]);',
            '',
            '// Re-centre: the effect subtracts the frame centre from x and y,',
            '// so a vector that is already centred has to put it back.',
            '[rel[0] + thisComp.width/2, rel[1] + thisComp.height/2, rel[2]]'
        ].join("\r");
    }

    function makeNull(comp, name, label, comment) {
        var layer = comp.layers.addNull(comp.duration);
        layer.name = name;
        layer.threeDLayer = true;
        layer.label = label;
        layer.comment = comment;
        layer.property("Anchor Point").setValue([0, 0, 0]);
        return layer;
    }

    // ---------------------------------------------------------------- build

    function build() {
        var project = app.project;
        if (!project) {
            alert("Open or create a project first.", SCRIPT_NAME);
            return;
        }

        // Fail before touching the project rather than half way through it.
        var probeComp = null;
        var supported = false;
        try {
            probeComp = project.items.addComp("__vrg3d probe", 16, 16, 1, 1, 25);
            var probeSolid = probeComp.layers.addSolid([0, 0, 0], "probe", 16, 16, 1);
            supported = probeSolid.property("ADBE Effect Parade").canAddProperty(MATCH_NAME);
        } catch (e) {
            supported = false;
        }
        try { if (probeComp) probeComp.remove(); } catch (e) {}

        if (!supported) {
            alert("Can't find the effect \"" + MATCH_NAME + "\".\n\n" +
                  "Install ChromaVRGradient3D.aex into\n" +
                  "  <AE install>\\Support Files\\Plug-ins\\Effects\\\n" +
                  "and restart After Effects.", SCRIPT_NAME);
            return;
        }

        app.beginUndoGroup("Chroma: build VR Gradient 3D World XYZ demo");
        var comp;
        try {
            comp = project.items.addComp(COMP_NAME, WIDTH, HEIGHT, 1, DURATION, FPS);
            comp.bgColor = [0, 0, 0];
            comp.comment = "World XYZ demo: gradient points driven by 3D nulls.";

            // --- the layer the effect lives on
            var bg = comp.layers.addSolid([0, 0, 0], "BG", WIDTH, HEIGHT, 1);
            bg.comment = "Carries VR Color Gradients 3D. Everything else here only drives it.";

            var fx = bg.property("ADBE Effect Parade").addProperty(MATCH_NAME);

            setParam(fx, "Point Space", 2);        // 1 = Equirect + Distance, 2 = World XYZ
            setParam(fx, "Depth Scale", DEPTH_SCALE);
            setParam(fx, "Points Number", LIGHTS.length);

            // --- the origin everything is measured from
            var viewer = makeNull(comp, "VIEWER", 16,
                "The 360 nodal point. Move this and the whole gradient re-frames.");
            viewer.property("Position").setValue([WIDTH / 2, HEIGHT / 2, 0]);

            // --- one null per light, each driving one gradient point
            for (var i = 0; i < LIGHTS.length; i++) {
                var light = LIGHTS[i];
                var n = makeNull(comp, light.name, light.label, light.note);

                if (light.offset) {
                    n.property("Position").setValue([
                        WIDTH / 2 + light.offset[0],
                        HEIGHT / 2 + light.offset[1],
                        light.offset[2]
                    ]);
                } else {
                    // The flyby: straight past the viewer, near side.
                    var pos = n.property("Position");
                    pos.setValueAtTime(0, [
                        WIDTH / 2 - FLYBY.sweep_x, HEIGHT / 2 + FLYBY.y, FLYBY.near_z]);
                    pos.setValueAtTime(comp.duration, [
                        WIDTH / 2 + FLYBY.sweep_x, HEIGHT / 2 + FLYBY.y, FLYBY.near_z]);
                    for (var k = 1; k <= pos.numKeys; k++) {
                        pos.setInterpolationTypeAtKey(
                            k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                    }
                }

                var point = findParam(fx, "Point " + (i + 1));
                if (!point) throw new Error("the effect has no Point " + (i + 1));
                point.expression = pointExpression(light.name, viewer.name);

                setParam(fx, "Color " + (i + 1),
                         [light.color[0], light.color[1], light.color[2], 1]);
            }

            comp.openInViewer();
        } catch (e) {
            alert("Error: " + e.toString(), SCRIPT_NAME);
            return;
        } finally {
            app.endUndoGroup();
        }

        alert("Built \"" + COMP_NAME + "\".\n\n" +
              "Scrub the timeline and watch LIGHT Flyby: as it passes the\n" +
              "viewer its colour blooms across the sphere, then tightens\n" +
              "again as it recedes. That is the Z axis doing its work.\n\n" +
              "Try next:\n" +
              "  - Move any LIGHT null and watch the colour follow it in 3D.\n" +
              "  - Move VIEWER to re-frame the whole environment at once.\n" +
              "  - Change Depth Scale (" + DEPTH_SCALE + ") to rescale depth:\n" +
              "    lower spreads everything, higher tightens it.\n" +
              "  - Switch Point Space back to Equirect + Distance to see what\n" +
              "    the same points mean in the flat frame.", SCRIPT_NAME);
    }

    build();

})();
