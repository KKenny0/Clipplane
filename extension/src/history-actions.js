const BODY_REQUIRED_ACTIONS = new Set(["open-body", "copy-agent", "copy-content"]);
const UNAMBIGUOUS_INBOX_ACTIONS = new Set(["mark-processed", "delete-capture"]);

export function historyActionDisabled(action, item, options = {}) {
  return Boolean(
    options.isBusy
    || !options.hostAvailable
    || (BODY_REQUIRED_ACTIONS.has(action) && !item?.content_exists)
    || (UNAMBIGUOUS_INBOX_ACTIONS.has(action) && item?.inbox_state === "duplicate")
  );
}
