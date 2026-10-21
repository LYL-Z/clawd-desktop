# Clawd Desktop 1.1.1

Clawd 1.1.1 is a focused update-delivery hotfix for the 1.1.0 release. It directs edge checks and downloads through Clawd's isolated `workers.dev` hostname, avoiding a zone-wide TLS setting change that could affect unrelated services.

基线版本：1.1.0

## 新增

- 为 Clawd 更新 Worker 启用专属 `workers.dev` 访问入口；Windows 客户端使用该入口查询版本并下载文件。
- 仅开放固定的生产 `workers.dev` 主机，显式关闭版本预览 URL，避免产生额外的公开预览入口。
- 保留 Clawd 原有自定义域名；对有效的 metadata 与下载 GET/HEAD 请求返回 `307`，指向 `workers.dev`，健康检查继续直返。
- 更新文件仍以公开 GitHub Release 为唯一来源，Worker 只流式转发。

## 调整

- 更新器将经过精确主机名白名单校验的 `workers.dev` 服务作为首选边缘源，GitHub Release API/下载链接继续作为备用源。
- 不调整 `chronokalamos.com` 区域级 TLS/后量子加密设置，不修改九霄或 GlassDesk 的 Worker、DNS、路由和资源。

## 修复与回归保护

- 针对 1.1.0 更新入口通过 Clawd 自定义域名上下文访问 GitHub Releases API 时遇到上游 HTTP 525、导致版本检查返回 503 与边缘下载失败的问题，客户端首选独立 `workers.dev` 主机；自定义域名兼容入口把有效 metadata/下载请求不缓存重定向至固定 `workers.dev` origin。
- PR #14 合并并部署后，线上两个主机的 healthz 均为 200，workers.dev metadata 为 200，自定义域名 metadata 返回 307 后跟随为 200；Range 下载也经重定向返回 206。区域级 TLS/PQ 设置保持不变。
- 保留 Release manifest、GitHub Releases API 中的资产大小与 SHA-256 摘要交叉验证；资产字节通过精确校验后的 `browser_download_url` 获取，并只允许 HTTPS 跳转到 GitHub Release CDN。
- 保留 Range/If-Range 续传和本地完整下载校验；补齐条件请求的 304 响应与 manifest 文件长度支持的 416 响应。
- 日志只记录固定错误码与白名单元数据，并以回归测试覆盖 Bearer token 尾段、`api_token` 值、Authorization 请求头和异常文本。
- Worker 拒绝所有 query string，Cloudflare Logs 开启 query-string 脱敏并关闭普通 invocation logs；只记录白名单结构化错误字段。

## 安全与隐私

- 更新请求仅在用户主动检查或下载时发起；不上传本机设置、路径、游戏规则或桌面内容。
- 新访问入口是公开的只读版本/下载服务，不增加认证、遥测、R2、数据库或用户内容存储。
- 更新域名路径不是代码签名；Windows portable EXE 仍未签名，SHA-256 只验证字节完整性。

## 兼容性与升级

- 从 1.1.0 更新无需迁移设置。1.1.0 客户端保留 GitHub 直接回退，可通过 GitHub Release 手动更新到本版；升级后边缘首选地址切换为 `workers.dev`。
- 仍为 Windows x64 portable EXE。不会自动关闭、安装或替换正在运行的程序。

## 验证范围

- `npm run check`、`npm test`（55/55，其中 Worker 20/20）、`python -m unittest discover -s tests`（4/4）、`npm run build` 与 `npm run qa:probe` 均通过；PR #13 与 PR #14 的精确 head Windows CI 均通过。PR #14 head `e41f782b9940de7d5fc7ae017e4b25cf9795b7cb` 已合并至 `fdda659d419a882d36532c702415f0b2b6981bb2`。
- 安全复审覆盖 Bearer/API token 日志泄漏、固定重定向目标、可信 GitHub/CDN 跳转和 Range 处理，未发现实质性问题。日志只记录白名单结构化字段，并由异常文本、Authorization 与 query token 回归测试保护。
- 已部署 Worker 版本 `77e92a01-7b3f-488e-83f3-1b540ff4b91c`。两个主机 healthz 均为 200；workers.dev metadata 为 200；自定义域名 metadata/下载通过固定 307 到 workers.dev 后返回 200/206。单字节 Range、无效 Range、query 与未知路径分别返回 206、416、400、404。
- 中国大陆运营商实测需要目标地区真实网络，海外公网验证不能替代该项。

## 已知限制

- Cloudflare Workers 套餐为用户报告的 Free；OAuth 没有 Billing Read 权限，因此账单和余量未被独立核验。本版本不新增付费资源。
- 普通 Cloudflare 全球网络不能保证中国大陆所有运营商和时段可达；目前没有中国境内实测证据。
- 1.1.0 的 4 小时稳定性观察在 3,481 秒后停止，未达到门槛；1.1.1 不把该部分观察记作通过。24 小时可选测试未执行。

## 构建溯源

正式构建源码提交、构建时间和发行附件摘要以随版本发布的 `release-manifest-v1.1.1.json` 与 `SHA256SUMS.txt` 为准。

## 发布文件与校验

发行附件包括 `Clawd-1.1.1-windows-x64.exe`、`Clawd-Codex-V2.zip`、`Clawd-dark-3840x2160.png`、`Clawd-light-3840x2160.png`、`release-manifest-v1.1.1.json` 与 `SHA256SUMS.txt`。文件大小和 SHA-256 以 manifest 与校验清单为准；manifest 自身由 `SHA256SUMS.txt` 校验，不作递归自引用。

## 分发与地域范围

GitHub Release 保持唯一的版本和文件发布源；Clawd Worker 的 `workers.dev` 主机提供额外下载入口，不存储副本。服务不承诺所有国家/地区、尤其中国大陆所有运营商网络始终可达。Cloudflare China Network 不在本版本范围内。
