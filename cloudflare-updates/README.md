# Clawd 更新边缘入口

这是 Clawd 独立的 Cloudflare Worker，只绑定 `clawd-updates.chronokalamos.com` 这一个专用主机名。它不复用其他项目的更新入口，不修改现有 Worker、DNS 记录或路由，也不依赖 R2。

GitHub Releases 是正式版本和文件的唯一发布源；Worker 只提供更新元数据，并将固定仓库内的 Windows x64 Release 文件按流式响应转发。文件请求仅接受 GET/HEAD、正式版本标签和匹配版本的 Clawd 安装文件名；请求中的 Range 会传到 GitHub，支持中断后续传。客户端还会在完整下载后按 Release 中的 SHA256SUMS.txt 校验，校验通过才向用户显示文件。

## 路径

- `GET /v1/healthz`：无缓存健康检查。
- `GET /v1/latest.json`：查询 GitHub 最新正式版，返回版本说明、文件长度、SHA-256、边缘下载 URL 与 GitHub 备用 URL。
- `GET /v1/download/vX.Y.Z/Clawd-X.Y.Z-windows-x64.exe`：流式转发指定正式版；支持 `Range` 与 `If-Range`。

## 部署

本目录使用仓库锁定的 Wrangler 版本。先完成 GitHub Release，再从仓库根目录运行：

```powershell
npm run deploy:updates
```

部署需要当前 Cloudflare 账号对 `chronokalamos.com` 活跃 Free zone 具有 Workers 与 DNS 权限。部署前必须确认 `clawd-updates.chronokalamos.com` 尚无 DNS 记录或 Worker Custom Domain；若发现占用就停止，不覆盖或删除原资源。部署只为这个精确主机名添加独立 Custom Domain，不创建或启用付费 R2。首次部署和每次 Worker 代码变更后，应检查 `/v1/healthz`、最新元数据、完整文件下载、Range 续传和 SHA-256。

## 网络与费用边界

该入口使用普通 Cloudflare 全球网络。它能为中国及其他地区提供一个独立于 GitHub 的访问入口，但不能保证中国大陆所有运营商、网络时段都可达；Cloudflare China Network 是另购的 Enterprise 服务并要求 ICP 等接入条件，本项目不启用。Workers 有平台配额；配额与 GitHub 网络可用性会影响下载服务。GitHub Release 页面始终作为备用入口。

Worker 只传输公开 Release 数据，没有认证、上传、遥测、用户识别、设置同步或远程命令接口。SHA-256 能发现下载损坏，并不等于 Authenticode 代码签名或独立发布者签名；Clawd Windows 包仍未签名。
