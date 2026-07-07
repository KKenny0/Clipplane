#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/check-native-host-macos.sh --browser chrome|edge [--extension-id <id>]
EOF
}

browser=""
extension_id=""

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

if [ -n "$extension_id" ] && ! printf '%s' "$extension_id" | grep -Eq '^[a-p]{32}$'; then
  echo "Extension ID must be a 32-character Chrome extension ID using letters a-p." >&2
  exit 2
fi

if [ "$browser" = "chrome" ]; then
  manifest_path="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.clipplane.host.json"
else
  manifest_path="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.clipplane.host.json"
fi

if [ ! -f "$manifest_path" ]; then
  echo "FAIL manifest missing: $manifest_path" >&2
  exit 1
fi

node_path="$(command -v node || true)"
if [ -z "$node_path" ]; then
  echo "FAIL node missing from PATH" >&2
  exit 1
fi

manifest_name="$(node -e "const fs=require('node:fs'); const m=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(m.name || '')" "$manifest_path")"
if [ "$manifest_name" != "com.clipplane.host" ]; then
  echo "FAIL unexpected native host name: $manifest_name" >&2
  exit 1
fi

launcher_path="$(node -e "const fs=require('node:fs'); const m=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(m.path || '')" "$manifest_path")"
if [ ! -f "$launcher_path" ]; then
  echo "FAIL launcher missing: $launcher_path" >&2
  exit 1
fi

if [ ! -x "$launcher_path" ]; then
  echo "FAIL launcher is not executable: $launcher_path" >&2
  exit 1
fi

if [ -n "$extension_id" ]; then
  origin="chrome-extension://$extension_id/"
  node - "$manifest_path" "$origin" <<'NODE'
const fs = require("node:fs");
const [manifestPath, origin] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.allowed_origins) || !manifest.allowed_origins.includes(origin)) {
  console.error(`FAIL manifest does not allow extension origin: ${origin}`);
  process.exit(1);
}
NODE
fi

echo "PASS manifest: $manifest_path"
echo "PASS launcher: $launcher_path"
echo "PASS node: $node_path"
if [ -n "$extension_id" ]; then
  echo "PASS allowed origin: chrome-extension://$extension_id/"
fi
