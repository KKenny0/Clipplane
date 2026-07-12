#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"

team_id="${CLIPPLANE_APPLE_TEAM_ID:-S7V7CK2G9T}"
application_identity="${CLIPPLANE_APPLICATION_IDENTITY:-Developer ID Application: Jiaye Wu ($team_id)}"
installer_identity="${CLIPPLANE_INSTALLER_IDENTITY:-Developer ID Installer: Jiaye Wu ($team_id)}"
version="$(node -p 'require("./package.json").version')"
arch="$(uname -m)"
case "$arch" in
  arm64) bundle_arch="arm64" ;;
  x86_64) bundle_arch="x64" ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac

bundle_dir="$project_root/dist/clipplane-host-v${version}-macos-${bundle_arch}"
pkg_path="$project_root/dist/clipplane-host-v${version}-macos-${bundle_arch}.pkg"
install_root="Library/Application Support/Clipplane Host"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/clipplane-pkg.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

security find-identity -v -p codesigning | grep -Fq "$application_identity" || {
  echo "Missing valid signing identity: $application_identity" >&2
  exit 1
}
security find-certificate -a -c "$installer_identity" >/dev/null || {
  echo "Missing installer certificate: $installer_identity" >&2
  exit 1
}

npm run package:host:macos

signed_count=0
while IFS= read -r -d '' candidate; do
  if file -b "$candidate" | grep -q 'Mach-O'; then
    codesign --force --options runtime --timestamp --sign "$application_identity" "$candidate"
    codesign --verify --strict --verbose=2 "$candidate"
    signed_count=$((signed_count + 1))
  fi
done < <(find "$bundle_dir" -type f -print0)

if [ "$signed_count" -eq 0 ]; then
  echo "No Mach-O files were found in the Host bundle." >&2
  exit 1
fi

payload_dir="$work_dir/payload"
scripts_dir="$work_dir/scripts"
mkdir -p "$payload_dir/$install_root" "$scripts_dir"
cp -R "$bundle_dir/." "$payload_dir/$install_root/"

cat > "$scripts_dir/postinstall" <<'POSTINSTALL'
#!/usr/bin/env sh
set -eu
host_root="/Library/Application Support/Clipplane Host"
"$host_root/install-host.sh" --browser all
POSTINSTALL
chmod 755 "$scripts_dir/postinstall"

rm -f "$pkg_path"
pkgbuild \
  --root "$payload_dir" \
  --scripts "$scripts_dir" \
  --identifier com.clipplane.host \
  --version "$version" \
  --install-location / \
  --sign "$installer_identity" \
  "$pkg_path"

pkgutil --check-signature "$pkg_path"
assessment="$(spctl --assess --type install --verbose=2 "$pkg_path" 2>&1 || true)"
printf '%s\n' "$assessment"
if ! printf '%s\n' "$assessment" | grep -Eq 'accepted|source=Unnotarized Developer ID'; then
  echo "Gatekeeper returned an unexpected package assessment." >&2
  exit 1
fi

echo "Wrote ${pkg_path#"$project_root/"}"
echo "Signed Mach-O files: $signed_count"
echo "Application identity: $application_identity"
echo "Installer identity: $installer_identity"
echo "Gatekeeper acceptance requires notarization and stapling as the next step."
