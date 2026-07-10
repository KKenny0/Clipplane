const RELEASES_BASE = "https://github.com/KKenny0/Clipplane/releases/download";

export function getHostAsset(os, arch, version) {
  if (!hasPublicInstaller(version)) {
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

function hasPublicInstaller(version) {
  const [major, minor] = String(version).split(".").map(Number);
  return major > 0 || (major === 0 && minor >= 6);
}

export function getHostDownloadUrl(os, arch, version) {
  const asset = getHostAsset(os, arch, version);
  return asset ? `${RELEASES_BASE}/v${version}/${asset}` : null;
}
