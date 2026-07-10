export const SYNC_CONSENT_VERSION = "2026-07-10.v1";

export function hasSyncConsent(record, sink) {
  return record?.version === SYNC_CONSENT_VERSION
    && typeof record.sinks?.[sink]?.acceptedAt === "string";
}

export function buildSyncConsent(record, selections, now = new Date()) {
  const next = record?.version === SYNC_CONSENT_VERSION
    ? structuredClone(record)
    : { version: SYNC_CONSENT_VERSION, sinks: {} };

  for (const selection of selections) {
    if (!selection.enabled) {
      continue;
    }
    if (!selection.confirmed && !hasSyncConsent(record, selection.sink)) {
      throw new Error(`Confirm what ${selection.label} receives before enabling sync.`);
    }
    if (!hasSyncConsent(next, selection.sink)) {
      next.sinks[selection.sink] = { acceptedAt: now.toISOString() };
    }
  }

  return next;
}

export function canSyncStatus(status, requestedSinks) {
  if (!status?.ok || !status.sinks) {
    return false;
  }

  const sinkNames = Array.isArray(requestedSinks) && requestedSinks.length
    ? requestedSinks
    : Array.isArray(status.default_sinks) && status.default_sinks.length
      ? status.default_sinks
      : Object.entries(status.sinks)
        .filter(([, sink]) => sink.enabled)
        .map(([name]) => name);

  return sinkNames.length > 0 && sinkNames.every((name) => {
    if (name === "local-export") {
      return true;
    }
    const sink = status.sinks[name];
    return Boolean(sink?.enabled && sink.configured && sink.consent);
  });
}
