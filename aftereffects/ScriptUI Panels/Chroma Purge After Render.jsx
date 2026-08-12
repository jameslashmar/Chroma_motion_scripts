/**
 * Chroma Purge After Render
 *
 * Renders the After Effects render queue and purges caches after each item,
 * so long queues don't degrade as RAM and disk cache fill up.
 *
 * Memory caches go through app.purge(). The disk cache has no scripting API,
 * so it is cleared by deleting *.aecache files inside the *.noindex folders
 * under the cache root read from preferences at runtime -- never a hardcoded
 * path, since the cache folder is nearly always moved off the default.
 *
 * Windows + macOS. ExtendScript only: no shell calls, no platform branches.
 *
 * Install: <AE install>/Support Files/Scripts/ScriptUI Panels/
 * Then: Window > Chroma Purge After Render
 */

#targetengine "ChromaPurgeAfterRender"

(function chromaPurgeAfterRender(thisObj) {

    var SCRIPT_NAME = "Chroma Purge After Render";
    var SETTINGS_SECTION = "ChromaPurgeAfterRender";

    // Preference lookup for the disk cache location. The key carries a version
    // suffix that Adobe bumps between releases ("Folder 7" in 26.0), so probe a
    // range rather than assuming one.
    var PREF_SECTION = "Disk Cache Controls";
    var PREF_FOLDER_KEYS = buildSuffixedKeys("Folder", 40);
    var PREF_ENABLED_KEYS = buildSuffixedKeys("Enabled", 40);

    var CACHE_EXT = ".aecache";
    var NOINDEX_RE = /\.noindex$/i;
    var MAX_SCAN_DEPTH = 5;

    // ---------------------------------------------------------------- helpers

    function buildSuffixedKeys(base, max) {
        var keys = [base];
        for (var i = max; i >= 1; i--) keys.push(base + " " + i);
        return keys;
    }

    function findPref(section, keys) {
        for (var i = 0; i < keys.length; i++) {
            try {
                if (app.preferences.havePref(section, keys[i], PREFType.PREF_Type_MACHINE_SPECIFIC)) {
                    return keys[i];
                }
            } catch (e) {
                // havePref throws on some malformed sections; keep probing.
            }
        }
        return null;
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + " B";
        var units = ["KB", "MB", "GB", "TB"];
        var value = bytes / 1024;
        var unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value = value / 1024;
            unit++;
        }
        return (Math.round(value * 10) / 10) + " " + units[unit];
    }

    function currentVersionTag() {
        // app.version looks like "26.0x33"; the cache folder is named "26.0".
        var match = String(app.version).match(/^(\d+\.\d+)/);
        return match ? match[1] : null;
    }

    // ------------------------------------------------------------- disk cache

    function getSavedCacheRoot() {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, "cacheRoot")) {
                var saved = new Folder(app.settings.getSetting(SETTINGS_SECTION, "cacheRoot"));
                if (saved.exists) return saved;
            }
        } catch (e) {}
        return null;
    }

    /**
     * Resolve the disk cache root: preferences first, then a user-chosen
     * override saved from a previous session. Returns null if neither resolves.
     */
    function resolveCacheRoot() {
        var key = findPref(PREF_SECTION, PREF_FOLDER_KEYS);
        if (key) {
            var path = "";
            try {
                path = app.preferences.getPrefAsString(
                    PREF_SECTION, key, PREFType.PREF_Type_MACHINE_SPECIFIC);
            } catch (e) {}
            path = String(path || "").replace(/[\\\/]+$/, "");
            if (path) {
                var folder = new Folder(path);
                if (folder.exists) return folder;
            }
        }
        return getSavedCacheRoot();
    }

    function diskCacheEnabledInPrefs() {
        var key = findPref(PREF_SECTION, PREF_ENABLED_KEYS);
        if (!key) return true; // unknown -- don't block the user
        try {
            var value = app.preferences.getPrefAsString(
                PREF_SECTION, key, PREFType.PREF_Type_MACHINE_SPECIFIC);
            return String(value) !== "0";
        } catch (e) {
            return true;
        }
    }

    /**
     * Collect the *.noindex cache folders beneath a root. On both platforms the
     * layout is <root>/Adobe/After Effects/<version>/Disk Cache - <host>.noindex
     * but the walk stays generic so it survives layout changes.
     */
    function findNoindexFolders(root, versionTag) {
        var found = [];

        function walk(folder, depth) {
            if (depth > MAX_SCAN_DEPTH) return;
            var entries;
            try {
                entries = folder.getFiles();
            } catch (e) {
                return;
            }
            if (!entries) return;
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (!(entry instanceof Folder)) continue;
                if (NOINDEX_RE.test(entry.name)) {
                    if (versionTag) {
                        var parent = entry.parent ? decodeURI(entry.parent.name) : "";
                        if (parent !== versionTag) continue;
                    }
                    found.push(entry);
                } else {
                    walk(entry, depth + 1);
                }
            }
        }

        walk(root, 0);
        return found;
    }

    function collectCacheFiles(noindexFolders) {
        var files = [];

        function walk(folder, depth) {
            if (depth > MAX_SCAN_DEPTH) return;
            var entries;
            try {
                entries = folder.getFiles();
            } catch (e) {
                return;
            }
            if (!entries) return;
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (entry instanceof Folder) {
                    walk(entry, depth + 1);
                } else {
                    var name = decodeURI(entry.name).toLowerCase();
                    if (name.length > CACHE_EXT.length &&
                        name.substr(name.length - CACHE_EXT.length) === CACHE_EXT) {
                        files.push(entry);
                    }
                }
            }
        }

        for (var i = 0; i < noindexFolders.length; i++) walk(noindexFolders[i], 0);
        return files;
    }

    function measureDiskCache(versionTag) {
        var result = { root: null, files: 0, bytes: 0 };
        var root = resolveCacheRoot();
        if (!root) return result;
        result.root = root;

        var files = collectCacheFiles(findNoindexFolders(root, versionTag));
        for (var i = 0; i < files.length; i++) {
            result.files++;
            try {
                result.bytes += files[i].length;
            } catch (e) {}
        }
        return result;
    }

    /**
     * Delete cached frames. Only files ending in .aecache, and only inside a
     * *.noindex folder -- so a cache root pointed at a populated directory (or a
     * drive root) can never lose anything that isn't an AE cache frame.
     */
    function purgeDiskCache(versionTag, onProgress) {
        var outcome = { root: null, deleted: 0, failed: 0, bytes: 0 };
        var root = resolveCacheRoot();
        if (!root) return outcome;
        outcome.root = root;

        var files = collectCacheFiles(findNoindexFolders(root, versionTag));
        for (var i = 0; i < files.length; i++) {
            var size = 0;
            try {
                size = files[i].length;
            } catch (e) {}

            var removed = false;
            try {
                removed = files[i].remove();
            } catch (e) {
                removed = false;
            }

            if (removed) {
                outcome.deleted++;
                outcome.bytes += size;
            } else {
                outcome.failed++;
            }

            if (onProgress && (i % 250 === 0)) {
                onProgress(i + 1, files.length);
            }
        }
        return outcome;
    }

    // ----------------------------------------------------------------- purging

    function purgeMemory(options) {
        if (options.allMemory) app.purge(PurgeTarget.ALL_CACHES);
        if (options.undo) app.purge(PurgeTarget.UNDO_CACHES);
        if (options.snapshots) app.purge(PurgeTarget.SNAPSHOT_CACHES);
    }

    function runPurge(options, log) {
        purgeMemory(options);

        var parts = [];
        if (options.allMemory) parts.push("memory");
        if (options.undo) parts.push("undo");
        if (options.snapshots) parts.push("snapshots");

        if (options.disk) {
            var outcome = purgeDiskCache(options.versionTag, function (done, total) {
                log("Disk cache: " + done + " / " + total + "...");
            });
            if (!outcome.root) {
                parts.push("disk cache NOT FOUND");
            } else {
                parts.push("disk " + outcome.deleted + " files / " + formatBytes(outcome.bytes) +
                    (outcome.failed ? " (" + outcome.failed + " locked)" : ""));
            }
        }

        return parts.length ? parts.join(", ") : "nothing selected";
    }

    // ------------------------------------------------------------ render queue

    function queuedIndices() {
        var rq = app.project.renderQueue;
        var indices = [];
        for (var i = 1; i <= rq.numItems; i++) {
            if (rq.item(i).status === RQItemStatus.QUEUED) indices.push(i);
        }
        return indices;
    }

    /**
     * Render one item at a time, purging between items. Slower to start each
     * item than a single render() call, but the purge never lands while the
     * render engine is mid-frame.
     */
    function renderSequential(options, log) {
        var rq = app.project.renderQueue;
        var indices = queuedIndices();
        if (!indices.length) {
            log("Nothing queued.");
            return;
        }

        log("Rendering " + indices.length + " item(s), one at a time.");

        var i;
        for (i = 0; i < indices.length; i++) rq.item(indices[i]).render = false;

        try {
            for (i = 0; i < indices.length; i++) {
                var item = rq.item(indices[i]);
                item.render = true;
                log("Item " + (i + 1) + " of " + indices.length + ": rendering...");
                rq.render();
                log("Item " + (i + 1) + " done. Purging: " + runPurge(options, log));
            }
            log("Queue complete.");
        } finally {
            // Re-queue anything left parked if a render errored out.
            for (var j = 0; j < indices.length; j++) {
                var left = rq.item(indices[j]);
                if (left.status === RQItemStatus.UNQUEUED) left.render = true;
            }
        }
    }

    /**
     * Hand the whole queue to AE and purge from each item's onStatusChanged
     * callback. Faster between items; the purge runs while AE is still inside
     * render().
     */
    function renderHooked(options, log) {
        var rq = app.project.renderQueue;
        var indices = queuedIndices();
        if (!indices.length) {
            log("Nothing queued.");
            return;
        }

        log("Rendering " + indices.length + " item(s) with purge hooks.");

        for (var i = 0; i < indices.length; i++) {
            rq.item(indices[i]).onStatusChanged = (function (index, position, total) {
                return function () {
                    var item = app.project.renderQueue.item(index);
                    if (item.status !== RQItemStatus.DONE) return;
                    log("Item " + position + " of " + total + " done. Purging: " +
                        runPurge(options, log));
                };
            })(indices[i], i + 1, indices.length);
        }

        try {
            rq.render();
            log("Queue complete.");
        } finally {
            for (var k = 0; k < indices.length; k++) {
                try {
                    rq.item(indices[k]).onStatusChanged = null;
                } catch (e) {}
            }
        }
    }

    // ---------------------------------------------------------------------- UI

    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        win.alignChildren = ["fill", "top"];
        win.spacing = 8;
        win.margins = 12;

        var versionTag = currentVersionTag();

        // --- what to purge
        var purgeGroup = win.add("panel", undefined, "Purge after each item");
        purgeGroup.alignChildren = ["left", "top"];
        purgeGroup.margins = [12, 16, 12, 12];
        purgeGroup.spacing = 5;

        var cbMemory = purgeGroup.add("checkbox", undefined, "All memory caches");
        var cbUndo = purgeGroup.add("checkbox", undefined, "Undo history");
        var cbSnapshots = purgeGroup.add("checkbox", undefined, "Snapshots");
        var cbDisk = purgeGroup.add("checkbox", undefined, "Disk cache (deletes .aecache files)");
        var cbThisVersion = purgeGroup.add("checkbox", undefined, "This AE version only" +
            (versionTag ? " (" + versionTag + ")" : ""));
        cbThisVersion.indent = 18;

        // --- how to drive the queue
        var modeGroup = win.add("panel", undefined, "Render mode");
        modeGroup.alignChildren = ["left", "top"];
        modeGroup.margins = [12, 16, 12, 12];
        modeGroup.spacing = 5;

        var rbSequential = modeGroup.add("radiobutton", undefined, "One item at a time (safest)");
        var rbHooked = modeGroup.add("radiobutton", undefined, "Whole queue, purge on status change");

        // --- cache location
        var cacheGroup = win.add("panel", undefined, "Disk cache");
        cacheGroup.alignChildren = ["fill", "top"];
        cacheGroup.margins = [12, 16, 12, 12];
        cacheGroup.spacing = 5;

        var cachePath = cacheGroup.add("statictext", undefined, "Locating...",
            { truncate: "middle" });
        var cacheSize = cacheGroup.add("statictext", undefined, "");

        var cacheButtons = cacheGroup.add("group");
        cacheButtons.alignment = ["fill", "top"];
        var btnMeasure = cacheButtons.add("button", undefined, "Measure");
        var btnReveal = cacheButtons.add("button", undefined, "Reveal");
        var btnSetRoot = cacheButtons.add("button", undefined, "Set...");

        // --- actions
        var actions = win.add("group");
        actions.alignment = ["fill", "top"];
        actions.alignChildren = ["fill", "center"];
        var btnRender = actions.add("button", undefined, "Render Queue + Purge");
        var btnPurgeNow = actions.add("button", undefined, "Purge Now");

        var status = win.add("edittext", undefined, "", { multiline: true, readonly: true });
        status.preferredSize = [-1, 110];
        status.alignment = ["fill", "fill"];

        // ------------------------------------------------------------ plumbing

        function refresh() {
            try {
                win.update();
            } catch (e) {}
        }

        var logLines = [];
        function log(message) {
            logLines.push(message);
            if (logLines.length > 200) logLines.shift();
            status.text = logLines.join("\n");
            refresh();
        }

        function currentOptions() {
            return {
                allMemory: cbMemory.value,
                undo: cbUndo.value,
                snapshots: cbSnapshots.value,
                disk: cbDisk.value,
                versionTag: cbThisVersion.value ? versionTag : null
            };
        }

        function loadSettings() {
            function read(key, fallback) {
                try {
                    if (app.settings.haveSetting(SETTINGS_SECTION, key)) {
                        return app.settings.getSetting(SETTINGS_SECTION, key) === "1";
                    }
                } catch (e) {}
                return fallback;
            }
            cbMemory.value = read("allMemory", true);
            cbUndo.value = read("undo", true);
            cbSnapshots.value = read("snapshots", false);
            cbDisk.value = read("disk", false);
            cbThisVersion.value = read("thisVersion", true);
            var sequential = read("sequential", true);
            rbSequential.value = sequential;
            rbHooked.value = !sequential;
        }

        function saveSettings() {
            function write(key, value) {
                try {
                    app.settings.saveSetting(SETTINGS_SECTION, key, value ? "1" : "0");
                } catch (e) {}
            }
            write("allMemory", cbMemory.value);
            write("undo", cbUndo.value);
            write("snapshots", cbSnapshots.value);
            write("disk", cbDisk.value);
            write("thisVersion", cbThisVersion.value);
            write("sequential", rbSequential.value);
        }

        function syncEnabled() {
            cbThisVersion.enabled = cbDisk.value;
            saveSettings();
        }

        function updateCacheInfo(measure) {
            var root = resolveCacheRoot();
            if (!root) {
                cachePath.text = "Not found in preferences";
                cacheSize.text = "Use Set... to point at your cache folder.";
                return;
            }
            cachePath.text = root.fsName;

            if (!measure) {
                cacheSize.text = diskCacheEnabledInPrefs()
                    ? "Disk cache enabled. Measure for size."
                    : "Disk cache is disabled in Preferences.";
                return;
            }

            cacheSize.text = "Measuring...";
            refresh();
            var info = measureDiskCache(cbThisVersion.value ? versionTag : null);
            cacheSize.text = info.files + " cached frames, " + formatBytes(info.bytes);
        }

        cbMemory.onClick = saveSettings;
        cbUndo.onClick = saveSettings;
        cbSnapshots.onClick = saveSettings;
        cbThisVersion.onClick = function () {
            saveSettings();
            updateCacheInfo(false);
        };
        rbSequential.onClick = saveSettings;
        rbHooked.onClick = saveSettings;

        cbDisk.onClick = function () {
            syncEnabled();
            if (cbDisk.value) updateCacheInfo(false);
        };

        btnMeasure.onClick = function () {
            updateCacheInfo(true);
        };

        btnReveal.onClick = function () {
            var root = resolveCacheRoot();
            if (root && root.exists) {
                root.execute();
            } else {
                log("No cache folder to reveal.");
            }
        };

        btnSetRoot.onClick = function () {
            var chosen = Folder.selectDialog("Choose the After Effects disk cache folder");
            if (!chosen) return;
            try {
                app.settings.saveSetting(SETTINGS_SECTION, "cacheRoot", chosen.fsName);
            } catch (e) {}
            log("Cache folder override set: " + chosen.fsName);
            updateCacheInfo(false);
        };

        btnPurgeNow.onClick = function () {
            var options = currentOptions();
            if (options.disk && !confirmDiskPurge()) return;
            log("Purged: " + runPurge(options, log));
            if (options.disk) updateCacheInfo(false);
        };

        btnRender.onClick = function () {
            var options = currentOptions();
            if (options.disk && !confirmDiskPurge()) return;

            btnRender.enabled = false;
            btnPurgeNow.enabled = false;
            try {
                if (rbSequential.value) {
                    renderSequential(options, log);
                } else {
                    renderHooked(options, log);
                }
            } catch (e) {
                log("ERROR: " + e.toString());
            } finally {
                btnRender.enabled = true;
                btnPurgeNow.enabled = true;
            }
        };

        function confirmDiskPurge() {
            var root = resolveCacheRoot();
            if (!root) {
                alert("Disk cache folder could not be resolved.\n\n" +
                    "Set it manually with the Set... button.", SCRIPT_NAME);
                return false;
            }
            return confirm("Delete cached frames from:\n\n" + root.fsName + "\n\n" +
                "Only .aecache files inside .noindex folders are removed. " +
                "After Effects will re-render anything it needs again.",
                false, SCRIPT_NAME);
        }

        loadSettings();
        syncEnabled();
        updateCacheInfo(false);

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
