import { normalizeCaptureRecord, writeLocalExport } from "../capture-record.mjs";

export async function syncLocalExport({ capture, markdown, paths }) {
  const exportPath = await writeLocalExport(
    paths,
    capture.capture_id,
    `${JSON.stringify({ capture: normalizeCaptureRecord(capture), markdown }, null, 2)}\n`
  );

  return {
    status: "synced",
    external_id: capture.capture_id,
    external_url: null,
    path: exportPath
  };
}
