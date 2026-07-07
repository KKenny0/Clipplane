import fs from "node:fs/promises";
import path from "node:path";

export async function syncLocalExport({ capture, markdown, paths }) {
  const exportDir = path.join(paths.stateDir, "sinks", "local-export");
  const exportPath = path.join(exportDir, `${capture.capture_id}.json`);

  await fs.mkdir(exportDir, { recursive: true });
  await fs.writeFile(
    exportPath,
    `${JSON.stringify({ capture, markdown }, null, 2)}\n`,
    "utf8"
  );

  return {
    status: "synced",
    external_id: capture.capture_id,
    external_url: null,
    path: exportPath
  };
}
