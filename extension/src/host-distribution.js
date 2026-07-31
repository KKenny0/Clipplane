const RELEASES_BASE = "https://github.com/KKenny0/Clipplane/releases/download";
const PUBLISHED_HOST_ASSETS = new Set();

export function getHostAsset(os, arch, version, options = {}) {
  const asset = hostAssetName(os, arch, version);
  const publishedAssets = options.publishedAssets || PUBLISHED_HOST_ASSETS;
  return asset && publishedAssets.has(asset) ? asset : null;
}

export function getHostDownloadUrl(os, arch, version, options = {}) {
  const asset = getHostAsset(os, arch, version, options);
  return asset ? `${RELEASES_BASE}/v${version}/${asset}` : null;
}

function hostAssetName(os, arch, version) {
  if (os === "win" && arch === "x86-64") {
    return `clipplane-host-v${version}-windows-x64.exe`;
  }
  if (os === "mac" && arch === "arm64") {
    return `clipplane-host-v${version}-macos-arm64.pkg`;
  }
  return null;
}
