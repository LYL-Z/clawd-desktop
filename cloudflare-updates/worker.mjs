const REPOSITORY = "LYL-Z/clawd-desktop";
const GITHUB_BASE = `https://github.com/${REPOSITORY}`;
const PUBLIC_BASE = "https://clawd-updates.chronokalamos.com/v1";
const MAX_RELEASE_BYTES = 250 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_CHECKSUM_BYTES = 64 * 1024;
const MAX_NOTES_BYTES = 64 * 1024;
const MAX_NOTES_CHARS = 12_000;
const RELEASE_TAG = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const EXECUTABLE_NAME = /^Clawd-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-windows-x64\.exe$/;
const SAFE_ERROR_CODES = new Set([
  "invalid_release",
  "release_not_found",
  "release_unavailable",
  "release_redirect_rejected",
  "manifest_unavailable",
  "manifest_invalid",
  "upstream_redirect_rejected",
  "windows_asset_missing",
  "checksum_unavailable",
  "checksum_invalid",
  "checksum_mismatch",
]);

function metadataErrorCode(error) {
  const code = error instanceof Error ? error.message : "";
  return SAFE_ERROR_CODES.has(code) ? code : "upstream_error";
}

function metadataErrorDetails(error) {
  const allowedNames = new Set(["TypeError", "Error", "RangeError", "SyntaxError", "URIError"]);
  const name = error instanceof Error && allowedNames.has(error.name) ? error.name : "OtherError";
  const causeCode = error && typeof error.cause?.code === "string" && /^[A-Z0-9_-]{1,32}$/.test(error.cause.code)
    ? error.cause.code
    : null;
  const upstreamStatus = Number.isSafeInteger(error?.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599
    ? error.upstreamStatus
    : null;
  // Exception messages may contain request headers or credentials. Never put them in Worker logs.
  return { errorName: name, ...(causeCode ? { causeCode } : {}), ...(upstreamStatus ? { upstreamStatus } : {}) };
}

function json(data, status = 200, extra = {}) {
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "Range, If-Range",
    "cache-control": status === 200 ? "public, max-age=120" : "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extra,
  });
  return new Response(JSON.stringify(data), { status, headers });
}

function canonicalTag(value) {
  if (typeof value !== "string" || !RELEASE_TAG.test(value)) throw new Error("invalid_release");
  const version = value.replace(/^v/, "");
  return `v${version}`;
}

function versionOf(tag) {
  return tag.replace(/^v/, "");
}

function expectedExecutable(tag) {
  const version = versionOf(tag);
  return `Clawd-${version}-windows-x64.exe`;
}

function releaseAssetUrl(tag, name) {
  return `${GITHUB_BASE}/releases/download/${tag}/${encodeURIComponent(name)}`;
}

async function readBounded(response, maximumBytes, code) {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error(code);
    return bytes;
  }

  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new Error(code);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function trustedUpstreamUrl(value) {
  let url;
  try { url = value instanceof URL ? new URL(value.href) : new URL(value); }
  catch { throw new Error("upstream_redirect_rejected"); }
  const trustedHost = url.hostname === "github.com" || url.hostname.endsWith(".githubusercontent.com");
  if (url.protocol !== "https:" || !trustedHost || url.username || url.password || url.port) throw new Error("upstream_redirect_rejected");
  return url;
}

async function fetchTrustedUpstream(value, init, request) {
  let url = trustedUpstreamUrl(value);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await request(url, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 5) throw new Error("upstream_redirect_rejected");
    url = trustedUpstreamUrl(new URL(location, url));
  }
  throw new Error("upstream_redirect_rejected");
}

function parseSha256Manifest(text, assetName) {
  const matches = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match?.[2] === assetName) matches.push(match[1].toLowerCase());
  }
  return matches.length === 1 ? matches[0] : null;
}

