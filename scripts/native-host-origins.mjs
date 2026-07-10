import { getDefaultExtensionId } from "./extension-identity.mjs";

export async function getNativeHostExtensionIds(rootDir) {
  return [await getDefaultExtensionId(rootDir)];
}

export async function getNativeHostOrigins(rootDir) {
  return (await getNativeHostExtensionIds(rootDir)).map((id) => `chrome-extension://${id}/`);
}
