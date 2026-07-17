#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/setup-macos.sh --browser chrome|edge [--extension-id <id>] [--notes-dir <path>]
EOF
}

browser=""
extension_id=""
notes_dir=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --browser)
      browser="${2:-}"
      shift 2
      ;;
    --extension-id)
      extension_id="${2:-}"
      shift 2
      ;;
    --notes-dir)
      notes_dir="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$browser" in
  chrome|edge) ;;
  *)
    echo "Browser must be chrome or edge." >&2
    usage >&2
    exit 2
    ;;
esac

node_path="$(command -v node || true)"
if [ -z "$node_path" ]; then
  echo "Node.js is required but was not found on PATH." >&2
  exit 1
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"

custom_extension_id="$extension_id"
if [ -z "$extension_id" ]; then
  extension_id="$("$node_path" "$script_dir/extension-identity.mjs" id)"
  allowed_origins_json="$("$node_path" "$script_dir/native-host-origins.mjs" json)"
else
  allowed_origins_json="$("$node_path" -e 'process.stdout.write(JSON.stringify([`chrome-extension://${process.argv[1]}/`]))' "$extension_id")"
fi

if ! printf '%s' "$extension_id" | grep -Eq '^[a-p]{32}$'; then
  echo "Extension ID must be a 32-character Chrome extension ID using letters a-p." >&2
  exit 2
fi

install_parent="$HOME/Library/Application Support"
install_root="$install_parent/Clipplane Host"
stage_root="$(mktemp -d "$install_parent/.clipplane-host.XXXXXX")"
trap 'rm -rf "$stage_root"' EXIT

mkdir -p "$stage_root/app/native-host" "$stage_root/app/node_modules"
find "$project_root/native-host" -type f -name '*.mjs' | while IFS= read -r source_path; do
  relative_path="${source_path#"$project_root/native-host"/}"
  destination="$stage_root/app/native-host/$relative_path"
  mkdir -p "$(dirname -- "$destination")"
  cp "$source_path" "$destination"
done
cp "$project_root/package.json" "$stage_root/app/package.json"

npm ls --prefix "$project_root" --omit=dev --all --parseable | while IFS= read -r dependency_path; do
  if [ -z "$dependency_path" ] || [ "$dependency_path" = "$project_root" ]; then
    continue
  fi
  relative_path="${dependency_path#"$project_root"/}"
  destination="$stage_root/app/$relative_path"
  mkdir -p "$(dirname -- "$destination")"
  cp -R "$dependency_path" "$destination"
done

launcher_path="$stage_root/clipplane-host"
manifest_path="$stage_root/com.clipplane.host.json"

if [ "$browser" = "chrome" ]; then
  manifest_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
else
  manifest_dir="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
fi

mkdir -p "$manifest_dir"

shell_quote() {
  printf "'"
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

{
  printf '#!/usr/bin/env sh\n'
  printf 'set -eu\n'
  if [ -n "$notes_dir" ]; then
    printf 'export CLIPPLANE_NOTES_DIR=%s\n' "$(shell_quote "$notes_dir")"
  fi
  printf 'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\n'
  printf 'exec %s "$SCRIPT_DIR/app/native-host/host.mjs"\n' "$(shell_quote "$node_path")"
} > "$launcher_path"

chmod +x "$launcher_path"

rm -rf "$install_root"
mv "$stage_root" "$install_root"
trap - EXIT

launcher_path="$install_root/clipplane-host"
manifest_path="$install_root/com.clipplane.host.json"

node - "$manifest_path" "$launcher_path" "$allowed_origins_json" <<'NODE'
const fs = require("node:fs");
const [manifestPath, launcherPath, allowedOriginsJson] = process.argv.slice(2);
const manifest = {
  name: "com.clipplane.host",
  description: "Clipplane Native Messaging Host",
  path: launcherPath,
  type: "stdio",
  allowed_origins: JSON.parse(allowedOriginsJson)
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cp "$manifest_path" "$manifest_dir/com.clipplane.host.json"

if [ -n "$custom_extension_id" ]; then
  sh "$script_dir/check-native-host-macos.sh" --browser "$browser" --extension-id "$custom_extension_id"
else
  sh "$script_dir/check-native-host-macos.sh" --browser "$browser"
fi

echo ""
echo "NEXT open your browser extension popup and make a first Save local clip."
echo "NEXT open Settings to confirm the notes folder and optional sync targets."
echo "NEXT run: npm run doctor"
