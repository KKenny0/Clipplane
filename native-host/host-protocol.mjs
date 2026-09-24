// The single definition of every message type that crosses the
// extension <-> host seam. Canonical copy lives here; the extension
// loads the vendored twin at extension/src/host-protocol.js (synced by
// scripts/prepare-extension-vendor.mjs, asserted equal by tests).
//
// `forwarded`: background.js passes the message straight to the host.
// `gated`: the message may only be sent after the host confirms the
// current protocol version. A type can be both.

export const MIN_HOST_PROTOCOL = 3;

export const HOST_MESSAGE_TYPES = Object.freeze({
  status: { forwarded: false, gated: false },
  get_config: { forwarded: true, gated: false },
  set_config: { forwarded: true, gated: false },
  open_notes_dir: { forwarded: true, gated: false },
  history: { forwarded: true, gated: false },
  open_capture_body: { forwarded: true, gated: false },
  copy_capture: { forwarded: true, gated: false },
  process_capture: { forwarded: true, gated: true },
  delete_capture: { forwarded: true, gated: true },
  sync: { forwarded: false, gated: true },
  clip: { forwarded: false, gated: true }
});

export const FORWARDED_MESSAGE_TYPES = Object.freeze(
  Object.entries(HOST_MESSAGE_TYPES)
    .filter(([, meta]) => meta.forwarded)
    .map(([type]) => type)
);

const PROTOCOL_GATED_MESSAGES = new Set(
  Object.entries(HOST_MESSAGE_TYPES)
    .filter(([, meta]) => meta.gated)
    .map(([type]) => type)
);

export function supportsHostProtocol(value) {
  return Number.isInteger(value) && value >= MIN_HOST_PROTOCOL;
}

export function requiresCurrentHostProtocol(messageType) {
  return PROTOCOL_GATED_MESSAGES.has(messageType);
}
