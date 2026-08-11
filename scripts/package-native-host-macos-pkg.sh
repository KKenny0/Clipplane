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
provenance_path="$pkg_path.provenance"
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

source_head="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "The signed macOS package must be built from clean, committed source." >&2
  exit 1
fi
if [ -n "$(git ls-files --others --ignored --exclude-standard -- native-host)" ]; then
  echo "The signed macOS package refuses ignored files under native-host." >&2
  exit 1
fi

npm ci
npm run package:host:macos

node_path="$bundle_dir/runtime/bin/node"
node_entitlements="$work_dir/node-entitlements.plist"
cat > "$node_entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
</dict>
</plist>
PLIST

signed_count=0
while IFS= read -r -d '' candidate; do
  if file -b "$candidate" | grep -q 'Mach-O'; then
    if [ "$candidate" = "$node_path" ]; then
      codesign --force --options runtime --timestamp --entitlements "$node_entitlements" --sign "$application_identity" "$candidate"
    else
      codesign --force --options runtime --timestamp --sign "$application_identity" "$candidate"
    fi
    codesign --verify --strict --verbose=2 "$candidate"
    signed_count=$((signed_count + 1))
  fi
done < <(find "$bundle_dir" -type f -print0)

if [ "$signed_count" -eq 0 ]; then
  echo "No Mach-O files were found in the Host bundle." >&2
  exit 1
fi

node scripts/smoke-native-host-bundle.mjs --target macos --bundle "$bundle_dir"

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
rm -f "$provenance_path"
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

if [ "$(git rev-parse HEAD)" != "$source_head" ] || [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  rm -f "$pkg_path"
  echo "Source changed while the signed macOS package was being built." >&2
  exit 1
fi
pkg_sha256="$(shasum -a 256 "$pkg_path" | awk '{print $1}')"
printf 'head=%s\nsha256=%s\nstate=built\n' "$source_head" "$pkg_sha256" > "$provenance_path"

echo "Wrote ${pkg_path#"$project_root/"}"
echo "Provenance ${provenance_path#"$project_root/"}"
echo "Signed Mach-O files: $signed_count"
echo "Application identity: $application_identity"
echo "Installer identity: $installer_identity"
echo "Gatekeeper acceptance requires notarization and stapling as the next step."
