export const MIN_HOST_PROTOCOL = 2;

export function supportsHostProtocol(value) {
  return Number.isInteger(value) && value >= MIN_HOST_PROTOCOL;
}
