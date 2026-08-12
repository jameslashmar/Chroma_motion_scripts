// CreateShotFolders.jsx
// After Effects script: creates a set of numbered shot folders (bins) in the Project panel.
// Asks for prefix, zero-padding, start number, step/increment, and how many shots to create.
// Example: prefix "SHOT", padding 3, start 1, step 1, count 10  ->  SHOT001 ... SHOT010

(function createShotFolders() {

    // ---- helpers -------------------------------------------------------------

    function padNumber(num, width) {
        var s = "" + Math.abs(num);
        while (s.length < width) {
            s = "0" + s;
        }
        return (num < 0 ? "-" : "") + s;
    }

    function parseIntStrict(value) {
        // returns NaN if the whole string isn't a clean integer
        if (!/^-?\d+$/.test(value)) { return NaN; }
        return parseInt(value, 10);
    }

    // ---- UI ------------------------------------------------------------------

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

    var prefixFld  = addRow(dlg, "Prefix:", "SHOT");
    var padFld     = addRow(dlg, "Padding (digits):", 3);
    var startFld   = addRow(dlg, "Start number:", 1);
    var stepFld    = addRow(dlg, "Increment / step:", 1);
    var countFld   = addRow(dlg, "How many shots:", 10);

    // Optional: drop everything inside a single parent folder
    var parentGroup = dlg.add("group");
    parentGroup.alignment = ["fill", "top"];
    var parentChk = parentGroup.add("checkbox", undefined, "Group inside a parent folder named:");
    parentChk.value = false;
    var parentNameFld = parentGroup.add("edittext", undefined, "SHOTS");
    parentNameFld.characters = 12;
    parentNameFld.enabled = false;
    parentChk.onClick = function () { parentNameFld.enabled = this.value; };

    // live preview of first + last name
    var preview = dlg.add("statictext", undefined, "");
    preview.alignment = ["fill", "top"];
    preview.graphics.font = ScriptUI.newFont(preview.graphics.font.name, "ITALIC", preview.graphics.font.size);

    function updatePreview() {
        var prefix = prefixFld.text;
        var pad    = parseIntStrict(padFld.text);
        var start  = parseIntStrict(startFld.text);
        var step   = parseIntStrict(stepFld.text);
        var count  = parseIntStrict(countFld.text);
        if (isNaN(pad) || isNaN(start) || isNaN(step) || isNaN(count) || count < 1 || pad < 0 || step === 0) {
            preview.text = "Preview: —";
            return;
        }
        var first = prefix + padNumber(start, pad);
        var last  = prefix + padNumber(start + step * (count - 1), pad);
        preview.text = (count === 1) ? ("Preview: " + first)
                                     : ("Preview: " + first + "  …  " + last + "   (" + count + " folders)");
    }
    var watchFields = [prefixFld, padFld, startFld, stepFld, countFld];
    for (var i = 0; i < watchFields.length; i++) {
        watchFields[i].onChanging = updatePreview;
    }
    updatePreview();

    // buttons
    var btns = dlg.add("group");
    btns.alignment = ["fill", "top"];
    btns.alignChildren = ["right", "center"];
    var cancelBtn = btns.add("button", undefined, "Cancel", { name: "cancel" });
    var okBtn     = btns.add("button", undefined, "Create",  { name: "ok" });

    if (dlg.show() !== 1) {
        return; // cancelled
    }

    // ---- validation ----------------------------------------------------------

    var prefix = prefixFld.text;
    var pad    = parseIntStrict(padFld.text);
    var start  = parseIntStrict(startFld.text);
    var step   = parseIntStrict(stepFld.text);
    var count  = parseIntStrict(countFld.text);

    if (isNaN(pad) || pad < 0) {
        alert("Padding must be a whole number (0 or more)."); return;
    }
    if (isNaN(start)) {
        alert("Start number must be a whole number."); return;
    }
    if (isNaN(step) || step === 0) {
        alert("Step / increment must be a whole number and not zero."); return;
    }
    if (isNaN(count) || count < 1) {
        alert("Number of shots must be a whole number of 1 or more."); return;
    }
    if (count > 5000) {
        if (!confirm("That will create " + count + " folders. Continue?")) { return; }
    }

    // ---- create folders ------------------------------------------------------

    app.beginUndoGroup("Create Shot Folders");
    try {
        var parentFolder = null;
        if (parentChk.value && parentNameFld.text !== "") {
            parentFolder = app.project.items.addFolder(parentNameFld.text);
        }

        for (var n = 0; n < count; n++) {
            var num  = start + step * n;
            var name = prefix + padNumber(num, pad);
            var f = app.project.items.addFolder(name);
            if (parentFolder !== null) {
                f.parentFolder = parentFolder;
            }
        }
    } catch (e) {
        alert("Error creating folders:\n" + e.toString());
    } finally {
        app.endUndoGroup();
    }

})();
