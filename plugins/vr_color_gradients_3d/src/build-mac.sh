#!/usr/bin/env bash
#
# build-mac.sh - build ChromaVRGradient3D.plugin (After Effects effect, macOS)
#
#   ./build-mac.sh              # build a universal bundle
#   ./build-mac.sh --install    # build, then copy into After Effects
#   ./build-mac.sh --clean      # wipe intermediates first
#
# The Windows counterpart is build.ps1 beside this file. Same three stages -
# resource, compile, assemble - but macOS wants a bundle rather than a flat
# .aex, and the PiPL goes through Rez instead of PiPLtool + rc:
#
#   ChromaVRGradient3D.plugin/
#     Contents/
#       Info.plist                        eFKT / FXTC, which is what marks it
#       PkgInfo                           an After Effects effect
#       MacOS/ChromaVRGradient3D          universal arm64 + x86_64 Mach-O
#       Resources/ChromaVRGradient3D.rsrc the compiled PiPL
#
# Like build.ps1, nothing here is hardcoded to one machine: the SDK is found by
# looking for AE_Effect.h, and After Effects by taking the highest-numbered
# install. Set AE_SDK or AE_APP to override either.

set -euo pipefail

NAME="ChromaVRGradient3D"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/src"
OBJ="$SRC/obj-mac"
BUNDLE="$HERE/$NAME.plugin"

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31m!!! %s\033[0m\n' "$1" >&2; exit 1; }

for arg in "$@"; do
    case "$arg" in
        --clean)   rm -rf "$OBJ" "$BUNDLE" ;;
        --install) DO_INSTALL=1 ;;
        *)         fail "unknown option: $arg" ;;
    esac
done

# --- locate the SDK ----------------------------------------------------
if [ -z "${AE_SDK:-}" ]; then
    for guess in "$HOME/Documents/AE_SDK"/*/Examples "$HOME/AE_SDK"/*/Examples \
                 /Applications/AE_SDK/*/Examples; do
        if [ -f "$guess/Headers/AE_Effect.h" ]; then AE_SDK="$guess"; break; fi
    done
fi
[ -n "${AE_SDK:-}" ] && [ -f "$AE_SDK/Headers/AE_Effect.h" ] \
    || fail "After Effects SDK not found. Set AE_SDK to its Examples folder."

REZ="$(xcrun --find Rez 2>/dev/null)" || fail "Rez not found - install Xcode."
MACSDK="$(xcrun --show-sdk-path)"

echo "    SDK : $AE_SDK"
echo "    Rez : $REZ"

mkdir -p "$OBJ" \
         "$BUNDLE/Contents/MacOS" \
         "$BUNDLE/Contents/Resources"

# --- 1. the PiPL, through Rez -----------------------------------------
# The .r pulls in AE_General.r, and Rez needs the Carbon headers for the
# resource types the SDK's own .r files are written against.
step "Compiling the PiPL resource"
CARBON="$MACSDK/System/Library/Frameworks/CoreServices.framework/Frameworks/CarbonCore.framework/Headers"
"$REZ" -o "$BUNDLE/Contents/Resources/$NAME.rsrc" \
    -d __MACH__ -useDF \
    -i "$AE_SDK/Headers" \
    -i "$AE_SDK/Resources" \
    -i "$CARBON" \
    -i "$MACSDK/System/Library/Frameworks" \
    "$SRC/${NAME}PiPL.r" \
    || fail "Rez failed on the PiPL"
[ -s "$BUNDLE/Contents/Resources/$NAME.rsrc" ] || fail "Rez produced an empty .rsrc"

# --- 2. compile and link the bundle ------------------------------------
# One clang++ call: these are four small translation units and a separate
# compile step would buy nothing but a longer script.
step "Compiling and linking (arm64 + x86_64)"
clang++ \
    -std=c++17 -O2 -fvisibility=hidden -Wall \
    -arch arm64 -arch x86_64 \
    -mmacosx-version-min=11.0 \
    -bundle \
    -I"$AE_SDK/Headers" \
    -I"$AE_SDK/Headers/SP" \
    -I"$AE_SDK/Util" \
    -I"$AE_SDK/Resources" \
    "$SRC/$NAME.cpp" \
    "$AE_SDK/Util/AEGP_SuiteHandler.cpp" \
    "$AE_SDK/Util/MissingSuiteError.cpp" \
    "$AE_SDK/Util/Smart_Utils.cpp" \
    -framework CoreFoundation \
    -framework CoreServices \
    -o "$BUNDLE/Contents/MacOS/$NAME" \
    || fail "compile/link failed"

# --- 3. bundle metadata -------------------------------------------------
# eFKT / FXTC is what tells After Effects this bundle is an effect; without
# it the plug-in is simply never looked at. Matches the SDK's own samples.
step "Writing bundle metadata"
cat > "$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>$NAME</string>
	<key>CFBundleIdentifier</key>
	<string>london.chroma.aftereffects.$NAME</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$NAME</string>
	<key>CFBundlePackageType</key>
	<string>eFKT</string>
	<key>CFBundleSignature</key>
	<string>FXTC</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>LSRequiresCarbon</key>
	<true/>
	<key>NSAppleScriptEnabled</key>
	<string>No</string>
	<key>NSHumanReadableCopyright</key>
	<string>Chroma</string>
</dict>
</plist>
PLIST
printf 'eFKTFXTC' > "$BUNDLE/Contents/PkgInfo"

# Ad-hoc signature. Unsigned bundles are refused on Apple Silicon, and the
# failure is silent - the effect simply never appears.
step "Ad-hoc signing"
codesign --force --sign - --timestamp=none "$BUNDLE" 2>/dev/null \
    || echo "    codesign failed - the effect may not load on Apple Silicon"

step "Built $BUNDLE"
lipo -archs "$BUNDLE/Contents/MacOS/$NAME" | sed 's/^/    architectures: /'
ls -la "$BUNDLE/Contents/MacOS/$NAME" | awk '{print "    " $5 " bytes"}'

# --- 4. optional install -------------------------------------------------
if [ -n "${DO_INSTALL:-}" ]; then
    if [ -z "${AE_APP:-}" ]; then
        AE_APP="$(ls -d /Applications/Adobe\ After\ Effects\ * 2>/dev/null | sort | tail -1)"
    fi
    [ -n "$AE_APP" ] || fail "After Effects not found. Set AE_APP."
    DEST="$AE_APP/Plug-ins/Effects"
    mkdir -p "$DEST"
    step "Installing to $DEST"
    rm -rf "$DEST/$NAME.plugin"
    cp -R "$BUNDLE" "$DEST/"
    echo "    installed. Restart After Effects."
fi
