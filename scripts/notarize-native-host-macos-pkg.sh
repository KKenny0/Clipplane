#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"

profile="${CLIPPLANE_NOTARY_PROFILE:-clipplane-notary}"

# Keep provenance in one process: a notarization run always rebuilds the signed
# package from the current clean commit before submitting those exact bytes.
bash "$project_root/scripts/package-native-host-macos-pkg.sh"

version="$(node -p 'require("./package.json").version')"
arch="$(uname -m)"
case "$arch" in
  arm64) bundle_arch="arm64" ;;
  x86_64) bundle_arch="x64" ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac
pkg_path="$project_root/dist/clipplane-host-v${version}-macos-${bundle_arch}.pkg"
provenance_path="$pkg_path.provenance"
source_head="$(git rev-parse HEAD)"
submitted_sha256="$(shasum -a 256 "$pkg_path" | awk '{print $1}')"

xcrun notarytool history --keychain-profile "$profile" >/dev/null
xcrun notarytool submit "$pkg_path" --keychain-profile "$profile" --wait

if [ "$(git rev-parse HEAD)" != "$source_head" ] || [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "Source changed while the macOS package was being notarized." >&2
  exit 1
fi
if [ "$(shasum -a 256 "$pkg_path" | awk '{print $1}')" != "$submitted_sha256" ]; then
  echo "Package bytes changed while the macOS package was being notarized." >&2
  exit 1
fi

xcrun stapler staple "$pkg_path"
xcrun stapler validate "$pkg_path"
spctl --assess --type install --verbose=2 "$pkg_path"

final_sha256="$(shasum -a 256 "$pkg_path" | awk '{print $1}')"
provenance_tmp="${provenance_path}.tmp.$$"
printf 'head=%s\nsubmitted_sha256=%s\nsha256=%s\nstate=stapled\n' \
  "$source_head" "$submitted_sha256" "$final_sha256" > "$provenance_tmp"
mv "$provenance_tmp" "$provenance_path"

echo "Notarized and stapled ${pkg_path#"$project_root/"}"
