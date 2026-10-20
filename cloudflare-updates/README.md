# Clawd 更新边缘入口

这是 Clawd 独立的 Cloudflare Worker，只绑定 `clawd-updates.chronokalamos.com` 这一个专用主机名。它不复用其他项目的更新入口，不修改现有 Worker、DNS 记录或路由，也不依赖 R2。

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

部署需要当前 Cloudflare 账号对 `chronokalamos.com` 活跃 Free zone 具有 Workers 与 DNS 权限。部署前必须确认 `clawd-updates.chronokalamos.com` 尚无 DNS 记录或 Worker Custom Domain；若发现占用就停止，不覆盖或删除原资源。部署只为这个精确主机名添加独立 Custom Domain，不创建或启用付费 R2。首次部署和每次 Worker 代码变更后，应检查 `/v1/healthz`、最新元数据、完整文件下载、Range 续传和 SHA-256。

## 网络与费用边界

该入口使用普通 Cloudflare 全球网络，为用户提供独立于 GitHub 网页和下载域名的访问入口；Worker 自身仍从公开 GitHub Release API 与文件资产取数，因此上游网络或 API 限流仍可能使服务暂时不可用。不能保证中国大陆所有运营商、网络时段都可达；Cloudflare China Network 是另购的 Enterprise 服务并要求 ICP 等接入条件，本项目不启用。GitHub Release 页面和桌面客户端的 GitHub API 回退仍保留。

Worker 只传输公开 Release 数据，没有认证、上传、用户识别、设置同步或远程命令接口。所有 query string 都在任何上游调用和应用错误日志之前拒绝。Worker Logs 关闭普通 invocation logs、开启 Cloudflare query-string 脱敏，只保留更新元数据失败时的结构化诊断；诊断字段使用固定错误码和白名单网络错误码，不记录异常文本、请求头或响应正文。Cloudflare 的自定义日志事件仍可能附带固定服务路由的 URL/path 上下文。

SHA-256 能发现下载损坏，并不等于 Authenticode 代码签名或独立发布者签名；Clawd Windows 包仍未签名。