async function resolveLatestTag(request = fetch) {
  let response;
  try {
    response = await request(`${GITHUB_BASE}/releases/latest`, {
      redirect: "manual",
      headers: { "user-agent": "ClawdDesktop-UpdateDelivery", accept: "text/html" },
      cf: { cacheEverything: true, cacheTtl: 120 },
    });
  } catch {
    throw new Error("release_unavailable");
  }

  let target;
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw new Error("release_redirect_rejected");
    try {
      target = new URL(location, `${GITHUB_BASE}/releases/latest`);
    } catch {
      throw new Error("release_redirect_rejected");
    }
  } else if (response.status === 200 && typeof response.url === "string") {
    // Some fetch runtimes expose the final URL even when a redirect was followed.
    try { target = new URL(response.url); }
    catch { target = null; }
  } else {
    const error = new Error(response.status === 404 ? "release_not_found" : "release_unavailable");
    error.upstreamStatus = response.status;
    throw error;
  }

  if (!target || target.protocol !== "https:" || target.hostname !== "github.com" || target.username || target.password || target.port || target.search || target.hash) {
    throw new Error("release_redirect_rejected");
  }
  const match = /^\/LYL-Z\/clawd-desktop\/releases\/tag\/(v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(target.pathname);
  if (!match) throw new Error("release_redirect_rejected");
  return canonicalTag(match[1]);
}

async function fetchReleaseText(url, request, maximumBytes, errorCode, cacheTtl) {
  let response;
  try {
    response = await fetchTrustedUpstream(url, {
      headers: { "user-agent": "ClawdDesktop-UpdateDelivery", accept: "application/octet-stream" },
      cf: { cacheEverything: true, cacheTtl },
    }, request);
  } catch {
    throw new Error(errorCode);
  }
  if (!response.ok) throw new Error(response.status === 404 ? "release_not_found" : errorCode);
  const bytes = await readBounded(response, maximumBytes, errorCode);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function readRelease(tagValue, request = fetch) {
  const tag = canonicalTag(tagValue);
  const version = versionOf(tag);
  const expectedName = expectedExecutable(tag);
  const manifestUrl = releaseAssetUrl(tag, `release-manifest-${tag}.json`);
  const manifestText = await fetchReleaseText(manifestUrl, request, MAX_MANIFEST_BYTES, "manifest_unavailable", 3600);

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error("manifest_invalid");
  }
  if (
    !manifest || manifest.schemaVersion !== 1 || manifest.product !== "Clawd Desktop" ||
    manifest.version !== version || manifest.platform !== "Windows x64" ||
    typeof manifest.sourceCommit !== "string" || !/^[a-f0-9]{40}$/i.test(manifest.sourceCommit) ||
    typeof manifest.generatedAt !== "string" || !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    !Array.isArray(manifest.artifacts)
  ) throw new Error("manifest_invalid");

  const artifacts = manifest.artifacts.filter((item) => item?.file === expectedName);
  if (artifacts.length !== 1) throw new Error("windows_asset_missing");
  const artifact = artifacts[0];
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > MAX_RELEASE_BYTES || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    throw new Error("manifest_invalid");
  }

  const sumsUrl = releaseAssetUrl(tag, "SHA256SUMS.txt");
  let sums;
  try {
    sums = await fetchReleaseText(sumsUrl, request, MAX_CHECKSUM_BYTES, "checksum_unavailable", 3600);
  } catch (error) {
    if (error instanceof Error && error.message === "release_not_found") throw new Error("checksum_unavailable");
    throw error;
  }
  const checksum = parseSha256Manifest(sums, expectedName);
  if (!checksum) throw new Error("checksum_invalid");
  if (checksum !== artifact.sha256.toLowerCase()) throw new Error("checksum_mismatch");

  return {
    tag,
    manifest,
    artifact: { name: expectedName, size: artifact.bytes, sha256: checksum },
  };
}

async function readReleaseNotes(tag, request = fetch) {
  const version = versionOf(tag);
  const notesUrl = `https://raw.githubusercontent.com/${REPOSITORY}/${tag}/docs/RELEASE-NOTES-v${version}.md`;
  try {
    const response = await fetchTrustedUpstream(notesUrl, {
      headers: { "user-agent": "ClawdDesktop-UpdateDelivery", accept: "text/plain" },
      cf: { cacheEverything: true, cacheTtl: 3600 },
    }, request);
    if (!response.ok) return "";
    const bytes = await readBounded(response, MAX_NOTES_BYTES, "release_unavailable");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, MAX_NOTES_CHARS);
  } catch {
    return "";
  }
}

