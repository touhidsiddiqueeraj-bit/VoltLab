#!/usr/bin/env bash
# Build the VoltLab Android APK (Tier 2 — the FULL editor, offline).
#
# The web layer is the offline bundle from scripts/build-offline-bundle.sh:
# the real editor UI + the in-page engine host (app/js/local-api.js), zero
# server dependency. Capacitor wraps it; @capacitor/filesystem (when present)
# lets exports/screenshots land in the app's Documents directory.
#
# Requires: JDK 21 (javac), ANDROID_HOME (platforms;android-35 + build-tools),
# and a release keystore. See docs/apk.md.
#
# Usage:  scripts/build-apk.sh [output.apk]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${APK_WORK:-$REPO/../apk}"
OUT="${1:-$REPO/dist/VoltLab-$(node -p "require('$REPO/package.json').version").apk}"
VERSION="$(node -p "require('$REPO/package.json').version")"

# 0) prerequisites ------------------------------------------------------------
[ -x "$(command -v javac)" ] || { echo "need a full JDK (javac) on PATH — e.g. a Temurin 21 JDK"; exit 1; }
[ -n "${ANDROID_HOME:-}" ] || { echo "set ANDROID_HOME (needs platforms;android-35 + build-tools)"; exit 1; }
if [ ! -f "$WORK/voltlab-release.keystore" ]; then
  mkdir -p "$WORK"
  # override for real releases: export KEYSTORE_PASSWORD=...
  KS_PASS="${KEYSTORE_PASSWORD:-VoltLab2026!Release}"
  echo "Generating release keystore at $WORK/voltlab-release.keystore"
  keytool -genkeypair -v -keystore "$WORK/voltlab-release.keystore" -alias voltlab \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=VoltLab, OU=VoltLab, O=touhidsiddiqueeraj-bit, L=Dhaka, C=BD"
fi

# 1) the offline web bundle (editor + in-page engine + circuits + manifest) ---
"$REPO/scripts/build-offline-bundle.sh" "$WORK/app-bundle"

# 2) scratch capacitor project ------------------------------------------------
cd "$WORK"
[ -f package.json ] || npm init -y > /dev/null
[ -d node_modules/@capacitor/android ] || npm i -D @capacitor/cli@7 @capacitor/core@7 @capacitor/android@7
[ -d node_modules/@capacitor/filesystem ] || npm i -D @capacitor/filesystem@7

cat > capacitor.config.json <<'EOF'
{
  "appId": "io.voltlab.simulator",
  "appName": "VoltLab",
  "webDir": "www",
  "android": { "allowMixedContent": false },
  "server": { "androidScheme": "https" }
}
EOF

rm -rf www && cp -r app-bundle www

if [ ! -d android ]; then
  npx cap add android
  echo "NOTE: set versionName/versionCode and signing config in android/app/build.gradle"
  echo "      (signing reads android/voltlab-release.properties, written below)"
fi

npx cap sync android

# 3) launcher icons from the app logo -----------------------------------------
python3 "$REPO/../scripts/make_android_icons.py" 2>/dev/null \
  || echo "NOTE: icon script not found (sibling checkout layout assumed) — keeping existing icons"

# 4) keystore properties --------------------------------------------------------
cat > android/voltlab-release.properties <<EOF
storeFile=../../voltlab-release.keystore
storePassword=${KEYSTORE_PASSWORD:-VoltLab2026!Release}
keyAlias=voltlab
keyPassword=${KEYSTORE_PASSWORD:-VoltLab2026!Release}
EOF
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# 5) build -----------------------------------------------------------------------
cd android
JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(command -v javac)")")}" \
  ./gradlew assembleRelease --no-daemon

mkdir -p "$(dirname "$OUT")"
cp app/build/outputs/apk/release/app-release.apk "$OUT"
echo "APK written to $OUT"
