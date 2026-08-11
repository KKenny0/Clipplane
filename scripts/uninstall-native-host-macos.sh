#!/usr/bin/env sh
set -eu

browser="all"
preserve_credentials="false"
remove_payload="false"
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
    --remove-payload)
      remove_payload="true"
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

if [ -z "$host_root" ]; then
  script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
  if [ -f "$script_dir/app/native-host/credential-maintenance.mjs" ]; then
    host_root="$script_dir"
  else
    host_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
  fi
fi

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

selected="$browser"
if [ "$browser" = "all" ]; then selected="chrome edge"; fi
state_dir="$(mktemp -d "${TMPDIR:-/tmp}/clipplane-uninstall.XXXXXX")"
staged_root=""
cleanup_root=""
committed="false"
credential_user=""
credential_uid=""
credential_cleanup_failed="false"
payload_cleanup_failed="false"
receipt_cleanup_failed="false"

rollback() {
  set +e
  if [ "$committed" != "true" ]; then
    if [ -n "$staged_root" ] && [ -d "$staged_root" ] && [ ! -e "$host_root" ]; then
      mv "$staged_root" "$host_root"
    fi
    for name in $selected; do
      if [ -f "$state_dir/$name" ]; then
        target="$(manifest_file_for "$name")"
        mkdir -p "$(dirname "$target")"
        cp "$state_dir/$name" "$target"
      fi
    done
  fi
  if [ -n "$cleanup_root" ]; then rm -rf "$cleanup_root"; fi
  rm -rf "$state_dir"
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM

expected_launcher="$host_root/clipplane-host"
foreign_registration_found="false"
for name in $selected; do
  target="$(manifest_file_for "$name")"
  if [ ! -f "$target" ]; then
    echo "Clipplane Host was not registered for $name"
    continue
  fi
  registered_launcher="$(/usr/bin/plutil -extract path raw -o - "$target" 2>/dev/null || true)"
  if [ "$registered_launcher" != "$expected_launcher" ]; then
    foreign_registration_found="true"
    echo "Left a non-Clipplane or newer Host registration unchanged for $name"
    continue
  fi
  cp "$target" "$state_dir/$name"
  rm -f "$target"
  echo "Removed Clipplane Host registration for $name"
done

delete_credentials="false"
if [ "$preserve_credentials" != "true" ] && [ "$browser" = "all" ] && [ "$foreign_registration_found" = "false" ]; then
  delete_credentials="true"
fi

if [ "$remove_payload" = "true" ]; then
  if [ "$(id -u)" -ne 0 ] || [ "$host_root" != "/Library/Application Support/Clipplane Host" ]; then
    echo "Package payload removal requires root and the installed Clipplane Host path." >&2
    exit 1
  fi
  staged_root="${host_root}.uninstall-$$"
  if [ -e "$staged_root" ]; then
    echo "Refusing to overwrite an existing uninstall staging path: $staged_root" >&2
    exit 1
  fi
  if [ "$delete_credentials" = "true" ]; then
    credential_user="${SUDO_USER:-$(/usr/bin/stat -f %Su /dev/console)}"
    if [ -z "$credential_user" ] || [ "$credential_user" = "root" ] || [ "$credential_user" = "loginwindow" ]; then
      echo "Could not resolve the signed-in user for credential cleanup. Use --preserve-credentials or retry from that user's session." >&2
      exit 1
    fi
    credential_uid="$(id -u "$credential_user")"
    credential_gid="$(id -g "$credential_user")"
    cleanup_root="$(mktemp -d /tmp/clipplane-credential-cleanup.XXXXXX)"
    cp -R "$host_root/runtime" "$cleanup_root/runtime"
    cp -R "$host_root/app" "$cleanup_root/app"
    /usr/sbin/chown -R "$credential_uid:$credential_gid" "$cleanup_root"
  fi
  mv "$host_root" "$staged_root"
fi

if [ "$delete_credentials" = "true" ] && [ "$remove_payload" != "true" ]; then
  maintenance_root="$host_root"
  if [ -n "$staged_root" ]; then maintenance_root="$staged_root"; fi
  if [ -x "$maintenance_root/runtime/bin/node" ]; then
    node_path="$maintenance_root/runtime/bin/node"
    maintenance="$maintenance_root/app/native-host/credential-maintenance.mjs"
  else
    node_path="$(command -v node || true)"
    maintenance="$maintenance_root/native-host/credential-maintenance.mjs"
  fi
  if [ -z "$node_path" ] || [ ! -f "$maintenance" ]; then
    echo "Credentials could not be deleted; Host registrations and payload were restored." >&2
    exit 1
  fi
  "$node_path" "$maintenance"
elif [ "$preserve_credentials" != "true" ] && [ "$delete_credentials" != "true" ]; then
  echo "Preserved shared credentials because this was not an owned full Host uninstall."
fi

if [ -n "$staged_root" ]; then
  if rm -rf "$staged_root"; then
    staged_root=""
  else
    payload_cleanup_failed="true"
  fi
  committed="true"
fi
if [ "$remove_payload" = "true" ] && [ "$payload_cleanup_failed" != "true" ]; then
  if receipt_list="$(pkgutil --pkgs)"; then
    if printf '%s\n' "$receipt_list" | grep -Fxq com.clipplane.host && \
       ! pkgutil --forget com.clipplane.host >/dev/null; then
      receipt_cleanup_failed="true"
    fi
  else
    receipt_cleanup_failed="true"
  fi
fi
if [ "$payload_cleanup_failed" = "true" ] || [ "$receipt_cleanup_failed" = "true" ]; then
  echo "Clipplane Host uninstall is incomplete: package payload or receipt cleanup failed. Credentials were preserved." >&2
  exit 1
fi

committed="true"
if [ -n "$cleanup_root" ] && [ "$delete_credentials" = "true" ]; then
  if ! /bin/launchctl asuser "$credential_uid" /usr/bin/sudo -H -u "$credential_user" \
    "$cleanup_root/runtime/bin/node" "$cleanup_root/app/native-host/credential-maintenance.mjs"; then
    credential_cleanup_failed="true"
  fi
fi
if [ "$credential_cleanup_failed" = "true" ]; then
  echo "Clipplane Host was removed, but credentials could not be deleted for $credential_user. Local notes were preserved." >&2
  exit 1
fi
echo "Clipplane Host uninstall complete. Local notes were preserved."
