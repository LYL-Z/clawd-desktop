const REPOSITORY = "LYL-Z/clawd-desktop";
const GITHUB_BASE = `https://github.com/${REPOSITORY}`;
const GITHUB_API_BASE = `https://api.github.com/repos/${REPOSITORY}`;
const RELEASE_ASSET_HOST = "release-assets.githubusercontent.com";
const PUBLIC_BASE = "https://clawd-updates.3507103376.workers.dev/v1";
const MAX_RELEASE_BYTES = 250 * 1024 * 1024;
const MAX_RELEASE_METADATA_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_NOTES_CHARS = 12_000;
const RELEASE_TAG = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const EXECUTABLE_NAME = /^Clawd-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-windows-x64\.exe$/;
const SAFE_ERROR_CODES = new Set([
  "invalid_release",
  "release_not_found",
  "release_unavailable",
  "manifest_unavailable",
  "manifest_invalid",
  "upstream_redirect_rejected",
  "windows_asset_missing",
  "checksum_mismatch",
]);
const SAFE_UPSTREAM_CAUSE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function metadataErrorCode(error) {
  const code = error instanceof Error ? error.message : "";
  return SAFE_ERROR_CODES.has(code) ? code : "upstream_error";
}

function metadataErrorDetails(error) {
  const allowedNames = new Set(["TypeError", "Error", "RangeError", "SyntaxError", "URIError"]);
  const name = error instanceof Error && allowedNames.has(error.name) ? error.name : "OtherError";
  const causeCode = error && typeof error.cause?.code === "string" && SAFE_UPSTREAM_CAUSE_CODES.has(error.cause.code)
    ? error.cause.code
    : null;
  const upstreamStatus = Number.isSafeInteger(error?.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599
    ? error.upstreamStatus
    : null;
  // Log only allowlisted metadata; exception messages, stacks, URLs, and headers may contain credentials.
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

function trustedReleaseDownloadUrl(value, tag, name) {
  const expected = releaseAssetUrl(tag, name);
  if (typeof value !== "string" || value !== expected) throw new Error("upstream_redirect_rejected");
  let url;
  try { url = new URL(value); }
  catch { throw new Error("upstream_redirect_rejected"); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("upstream_redirect_rejected");
  }
  return url;
}

function trustedReleaseRedirectUrl(value, current, expected) {
  let url;
  try { url = new URL(value, current); }
  catch { throw new Error("upstream_redirect_rejected"); }
  const safeCdnRedirect = url.protocol === "https:" && url.hostname === RELEASE_ASSET_HOST && !url.username && !url.password && !url.port && !url.hash;
  if (!safeCdnRedirect && url.href !== expected) throw new Error("upstream_redirect_rejected");
  return url;
}

async function fetchReleaseAsset(value, tag, name, init, request) {
  const expected = releaseAssetUrl(tag, name);
  let url = trustedReleaseDownloadUrl(value, tag, name);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await request(url, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 5) {
      await response.body?.cancel();
      throw new Error("upstream_redirect_rejected");
    }
    await response.body?.cancel();
    url = trustedReleaseRedirectUrl(location, url, expected);
  }
  throw new Error("upstream_redirect_rejected");
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
  const releaseApiPath = `/repos/${REPOSITORY}/releases/`;
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" || !url.pathname.startsWith(releaseApiPath) || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("upstream_redirect_rejected");
  }
  return url;
}

async function fetchTrustedUpstream(value, init, request) {
  let url = trustedUpstreamUrl(value);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await request(url, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 5) {
      await response.body?.cancel();
      throw new Error("upstream_redirect_rejected");
    }
    await response.body?.cancel();
    url = trustedUpstreamUrl(new URL(location, url));
  }
  throw new Error("upstream_redirect_rejected");
}

function safeUpstreamError(code, error) {
  const wrapped = new Error(code);
  const causeCode = error && typeof error.cause?.code === "string" && SAFE_UPSTREAM_CAUSE_CODES.has(error.cause.code)
    ? error.cause.code
    : null;
  if (causeCode) wrapped.cause = { code: causeCode };
  return wrapped;
}

