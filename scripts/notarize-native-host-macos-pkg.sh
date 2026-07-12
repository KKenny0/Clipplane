#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"

profile="${CLIPPLANE_NOTARY_PROFILE:-clipplane-notary}"
submission_id="${CLIPPLANE_NOTARY_SUBMISSION_ID:-}"
version="$(node -p 'require("./package.json").version')"
arch="$(uname -m)"
case "$arch" in
  arm64) bundle_arch="arm64" ;;
  x86_64) bundle_arch="x64" ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac
pkg_path="$project_root/dist/clipplane-host-v${version}-macos-${bundle_arch}.pkg"

if [ ! -f "$pkg_path" ]; then
  echo "Signed package not found: $pkg_path" >&2
  exit 1
fi

xcrun notarytool history --keychain-profile "$profile" >/dev/null
if [ -n "$submission_id" ]; then
  echo "Resuming notarization submission $submission_id"
  xcrun notarytool wait "$submission_id" --keychain-profile "$profile"
else
  xcrun notarytool submit "$pkg_path" --keychain-profile "$profile" --wait
fi
xcrun stapler staple "$pkg_path"
xcrun stapler validate "$pkg_path"
spctl --assess --type install --verbose=2 "$pkg_path"

echo "Notarized and stapled ${pkg_path#"$project_root/"}"
