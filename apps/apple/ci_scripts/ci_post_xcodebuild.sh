#!/bin/bash
# Adapted from Maple cf6d05cec1c49c9e418cf5f5c6439925362fd3ec.
# Package Xcode Cloud's Developer ID export of the ONE production archive.
set -euo pipefail
if [ "${CI_PRODUCT_PLATFORM:-}" != macOS ]; then
  echo 'Not a macOS archive; skipping direct distribution'; exit 0
fi
if [ "${CI_XCODEBUILD_ACTION:-}" != archive ] || [ -z "${CI_TAG:-}" ]; then
  echo 'Not a tag archive; skipping direct distribution'; exit 0
fi
if [ "${CI_XCODEBUILD_EXIT_CODE:-1}" != 0 ]; then
  echo 'Archive failed; skipping direct distribution'; exit 0
fi
[[ "$CI_TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  echo 'error: Expected a stable vMAJOR.MINOR.PATCH tag' >&2; exit 1;
}
for variable in CI_ARCHIVE_PATH CI_COMMIT CI_DEVELOPER_ID_SIGNED_APP_PATH GITHUB_TOKEN AC_KEY_ID AC_ISSUER_ID AC_PRIVATE_KEY; do
  [ -n "${!variable:-}" ] || { echo "error: Missing Xcode Cloud variable: $variable" >&2; exit 1; }
done
[[ "$CI_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'error: Invalid archive commit' >&2; exit 1; }
export GH_TOKEN="$GITHUB_TOKEN"
REPOSITORY=zubair-io/Just-Maple
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v gh >/dev/null 2>&1; then HOMEBREW_NO_AUTO_UPDATE=1 brew install gh; fi
[ "$(gh api "repos/$REPOSITORY/commits/$CI_TAG" --jq .sha)" = "$CI_COMMIT" ] || {
  echo 'error: Tag and archive commit disagree' >&2; exit 1;
}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/just-maple-cloud-release.XXXXXX")
MOUNT="$WORK/mount"
cleanup() { hdiutil detach "$MOUNT" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
umask 077
APPLICATION_PATH=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:ApplicationPath' "$CI_ARCHIVE_PATH/Info.plist")
ARCHIVED_INFO="$CI_ARCHIVE_PATH/Products/$APPLICATION_PATH/Contents/Info.plist"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$ARCHIVED_INFO")" = MacOSX ]
if [[ "$CI_DEVELOPER_ID_SIGNED_APP_PATH" == *.app ]] && [ -d "$CI_DEVELOPER_ID_SIGNED_APP_PATH" ]; then
  SOURCE_APP="$CI_DEVELOPER_ID_SIGNED_APP_PATH"
else
  SOURCE_APP=$(find "$CI_DEVELOPER_ID_SIGNED_APP_PATH" -maxdepth 4 -type d -name 'JapaneseMaple.app' -print -quit)
fi
[ -n "$SOURCE_APP" ] || { echo 'error: Developer ID export missing' >&2; exit 1; }
APP="$WORK/JapaneseMaple.app"
ditto "$SOURCE_APP" "$APP"
INFO="$APP/Contents/Info.plist"
VERSION=${CI_TAG#v}
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO")" = "$VERSION" ]
BUILD_NUMBER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO")
[[ "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]]
EXECUTABLE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO")
[ "$EXECUTABLE" = 'JapaneseMaple' ]
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --verbose=4 "$APP" 2> "$WORK/signature.txt"
grep -Fq 'Authority=Developer ID Application:' "$WORK/signature.txt"
grep -Fxq 'TeamIdentifier=QREP66JW5U' "$WORK/signature.txt"
grep -Fxq 'Identifier=com.just.maple.JapaneseMaple' "$WORK/signature.txt"
grep -q 'flags=.*runtime' "$WORK/signature.txt"
for architecture in arm64 x86_64; do lipo "$APP/Contents/MacOS/$EXECUTABLE" -verify_arch "$architecture"; done
KEY="$WORK/AuthKey.p8"
printf '%s' "$AC_PRIVATE_KEY" > "$KEY"
notarize() {
  xcrun notarytool submit "$1" --key "$KEY" --key-id "$AC_KEY_ID" --issuer "$AC_ISSUER_ID" \
    --wait --timeout 2h --output-format json > "$2"
  [ "$(/usr/bin/plutil -extract status raw -o - "$2")" = Accepted ]
}
ditto -c -k --keepParent "$APP" "$WORK/app.zip"
notarize "$WORK/app.zip" "$WORK/app-notary.json"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
mkdir "$WORK/dmg"
ditto "$APP" "$WORK/dmg/JapaneseMaple.app"
ln -s /Applications "$WORK/dmg/Applications"
DMG_NAME="JustMaple-macOS-$VERSION.dmg"
DMG="$WORK/$DMG_NAME"
hdiutil create -volname 'Just Maple' -srcfolder "$WORK/dmg" -format UDZO "$DMG"
hdiutil verify "$DMG"
notarize "$DMG" "$WORK/dmg-notary.json"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
# Cloud does not expose its signing private key. The app is signed; the
# container is notarized/stapled. Assess the app from the final mounted DMG.
mkdir "$MOUNT"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" >/dev/null
codesign --verify --deep --strict "$MOUNT/JapaneseMaple.app"
spctl --assess --type execute --verbose=2 "$MOUNT/JapaneseMaple.app"
hdiutil detach "$MOUNT" >/dev/null
(cd "$WORK" && shasum -a 256 "$DMG_NAME" > SHA256SUMS.txt)
export VERSION BUILD_NUMBER DMG_NAME
python3 - "$WORK" <<'PY'
import hashlib, json, os, sys
from pathlib import Path
directory = Path(sys.argv[1])
dmg = directory / os.environ['DMG_NAME']
metadata = dict(schema=1, tag=os.environ['CI_TAG'], commit=os.environ['CI_COMMIT'],
                version=os.environ['VERSION'], build=os.environ['BUILD_NUMBER'],
                asset=dmg.name, sha256=hashlib.sha256(dmg.read_bytes()).hexdigest(),
                team='QREP66JW5U', bundle='com.just.maple.JapaneseMaple',
                architectures=['arm64', 'x86_64'], app_notarization='Accepted',
                dmg_notarization='Accepted', source='xcode-cloud-archive')
(directory / 'release-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
PY
if ! gh release view "$CI_TAG" --repo "$REPOSITORY" >/dev/null 2>&1; then
  gh release create "$CI_TAG" --repo "$REPOSITORY" --verify-tag --draft \
    --title "Just Maple $VERSION" --generate-notes || gh release view "$CI_TAG" --repo "$REPOSITORY" >/dev/null
fi
[ "$(gh release view "$CI_TAG" --repo "$REPOSITORY" --json isDraft --jq .isDraft)" = true ] || {
  echo 'error: Refusing to overwrite a published release' >&2; exit 1;
}
gh release upload "$CI_TAG" "$DMG" "$WORK/SHA256SUMS.txt" "$WORK/release-metadata.json" \
  --repo "$REPOSITORY" --clobber
echo "Uploaded validated Cloud archive $CI_COMMIT ($VERSION build $BUILD_NUMBER) to draft $CI_TAG"