async function fetchReleaseDescriptor(url, request, errorCode, cacheTtl) {
  let response;
  try {
    response = await fetchTrustedUpstream(url, {
      headers: {
        "user-agent": "ClawdDesktop-UpdateDelivery",
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cf: { cacheEverything: true, cacheTtl },
    }, request);
  } catch (error) {
    throw safeUpstreamError(errorCode, error);
  }
  if (!response.ok) {
    const error = new Error(response.status === 404 ? "release_not_found" : errorCode);
    error.upstreamStatus = response.status;
    throw error;
  }
  let data;
  try {
    const bytes = await readBounded(response, MAX_RELEASE_METADATA_BYTES, errorCode);
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(errorCode);
  return data;
}

function validateReleaseDescriptor(release, expectedTag) {
  let tag;
  try { tag = canonicalTag(release?.tag_name); }
  catch { throw new Error("invalid_release"); }
  if (
    (expectedTag && tag !== canonicalTag(expectedTag)) ||
    release.draft !== false || release.prerelease !== false ||
    !Array.isArray(release.assets)
  ) throw new Error("invalid_release");
  return tag;
}

async function resolveLatestRelease(request = fetch) {
  const release = await fetchReleaseDescriptor(`${GITHUB_API_BASE}/releases/latest`, request, "release_unavailable", 120);
  validateReleaseDescriptor(release);
  return release;
}

async function fetchReleaseAssetText(asset, request, maximumBytes, errorCode) {
  let response;
  try {
    response = await fetchReleaseAsset(asset.downloadUrl, asset.tag, asset.name, {
      headers: {
        "user-agent": "ClawdDesktop-UpdateDelivery",
        accept: "application/octet-stream",
      },
    }, request);
  } catch (error) {
    throw safeUpstreamError(errorCode, error);
  }
  if (!response.ok) {
    const error = new Error(response.status === 404 ? "release_not_found" : errorCode);
    error.upstreamStatus = response.status;
    throw error;
  }
  const bytes = await readBounded(response, maximumBytes, errorCode);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function findReleaseAsset(release, tag, name) {
  const matches = release.assets.filter((asset) => asset?.name === name);
  if (matches.length !== 1) return null;
  const asset = matches[0];
  if (asset.state !== "uploaded" || !Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) || asset.size < 0) return null;
  return {
    id: asset.id,
    name,
    size: asset.size,
    digest: asset.digest,
    tag,
    downloadUrl: trustedReleaseDownloadUrl(asset.browser_download_url, tag, name).href,
  };
}

async function readRelease(tagOrDescriptor, request = fetch) {
  let descriptor;
  if (typeof tagOrDescriptor === "string") {
    const tag = canonicalTag(tagOrDescriptor);
    descriptor = await fetchReleaseDescriptor(`${GITHUB_API_BASE}/releases/tags/${encodeURIComponent(tag)}`, request, "release_unavailable", 3600);
  } else {
    descriptor = tagOrDescriptor;
  }
  const tag = validateReleaseDescriptor(descriptor, typeof tagOrDescriptor === "string" ? tagOrDescriptor : undefined);
  const version = versionOf(tag);
  const expectedName = expectedExecutable(tag);
  const manifestAsset = findReleaseAsset(descriptor, tag, `release-manifest-${tag}.json`);
  const executableAsset = findReleaseAsset(descriptor, tag, expectedName);
  if (!manifestAsset || !executableAsset) throw new Error("windows_asset_missing");
  if (
    manifestAsset.size < 1 || manifestAsset.size > MAX_MANIFEST_BYTES ||
    executableAsset.size < 1 || executableAsset.size > MAX_RELEASE_BYTES ||
    typeof executableAsset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(executableAsset.digest)
  ) throw new Error("manifest_invalid");

  const manifestText = await fetchReleaseAssetText(manifestAsset, request, MAX_MANIFEST_BYTES, "manifest_unavailable");

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

  const checksum = artifact.sha256.toLowerCase();
  const apiDigest = executableAsset.digest.slice("sha256:".length).toLowerCase();
  if (executableAsset.size !== artifact.bytes || checksum !== apiDigest) throw new Error("checksum_mismatch");

  return {
    tag,
    manifest,
    artifact: { name: expectedName, size: artifact.bytes, sha256: checksum },
    assetDownloadUrl: executableAsset.downloadUrl,
    release: descriptor,
  };
}

function metadataFor(release) {
  const { tag, manifest, artifact, release: descriptor } = release;
  const fallbackUrl = releaseAssetUrl(tag, artifact.name);
  return {
    tag_name: tag,
    name: `Clawd Desktop ${versionOf(tag)}`,
    body: typeof descriptor.body === "string" ? descriptor.body.slice(0, MAX_NOTES_CHARS) : "",
    published_at: typeof descriptor.published_at === "string" ? descriptor.published_at : "",
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
  return metadataFor(release);
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
  const upstreamContentType = headers.get("content-type") ?? "";
  if (source.status === 206 && /^multipart\/byteranges(?:\s*;|$)/i.test(upstreamContentType)) {
    headers.set("content-type", upstreamContentType);
  } else {
    headers.set("content-type", "application/octet-stream");
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-clawd-update-edge", "1");
  return headers;
}

export async function handleUpdateRequest(request, fetcher = fetch) {
  const url = new URL(request.url);
  if (url.search) return json({ code: "query_not_supported" }, 400);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "Range, If-Range" } });
  if (request.method !== "GET" && request.method !== "HEAD") return json({ code: "method_not_allowed" }, 405, { allow: "GET, HEAD, OPTIONS" });
  if (url.pathname === "/v1/healthz") return json({ service: "clawd-updates", status: "ok" }, 200, { "cache-control": "no-store" });

  if (url.pathname === "/v1/latest.json") {
    let stage = "release_lookup";
    try {
      const descriptor = await resolveLatestRelease(fetcher);
      stage = "release_validation";
      const release = await readRelease(descriptor, fetcher);
      const response = json(metadataFor(release));
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
      const upstream = await fetchReleaseAsset(release.assetDownloadUrl, release.tag, release.artifact.name, {
        method: request.method,
        headers: new Headers({ ...Object.fromEntries(headers), accept: "application/octet-stream" }),
      }, fetcher);
      if (upstream.status === 304) {
        return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: downloadHeaders(upstream, release.artifact.name) });
      }
      if (upstream.status === 416) {
        return json({ code: "range_not_satisfiable" }, 416, { "accept-ranges": "bytes", "content-range": `bytes */${release.artifact.size}` });
      }
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
