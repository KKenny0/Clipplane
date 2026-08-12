export const MIN_HOST_PROTOCOL = 3;
const PROTOCOL_GATED_MESSAGES = new Set(["clip", "sync", "process_capture", "delete_capture"]);

export function supportsHostProtocol(value) {
  return Number.isInteger(value) && value >= MIN_HOST_PROTOCOL;
}

export function requiresCurrentHostProtocol(messageType) {
  return PROTOCOL_GATED_MESSAGES.has(messageType);
}
