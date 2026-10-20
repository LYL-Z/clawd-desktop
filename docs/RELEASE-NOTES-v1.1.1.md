# Clawd Desktop 1.1.1

Clawd 1.1.1 is a focused update-delivery hotfix for the 1.1.0 release. It directs edge checks and downloads through Clawd's isolated `workers.dev` hostname, avoiding a zone-wide TLS setting change that could affect unrelated services.

状态：1.1.1 未发布候选；最终上线结果会在发布前补录。
拟发布日期：2026-10-20
基线版本：1.1.0

## 新增

- 为 Clawd 更新 Worker 启用专属 `workers.dev` 访问入口；Windows 客户端使用该入口查询版本并下载文件。
- 仅开放固定的生产 `workers.dev` 主机，显式关闭版本预览 URL，避免产生额外的公开预览入口。
- 保留 Clawd 原有自定义域名用于健康检查与兼容观测；更新文件仍以公开 GitHub Release 为唯一来源，Worker 只流式转发。

## 调整

- 更新器将经过精确主机名白名单校验的 `workers.dev` 服务作为首选边缘源，GitHub Release API/下载链接继续作为备用源。
- 不调整 `chronokalamos.com` 区域级 TLS/后量子加密设置，不修改九霄或 GlassDesk 的 Worker、DNS、路由和资源。

## 修复与回归保护

- 针对 1.1.0 更新入口通过 Clawd 自定义域名上下文访问 GitHub Releases API 时遇到上游 HTTP 525、导致版本检查返回 503 与边缘下载失败的问题，候选改走独立 `workers.dev` 主机；是否彻底消除故障以部署后的公网验证为准。
- 保留 Release manifest、GitHub asset 大小与 SHA-256 摘要的交叉验证，以及 Range 续传、可信重定向和下载完成后的本地校验。
- Worker 拒绝所有 query string，Cloudflare Logs 开启 query-string 脱敏并关闭普通 invocation logs；只记录白名单结构化错误字段。

## 安全与隐私

- 更新请求仅在用户主动检查或下载时发起；不上传本机设置、路径、游戏规则或桌面内容。
- 新访问入口是公开的只读版本/下载服务，不增加认证、遥测、R2、数据库或用户内容存储。
- 更新域名路径不是代码签名；Windows portable EXE 仍未签名，SHA-256 只验证字节完整性。

## 兼容性与升级

- 从 1.1.0 更新无需迁移设置。1.1.0 客户端保留 GitHub 直接回退，可通过 GitHub Release 手动更新到本版；升级后边缘首选地址切换为 `workers.dev`。
- 仍为 Windows x64 portable EXE。不会自动关闭、安装或替换正在运行的程序。

## 验证范围

- 当前候选已通过 `npm test`（48/48）、`npm run check`、`npm run build` 和固定版本 Wrangler dry-run；Security Review 未发现可报告问题。
- 精确 SHA Windows CI、公网元数据、Range 与安装包完整哈希将在公开发布前完成并记录；部署后 Cloudflare 资源对照也会核实只有 Clawd Worker 有预期变化。
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
