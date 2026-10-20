const REPOSITORY = "LYL-Z/clawd-desktop";
const API_BASE = `https://api.github.com/repos/${REPOSITORY}`;
const PUBLIC_BASE = "https://clawd-updates.chronokalamos.com/v1";
const MAX_RELEASE_BYTES = 250 * 1024 * 1024;
const MAX_NOTES_CHARS = 12_000;
const RELEASE_TAG = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const EXECUTABLE_NAME = /^Clawd-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-windows-x64\.exe$/;

const METADATA_ERROR_CODES = new Set([
  "invalid_release",
  "windows_asset_missing",
  "checksum_asset_missing",
  "checksum_asset_size_invalid",
  "checksum_url_rejected",
  "checksum_unavailable",
  "checksum_missing",
  "checksum_mismatch",
  "release_not_found",
  "release_unavailable",
]);

function metadataErrorCode(error) {
  const code = error instanceof Error ? error.message : "";
  return METADATA_ERROR_CODES.has(code) ? code : "upstream_error";
}

function metadataErrorDetails(error) {
  const allowedNames = new Set(["TypeError", "Error", "RangeError", "SyntaxError", "URIError"]);
  const name = error instanceof Error && allowedNames.has(error.name) ? error.name : "OtherError";
  const causeCode = error && typeof error.cause?.code === "string" && /^[A-Z0-9_-]{1,32}$/.test(error.cause.code)
    ? error.cause.code
    : null;
  const rawMessage = error instanceof Error ? error.message : "";
  const message = rawMessage
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/["']?[\w.-]*(?:proxy[_-]?authorization|authorization|token|secret|password|passwd|api[_-]?key|access[_-]?key|key)["']?\s*(?::|=|\s)\s*(?:(?:bearer|basic)\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"',;}]+)/gi, "[redacted]")
    .replace(/\b(?:bearer|basic)\s+\S+/gi, "[redacted]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 160);
  return {
    errorName: name,
    ...(causeCode ? { causeCode } : {}),
    errorMessage: message || "unknown",
  };
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

function parseSha256Manifest(text, assetName) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match?.[2] === assetName) return match[1];
  }
  return null;
}

function validRelease(release) {
  if (!release || release.draft === true || release.prerelease === true) return false;
  if (typeof release.tag_name !== "string" || !RELEASE_TAG.test(release.tag_name.replace(/^v/, ""))) return false;
  return Array.isArray(release.assets);
}

function findExecutable(release) {
  const match = RELEASE_TAG.exec(release.tag_name.replace(/^v/, ""));
  if (!match) return null;
  const expected = `Clawd-${match[1]}.${match[2]}.${match[3]}-windows-x64.exe`;
  const asset = release.assets.find((item) => item?.name === expected);
  if (!asset || typeof asset.browser_download_url !== "string") return null;
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== `/LYL-Z/clawd-desktop/releases/download/${release.tag_name}/${expected}`) return null;
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_RELEASE_BYTES) return null;
  return { asset, name: expected };
}

async function githubRequest(url, request = fetch) {
  return request(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "ClawdDesktop-UpdateDelivery",
      "x-github-api-version": "2026-03-10",
    },
    cf: { cacheEverything: true, cacheTtl: 120 },
  });
}

export async function releaseMetadata(release, request = fetch) {
  if (!validRelease(release)) throw new Error("invalid_release");
  const selected = findExecutable(release);
  if (!selected) throw new Error("windows_asset_missing");
  const checksumAsset = release.assets.find((item) => item?.name === "SHA256SUMS.txt");
  if (!checksumAsset || typeof checksumAsset.browser_download_url !== "string") throw new Error("checksum_asset_missing");
  if (!Number.isSafeInteger(checksumAsset.size) || checksumAsset.size < 1 || checksumAsset.size > 64 * 1024) throw new Error("checksum_asset_size_invalid");

  const checksumUrl = new URL(checksumAsset.browser_download_url);
  if (checksumUrl.protocol !== "https:" || checksumUrl.hostname !== "github.com" || checksumUrl.pathname !== `/LYL-Z/clawd-desktop/releases/download/${release.tag_name}/SHA256SUMS.txt`) throw new Error("checksum_url_rejected");
  const checksumResponse = await request(checksumUrl, { cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!checksumResponse.ok) throw new Error("checksum_unavailable");
  const checksumBytes = await checksumResponse.arrayBuffer();
  if (checksumBytes.byteLength > 64 * 1024) throw new Error("checksum_asset_size_invalid");
  const checksumText = new TextDecoder().decode(checksumBytes);
  const sha256 = parseSha256Manifest(checksumText, selected.name);
  if (!sha256) throw new Error("checksum_missing");
  const reportedDigest = typeof selected.asset.digest === "string" ? selected.asset.digest.toLowerCase() : "";
  if (reportedDigest && reportedDigest !== `sha256:${sha256}`) throw new Error("checksum_mismatch");

  const tag = release.tag_name.startsWith("v") ? release.tag_name : `v${release.tag_name}`;
  return {
    tag_name: tag,
    name: typeof release.name === "string" ? release.name.slice(0, 200) : `Clawd ${tag.slice(1)}`,
    body: typeof release.body === "string" ? release.body.slice(0, MAX_NOTES_CHARS) : "",
    published_at: typeof release.published_at === "string" ? release.published_at : "",
    draft: false,
    prerelease: false,
    artifact: {
      name: selected.name,
      size: selected.asset.size,
      sha256,
      download_url: `${PUBLIC_BASE}/download/${tag}/${encodeURIComponent(selected.name)}`,
      fallback_url: selected.asset.browser_download_url,
    },
  };
}

async function readRelease(tag, request = fetch) {
  const url = tag ? `${API_BASE}/releases/tags/${encodeURIComponent(tag)}` : `${API_BASE}/releases/latest`;
  const response = await githubRequest(url, request);
  if (!response.ok) throw new Error(response.status === 404 ? "release_not_found" : "release_unavailable");
  const release = await response.json();
  if (!validRelease(release)) throw new Error("invalid_release");
  return release;
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
      const release = await readRelease("", fetcher);
      stage = "release_validation";
      const result = await releaseMetadata(release, fetcher);
      const response = json(result);
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
      const selected = findExecutable(release);
      if (!selected || selected.name !== requested.name) return json({ code: "release_asset_not_found" }, 404);
      const headers = new Headers({ "accept-encoding": "identity", "user-agent": "ClawdDesktop-UpdateDelivery" });
      for (const key of ["range", "if-range", "if-none-match", "if-modified-since"]) {
        const value = request.headers.get(key);
        if (value) headers.set(key, value);
      }
      const upstream = await fetcher(selected.asset.browser_download_url, {
        method: request.method,
        headers,
        redirect: "follow",
        cf: request.headers.has("range") ? undefined : { cacheEverything: true, cacheTtl: 3600 },
      });
      if (upstream.status < 200 || upstream.status > 299) return json({ code: "release_asset_unavailable" }, upstream.status === 404 ? 404 : 502, { "retry-after": "60" });
      return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: downloadHeaders(upstream, selected.name) });
    } catch {
      return json({ code: "release_asset_unavailable" }, 502, { "retry-after": "60" });
    }
  }

  return json({ code: "not_found" }, 404);
}

export default { fetch: handleUpdateRequest };
