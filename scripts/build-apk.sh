#!/usr/bin/env bash
# Build the VoltLab Android APK (Tier 1 — operator/demo shell around docs/demo).
#
# The APK in the v1.1.0 release was built with this recipe. It uses Capacitor 7
# and a scratch project outside this repo (default: ../apk), so the main
# package.json stays untouched. Requires JDK 21 (with javac), ANDROID_HOME with
# build-tools + platforms, and a release keystore.
#
# Usage:  scripts/build-apk.sh [output.apk]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${APK_WORK:-$REPO/../apk}"
OUT="${1:-$REPO/dist/VoltLab-$(node -p "require('$REPO/package.json').version").apk}"

# 0) prerequisites ------------------------------------------------------------
[ -x "$(command -v javac)" ] || { echo "need a full JDK (javac) on PATH — e.g. a Temurin 21 JDK"; exit 1; }
[ -n "${ANDROID_HOME:-}" ] || { echo "set ANDROID_HOME (needs platforms;android-35 + build-tools)"; exit 1; }
if [ ! -f "$WORK/voltlab-release.keystore" ]; then
  mkdir -p "$WORK"
  echo "Generating release keystore at $WORK/voltlab-release.keystore"
  keytool -genkeypair -v -keystore "$WORK/voltlab-release.keystore" -alias voltlab \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass VoltLab2026!Release -keypass VoltLab2026!Release \
    -dname "CN=VoltLab, OU=VoltLab, O=touhidsiddiqueeraj-bit, L=Dhaka, C=BD"
fi

# 1) scratch capacitor project ------------------------------------------------
cd "$WORK"
[ -f package.json ] || npm init -y > /dev/null
[ -d node_modules/@capacitor/android ] || npm i -D @capacitor/cli@7 @capacitor/core@7 @capacitor/android@7

cat > capacitor.config.json <<'EOF'
{
  "appId": "io.voltlab.simulator",
  "appName": "VoltLab",
  "webDir": "www",
  "android": { "allowMixedContent": false },
  "server": { "androidScheme": "https" }
}
EOF

rm -rf www && cp -r "$REPO/docs/demo" www

if [ ! -d android ]; then
  npx cap add android
  # version + signing wiring — mirrors what's in the v1.1.0 build:
  #   app/build.gradle: versionName "1.1.0", versionCode 2,
  #   signingConfigs.release from android/voltlab-release.properties
  # (kept out of the repo; regenerate or copy from a previous build)
  echo "NOTE: set versionName/versionCode and signing config in android/app/build.gradle"
fi

npx cap sync android

# 2) launcher icons from the app logo -----------------------------------------
python3 "$REPO/../scripts/make_android_icons.py" || \
  echo "WARNING: icon script not found (paths assume a sibling checkout layout)"

# 3) keystore properties --------------------------------------------------------
cat > android/voltlab-release.properties <<EOF
storeFile=../voltlab-release.keystore
storePassword=VoltLab2026!Release
keyAlias=voltlab
keyPassword=VoltLab2026!Release
EOF
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# 4) build -----------------------------------------------------------------------
cd android
JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(command -v javac)")")}" \
  ./gradlew assembleRelease --no-daemon

mkdir -p "$(dirname "$OUT")"
cp app/build/outputs/apk/release/app-release.apk "$OUT"
echo "APK written to $OUT"
