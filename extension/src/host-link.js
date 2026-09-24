import { isHostUnavailable, isHostOutdated } from "../setup-guide.js";

// The Host link module: one place that knows how a failing host response
// classifies. Pages branch on `problem` once instead of re-deriving the
// isHostUnavailable/isHostOutdated/unknown-message ladder at each call site.

export function isUnsupportedMessage(response) {
  return response?.error?.code === "unknown_message"
    || /Unsupported native host message/i.test(response?.error?.message || "");
}

export function hostProblem(response) {
  if (response?.ok) {
    return null;
  }
  if (isHostOutdated(response)) {
    return "host-outdated";
  }
  if (isHostUnavailable(response)) {
    return "host-unavailable";
  }
  if (isUnsupportedMessage(response)) {
    return "unsupported";
  }
  return "failed";
}

export function createHostLink({ sendMessage = (message) => chrome.runtime.sendMessage(message) } = {}) {
  return {
    async send(message) {
      const response = await sendMessage(message);
      return { response, problem: hostProblem(response) };
    }
  };
}
