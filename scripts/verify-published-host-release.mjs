import { X509Certificate, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { getHostRelease } from "../extension/src/host-distribution.js";

const REPOSITORY = "KKenny0/Clipplane";
const version = readArgument("--version");
const localAsset = readArgument("--asset", false);
const release = getHostRelease("mac", "arm64", version);

if (!release) {
  throw new Error(`No published macOS arm64 Host release is registered for Clipplane ${version}.`);
}

const packageBytes = localAsset
  ? await readFile(localAsset)
  : await downloadImmutableReleaseAsset(release);

verifyPackage(packageBytes, release);
console.log(
  `Verified ${release.asset}: SHA-256 ${release.sha256}, Apple Team ID ${release.appleTeamId}.`,
);

async function downloadImmutableReleaseAsset(expected) {
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases/tags/${expected.releaseTag}`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "clipplane-release-verifier" } },
  );
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed (${response.status}).`);
  }

  const published = await response.json();
  if (published.draft || published.immutable !== true) {
    throw new Error(`${expected.releaseTag} is not a published immutable GitHub release.`);
  }

  const asset = published.assets?.find((candidate) => candidate.name === expected.asset);
  if (!asset) {
    throw new Error(`${expected.asset} is missing from ${expected.releaseTag}.`);
  }
  if (asset.digest !== `sha256:${expected.sha256}`) {
    throw new Error(`GitHub asset digest mismatch: ${asset.digest || "missing digest"}.`);
  }

  const download = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "clipplane-release-verifier" },
  });
  if (!download.ok) {
    throw new Error(`Host package download failed (${download.status}).`);
  }
  return Buffer.from(await download.arrayBuffer());
}

function verifyPackage(bytes, expected) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expected.sha256) {
    throw new Error(`Host package SHA-256 mismatch: ${digest}.`);
  }

  const certificates = readXarCertificates(bytes);
  const installer = certificates.find((certificate) =>
    certificate.subject.includes("CN=Developer ID Installer:") &&
    certificate.subject.includes(`OU=${expected.appleTeamId}`)
  );
  if (!installer) {
    throw new Error(`Expected Apple Developer ID Installer Team ID ${expected.appleTeamId} was not found.`);
  }
}

function readXarCertificates(bytes) {
  if (bytes.subarray(0, 4).toString("ascii") !== "xar!") {
    throw new Error("Host package is not an XAR archive.");
  }
  const headerSize = bytes.readUInt16BE(4);
  const compressedTocLength = Number(bytes.readBigUInt64BE(8));
  const toc = inflateSync(
    bytes.subarray(headerSize, headerSize + compressedTocLength),
  ).toString("utf8");
  const encoded = [...toc.matchAll(/<X509Certificate>([\s\S]*?)<\/X509Certificate>/g)]
    .map((match) => match[1].replaceAll(/\s/g, ""));
  if (!encoded.length) {
    throw new Error("Host package does not contain an X.509 signing chain.");
  }
  return encoded.map((certificate) => new X509Certificate(Buffer.from(certificate, "base64")));
}

function readArgument(name, required = true) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (required && !value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}
