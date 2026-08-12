import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const HOST_VERSION = packageJson.version;
export const PROTOCOL_VERSION = 3;
