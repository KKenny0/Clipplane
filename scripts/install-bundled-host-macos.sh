#!/usr/bin/env sh
set -eu

browser="all"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --browser) browser="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$browser" in chrome|edge|all) ;; *) echo "Browser must be chrome, edge, or all." >&2; exit 2 ;; esac

host_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
launcher="$host_root/clipplane-host"
node_path="$host_root/runtime/bin/node"
origins_path="$host_root/allowed-origins.json"
manifest_path="$host_root/com.clipplane.host.json"

if [ ! -x "$launcher" ] || [ ! -x "$node_path" ] || [ ! -f "$origins_path" ]; then
  echo "Clipplane Host bundle is incomplete. Reinstall the signed package." >&2
  exit 1
fi

"$node_path" - "$manifest_path" "$launcher" "$origins_path" <<'NODE'
const fs = require("node:fs");
const [manifestPath, launcher, originsPath] = process.argv.slice(2);
const { allowed_origins } = JSON.parse(fs.readFileSync(originsPath, "utf8"));
fs.writeFileSync(manifestPath, `${JSON.stringify({
  name: "com.clipplane.host",
  description: "Clipplane Native Messaging Host",
  path: launcher,
  type: "stdio",
  allowed_origins
}, null, 2)}\n`);
NODE

manifest_file_for() {
  name="$1"
  if [ "$(id -u)" -eq 0 ]; then
    if [ "$name" = "chrome" ]; then
      manifest_dir="/Library/Google/Chrome/NativeMessagingHosts"
    else
      manifest_dir="/Library/Microsoft Edge/NativeMessagingHosts"
    fi
  else
    if [ "$name" = "chrome" ]; then
      manifest_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    else
      manifest_dir="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    fi
  fi
  printf '%s\n' "$manifest_dir/com.clipplane.host.json"
}

state_dir="$(mktemp -d "${TMPDIR:-/tmp}/clipplane-install.XXXXXX")"
committed="false"
selected="$browser"
if [ "$browser" = "all" ]; then selected="chrome edge"; fi

for name in $selected; do
  target="$(manifest_file_for "$name")"
  if [ -f "$target" ]; then
    cp "$target" "$state_dir/$name"
  else
    : > "$state_dir/$name.missing"
  fi
done

rollback() {
  set +e
  if [ "$committed" != "true" ]; then
    for name in $selected; do
      target="$(manifest_file_for "$name")"
      if [ -f "$state_dir/$name" ]; then
        mkdir -p "$(dirname "$target")"
        cp "$state_dir/$name" "$target"
      else
        rm -f "$target"
      fi
    done
  fi
  rm -rf "$state_dir"
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM

install_for() {
  name="$1"
  target="$(manifest_file_for "$name")"
  mkdir -p "$(dirname "$target")"
  cp "$manifest_path" "$target"
  echo "Registered Clipplane Host for $name"
}

for name in $selected; do install_for "$name"; done
committed="true"
echo "Restart every browser window, then use Check again in Clipplane."
