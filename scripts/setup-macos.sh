#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/setup-macos.sh --browser chrome|edge --extension-id <id> [--notes-dir <path>]
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

if ! printf '%s' "$extension_id" | grep -Eq '^[a-p]{32}$'; then
  echo "Extension ID must be a 32-character Chrome extension ID using letters a-p." >&2
  exit 2
fi

node_path="$(command -v node || true)"
if [ -z "$node_path" ]; then
  echo "Node.js is required but was not found on PATH." >&2
  exit 1
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
host_dir="$project_root/native-host"
launcher_path="$host_dir/clipplane-host"
manifest_path="$host_dir/com.clipplane.host.json"

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
  printf 'exec %s "$SCRIPT_DIR/host.mjs"\n' "$(shell_quote "$node_path")"
} > "$launcher_path"

chmod +x "$launcher_path"

node - "$manifest_path" "$launcher_path" "$extension_id" <<'NODE'
const fs = require("node:fs");
const [manifestPath, launcherPath, extensionId] = process.argv.slice(2);
const manifest = {
  name: "com.clipplane.host",
  description: "Clipplane Native Messaging Host",
  path: launcherPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`]
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cp "$manifest_path" "$manifest_dir/com.clipplane.host.json"

sh "$script_dir/check-native-host-macos.sh" --browser "$browser" --extension-id "$extension_id"

echo ""
echo "NEXT open your browser extension popup and make a first Save local clip."
echo "NEXT open Settings to confirm the notes folder and optional sync targets."
echo "NEXT run: npm run doctor"
