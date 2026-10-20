# Clawd 更新边缘入口

这是 Clawd 独立的 Cloudflare Worker。当前生产部署保留 `clawd-updates.chronokalamos.com` 自定义域名；1.1.1 候选配置会启用同一 Worker 的专属 `workers.dev` 域名 `clawd-updates.3507103376.workers.dev`，作为桌面更新器的首选入口。这样可避免自定义域名上下文继承 `chronokalamos.com` 的区域级出站 TLS 设置；配置不会改动该设置。候选只开放固定的生产 `workers.dev` 入口，并显式关闭版本预览 URL。部署不新增 DNS 记录或 zone routes，不复用其他项目的更新入口，也不依赖 R2。

GitHub Releases 是正式版本和文件的唯一发布源。Worker 通过固定仓库的 GitHub Releases REST API 读取最新正式版本；它要求正式 SemVer tag、非草稿/预发布版本，并以随版本发布的 manifest 与 GitHub asset API 的 SHA-256 digest、文件大小互相核对。Worker 不把安装包另存到 Cloudflare。

文件路由只接受 GET/HEAD、正式版本标签和与版本匹配的 Clawd Windows x64 安装文件名。Worker 用 GitHub release asset API 的二进制响应，并手动验证重定向目标后流式转发；Range/If-Range 会继续传递到文件源。客户端下载完成后仍按版本元数据中的 SHA-256 与字节数验证，校验通过才向用户显示文件。

## 路径

- `GET /v1/healthz`：无缓存健康检查。
- `GET /v1/latest.json`：查询 GitHub 最新正式版，返回发布说明、文件长度、SHA-256、边缘下载 URL 与 GitHub 备用 URL。
- `GET /v1/download/vX.Y.Z/Clawd-X.Y.Z-windows-x64.exe`：流式转发指定正式版；支持 `Range` 与 `If-Range`。

## 部署

本目录使用仓库锁定的 Wrangler 版本。先完成 GitHub Release，再从仓库根目录运行：

```powershell
npm run deploy:updates
```

部署使用仓库锁定的 Wrangler 版本和当前已存在的 Clawd Custom Domain。Worker 另启用专属 `workers.dev` endpoint；部署不得修改 `chronokalamos.com` 区域级 TLS 设置、现有 DNS、zone routes 或其他 Worker。每次变更后应分别检查两个主机上的健康检查，并在 `workers.dev` 主机验证最新元数据、完整文件下载、Range 续传与 SHA-256。

## 网络与费用边界

该入口使用普通 Cloudflare 全球网络，为用户提供独立于 GitHub 网页和下载域名的访问入口；Worker 自身仍从公开 GitHub Release API 与文件资产取数，因此上游网络或 API 限流仍可能使服务暂时不可用。不能保证中国大陆所有运营商、网络时段都可达；Cloudflare China Network 是另购的 Enterprise 服务并要求 ICP 等接入条件，本项目不启用。GitHub Release 页面和桌面客户端的 GitHub API 回退仍保留。

Worker 只传输公开 Release 数据，没有认证、上传、用户识别、设置同步或远程命令接口。所有 query string 都在任何上游调用和应用错误日志之前拒绝。Worker Logs 关闭普通 invocation logs、开启 Cloudflare query-string 脱敏，只保留更新元数据失败时的结构化诊断；诊断字段使用固定错误码和白名单网络错误码，不记录异常文本、请求头或响应正文。Cloudflare 的自定义日志事件仍可能附带固定服务路由的 URL/path 上下文。

SHA-256 能发现下载损坏，并不等于 Authenticode 代码签名或独立发布者签名；Clawd Windows 包仍未签名。
