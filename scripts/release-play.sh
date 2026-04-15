#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${REPO_ROOT}/mobile-app/android"

cd "${ANDROID_DIR}"

./gradlew bundleRelease publishReleaseBundle

VERSION_NAME="$(grep -E '^\s*versionName\s+' app/build.gradle | head -n1 | sed -E 's/.*versionName\s+"([^"]+)".*/\1/')"

echo "Successfully uploaded ZapArc ${VERSION_NAME} to Play Console internal track."
