const RELEASES_BASE = "https://github.com/KKenny0/Clipplane/releases/download";
// Exported for the cross-field consistency test: every future entry
// must keep asset version === hostVersion and stay newest-first.
export const PUBLISHED_HOST_RELEASES = new Map([
  ["mac:arm64:0.9.0", Object.freeze({
    // Extension 0.9.0 deliberately reuses the signed and notarized 0.8.0
    // Host package: protocol 3 is unchanged and this release ships no new
    // macOS Host build. Same reuse pattern as the 0.7.7 entry below —
    // asset version must equal hostVersion; the key moves independently.
    releaseTag: "v0.8.0",
    asset: "clipplane-host-v0.8.0-macos-arm64.pkg",
    hostVersion: "0.8.0",
    sha256: "1f714ca3a455458f3669e60cec02b1038be105270f4add05083637338479521c",
    appleTeamId: "S7V7CK2G9T"
  })],
  ["mac:arm64:0.8.0", Object.freeze({
    releaseTag: "v0.8.0",
    asset: "clipplane-host-v0.8.0-macos-arm64.pkg",
    hostVersion: "0.8.0",
    sha256: "1f714ca3a455458f3669e60cec02b1038be105270f4add05083637338479521c",
    appleTeamId: "S7V7CK2G9T"
  })],
  ["mac:arm64:0.7.7", Object.freeze({
    // Extension 0.7.7 deliberately reused the 0.7.6 Host package: the
    // immutable v0.7.7 release republished that asset. The asset version
    // still equals hostVersion, which is the invariant the consistency
    // test enforces; the key may differ when the extension and Host
    // versions move independently.
    releaseTag: "v0.7.7",
    asset: "clipplane-host-v0.7.6-macos-arm64.pkg",
    hostVersion: "0.7.6",
    sha256: "2d2c2c6fe89bbe1f67e37388b2c8b1905a9092a14c2a230954097f19bf9fa4d6",
    appleTeamId: "S7V7CK2G9T"
  })]
]);

export function getHostRelease(os, arch, version, options = {}) {
  const publishedReleases = options.publishedReleases || PUBLISHED_HOST_RELEASES;
  const release = publishedReleases.get(`${os}:${arch}:${version}`) || null;
  return hasPinnedIdentity(release) ? release : null;
}

export function getHostAsset(os, arch, version, options = {}) {
  return getHostRelease(os, arch, version, options)?.asset || null;
}

export function getHostDownloadUrl(os, arch, version, options = {}) {
  const release = getHostRelease(os, arch, version, options);
  return release ? `${RELEASES_BASE}/${release.releaseTag}/${release.asset}` : null;
}

function hasPinnedIdentity(release) {
  return Boolean(
    release
    && /^v\d+\.\d+\.\d+$/.test(release.releaseTag)
    && /^clipplane-host-v\d+\.\d+\.\d+-macos-arm64\.pkg$/.test(release.asset)
    && /^\d+\.\d+\.\d+$/.test(release.hostVersion)
    && /^[a-f0-9]{64}$/.test(release.sha256)
    && /^[A-Z0-9]{10}$/.test(release.appleTeamId)
  );
}
