#!/usr/bin/env sh
set -eu

browser="all"
preserve_credentials="false"
host_root=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --browser)
      browser="${2:-}"
      shift 2
      ;;
    --preserve-credentials)
      preserve_credentials="true"
      shift
      ;;
    --host-root)
      host_root="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$browser" in
  chrome|edge|all) ;;
  *) echo "Browser must be chrome, edge, or all." >&2; exit 2 ;;
esac

remove_manifest() {
  name="$1"
  if [ "$name" = "chrome" ]; then
    user_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    system_dir="/Library/Google/Chrome/NativeMessagingHosts"
  else
    user_dir="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    system_dir="/Library/Microsoft Edge/NativeMessagingHosts"
  fi
  rm -f "$user_dir/com.clipplane.host.json"
  if [ "$(id -u)" -eq 0 ]; then
    rm -f "$system_dir/com.clipplane.host.json"
  fi
  echo "Removed Clipplane Host registration for $name"
}

if [ "$browser" = "all" ]; then
  remove_manifest chrome
  remove_manifest edge
else
  remove_manifest "$browser"
fi

if [ "$preserve_credentials" != "true" ]; then
  if [ -z "$host_root" ]; then
    script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
    if [ -f "$script_dir/app/native-host/credential-maintenance.mjs" ]; then
      host_root="$script_dir"
    else
      host_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
    fi
  fi
  if [ -x "$host_root/runtime/bin/node" ]; then
    node_path="$host_root/runtime/bin/node"
    maintenance="$host_root/app/native-host/credential-maintenance.mjs"
  else
    node_path="$(command -v node || true)"
    maintenance="$host_root/native-host/credential-maintenance.mjs"
  fi
  if [ -z "$node_path" ] || [ ! -f "$maintenance" ]; then
    echo "Host registrations were removed, but credentials could not be deleted. Local notes were not changed." >&2
    exit 1
  fi
  "$node_path" "$maintenance"
fi

echo "Clipplane Host uninstall complete. Local notes were preserved."
