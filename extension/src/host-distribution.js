const RELEASES_BASE = "https://github.com/KKenny0/Clipplane/releases/download";
const PUBLISHED_HOST_RELEASES = new Set();

export function getHostAsset(os, arch, version, options = {}) {
  const publishedVersions = options.publishedVersions || PUBLISHED_HOST_RELEASES;
  if (!publishedVersions.has(String(version))) {
    return null;
  }
  if (os === "win" && ["x86-64", "arm64"].includes(arch)) {
    return `clipplane-host-v${version}-windows-${arch === "x86-64" ? "x64" : "arm64"}.exe`;
  }
  if (os === "mac" && ["x86-64", "arm64"].includes(arch)) {
    return `clipplane-host-v${version}-macos-${arch === "x86-64" ? "x64" : "arm64"}.pkg`;
  }
  return null;
}

export function getHostDownloadUrl(os, arch, version, options = {}) {
  const asset = getHostAsset(os, arch, version, options);
  return asset ? `${RELEASES_BASE}/v${version}/${asset}` : null;
}