function metadataFor(release, notes = "") {
  const { tag, manifest, artifact } = release;
  const fallbackUrl = releaseAssetUrl(tag, artifact.name);
  return {
    tag_name: tag,
    name: `Clawd Desktop ${versionOf(tag)}`,
    body: notes,
    published_at: "",
    draft: false,
    prerelease: false,
    artifact: {
      name: artifact.name,
      size: artifact.size,
      sha256: artifact.sha256,
      download_url: `${PUBLIC_BASE}/download/${tag}/${encodeURIComponent(artifact.name)}`,
      fallback_url: fallbackUrl,
    },
    source_commit: manifest.sourceCommit,
    generated_at: manifest.generatedAt,
  };
}

export async function releaseMetadata(tag, request = fetch) {
  const release = await readRelease(tag, request);
  const notes = await readReleaseNotes(release.tag, request);
  return metadataFor(release, notes);
}

function safeDownloadRequest(request) {
  const url = new URL(request.url);
  const match = /^\/v1\/download\/(v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  let name;
  try { name = decodeURIComponent(match[2]); } catch { return null; }
  if (!EXECUTABLE_NAME.test(name) || name.includes("/") || name.includes("\\")) return null;
  return { tag: match[1], name };
}

function downloadHeaders(source, name) {
  const headers = new Headers(source.headers);
  for (const key of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "set-cookie"]) headers.delete(key);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=3600, s-maxage=86400, immutable");
  headers.set("content-disposition", `attachment; filename="${name}"`);
  headers.set("content-type", "application/octet-stream");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-clawd-update-edge", "1");
  return headers;
}

export async function handleUpdateRequest(request, fetcher = fetch) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "Range, If-Range" } });
  if (request.method !== "GET" && request.method !== "HEAD") return json({ code: "method_not_allowed" }, 405, { allow: "GET, HEAD, OPTIONS" });
  if (url.pathname === "/v1/healthz") return json({ service: "clawd-updates", status: "ok" }, 200, { "cache-control": "no-store" });

  if (url.pathname === "/v1/latest.json") {
    let stage = "release_lookup";
    try {
      const tag = await resolveLatestTag(fetcher);
      stage = "release_validation";
      const release = await readRelease(tag, fetcher);
      stage = "release_notes";
      const notes = await readReleaseNotes(release.tag, fetcher);
      const response = json(metadataFor(release, notes));
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    } catch (error) {
      console.error("clawd_update_metadata_failed", { stage, code: metadataErrorCode(error), ...metadataErrorDetails(error) });
      return json({ code: "release_metadata_unavailable" }, 503, { "retry-after": "60" });
    }
  }

  if (url.pathname.startsWith("/v1/download/")) {
    const requested = safeDownloadRequest(request);
    if (!requested) return json({ code: "invalid_download_path" }, 404);
    try {
      const release = await readRelease(requested.tag, fetcher);
      if (release.artifact.name !== requested.name) return json({ code: "release_asset_not_found" }, 404);
      const headers = new Headers({ "accept-encoding": "identity", "user-agent": "ClawdDesktop-UpdateDelivery" });
      for (const key of ["range", "if-range", "if-none-match", "if-modified-since"]) {
        const value = request.headers.get(key);
        if (value) headers.set(key, value);
      }
      const upstream = await fetchTrustedUpstream(releaseAssetUrl(release.tag, release.artifact.name), {
        method: request.method,
        headers,
        cf: request.headers.has("range") ? undefined : { cacheEverything: true, cacheTtl: 3600 },
      }, fetcher);
      if (upstream.status < 200 || upstream.status > 299) return json({ code: "release_asset_unavailable" }, upstream.status === 404 ? 404 : 502, { "retry-after": "60" });
      return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: downloadHeaders(upstream, release.artifact.name) });
    } catch {
      return json({ code: "release_asset_unavailable" }, 502, { "retry-after": "60" });
    }
  }

  return json({ code: "not_found" }, 404);
}

function platformFetch(input, init) {
  return globalThis.fetch(input, init);
}

export default {
  fetch(request) {
    return handleUpdateRequest(request, platformFetch);
  },
};
