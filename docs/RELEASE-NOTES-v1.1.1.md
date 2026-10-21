# Clawd Desktop 1.1.1

Clawd 1.1.1 is a focused update-delivery patch for the 1.1.0 release. It directs update checks and downloads through Clawd's isolated `workers.dev` hostname, avoiding zone-wide TLS changes that could affect unrelated services. Pet behavior, settings schema, and artwork are unchanged.

基线版本：1.1.0
构建源码提交：`f93060ba8039951e10a77264d79fa3fa8abeacf4`
正式构建及附件摘要以 `release-manifest-v1.1.1.json` 和 `SHA256SUMS.txt` 为准。

## 新增

- 为 Clawd 更新 Worker 启用专属 `workers.dev` 访问入口；Windows 客户端使用该入口查询版本并下载文件。
- 仅开放固定生产 `workers.dev` 主机，关闭预览 URL。保留既有自定义域名；有效 metadata 和下载 GET/HEAD 请求通过不缓存的 `307` 重定向至固定 `workers.dev` origin，健康检查直接返回。
- 更新器优先使用经过精确主机白名单校验的 `workers.dev` 服务，GitHub Release API 和下载 URL 继续作为备用来源。
- GitHub Release 保持唯一正式版本及文件来源；Worker 不保存发行文件，只流式转发。

## 调整

- 不调整 `chronokalamos.com` 区域级 TLS/后量子加密设置，不修改九霄或 GlassDesk 的 Worker、DNS、路由和资源。

## 修复与回归保护

- Release API 继续核对 tag、manifest、文件大小及 SHA-256。`browser_download_url` 必须精确匹配仓库、tag 和资产名；资产重定向只允许 HTTPS GitHub Release CDN。
- 保持 Range/If-Range 续传，处理 304 条件响应、416 长度和多段 Range 响应。
- Worker 拒绝 query string，关闭普通 invocation logs，并启用 Cloudflare query-string 脱敏。应用日志只写固定错误码和白名单字段；回归测试覆盖 `Authorization: Bearer …` 尾段、`api_token=…`、Authorization 请求头和异常文本。
- 不修改 `chronokalamos.com` 区域级 TLS/后量子加密设置，不修改九霄或 GlassDesk 的 Worker、DNS、路由和资源。

## 安全与隐私

- 更新请求只在用户主动检查或下载时发起；不上传本机设置、路径、游戏规则或桌面内容。

## 兼容性与升级

- 从 1.1.0 升级无需迁移设置。Windows x64 同时提供 portable EXE 与当前用户 NSIS 安装向导。安装向导创建开始菜单快捷方式和 Windows 卸载项，不要求管理员权限，并沿用 `%APPDATA%\Clawd` 用户数据目录。
- 内置更新器仍只提供 portable EXE，下载后由用户手动运行；不会自动关闭、安装或替换正在运行的程序。安装版用户应从 GitHub Release 下载 NSIS 向导进行升级。
- Windows EXE 与 NSIS 安装向导未签名。SHA-256 用于核验文件完整性，不证明发布者身份。

## 验证范围

| 检查 | 结果与范围 |
| --- | --- |
| Windows CI | PR #16 head `1d28936a77b54bf1cbb25fb318617c26693a01ca` 和合并后精确源码 SHA `f93060ba8039951e10a77264d79fa3fa8abeacf4` 均通过 Windows CI。 |
| 本地检查 | `npm run check`、`npm test`（55/55，其中 Worker 20 项）、`python -m unittest discover -s tests`（4/4）、`npm run build`、`npm run qa:probe` 和 Wrangler 4.151.2 dry-run 通过。 |
| 安全复审 | 复核固定重定向与 CDN 限制、日志脱敏、Range/If-Range、multipart、304/416 和 alias 路由；未发现实质性安全问题。 |
| 正式包冒烟 | `Clawd-1.1.1-windows-x64.exe` 启动、五张图集加载、28 个动作条目、原生探针及正常关闭检查通过。资产大小 99,969,008 字节；SHA-256 为 `b5ee0f56972a3759a6a709afcd8cc5b1d0b37cd84704e868a307a53cab811fa5`。 |
| NSIS 安装验证 | 本机当前用户静默安装返回 0；Windows 卸载注册项、开始菜单快捷方式和安装路径均已核对，1.1.1 进程及可见窗口通过检查。已验证安装包内 `app.asar` 与正式 portable 包一致。PR #19 的精确 SHA Windows CI 也成功生成 NSIS 包；正式上传文件由仓库 Windows 发布工作流构建。最终发布附件的大小和 SHA-256 以 manifest 与 `SHA256SUMS.txt` 为准，不把本机候选安装器摘要当作远端附件摘要。 |
| Windows 稳定性 | 用户于 2026-10-21 将完整 4 小时门槛改为沿用先前约 1 小时观察。原记录实际为 3,481.287 秒（58 分 1 秒）、59 次样本，来自 1.1.0 候选 SHA `9aff3f54b09f9b93be0706a06b29ecb24d7c305971441a0d0eaaeaa8b523e39f`，不是精确 60 分钟或 1.1.1 包。最终 1.1.1 包另有 6,482 秒、109 个采样检查点的普通模式中断观察；最后记录健康，但脚本未写出完整报告或 `passed` 结论。两份观察均不记作 4 小时通过。详情见[1.1.1 稳定性记录](qa/2026-10-21-v1.1.1-windows-stability.md)。 |
| Worker 公网 | v1.1.1 发布后，metadata 返回 v1.1.1、99,969,008 字节及预期 SHA-256；Worker 完整下载返回 HTTP 200，下载后的 SHA-256 与本地 EXE 及 GitHub asset digest 相同。单字节 Range 为 206，越界 Range 为 416，HEAD 为 200；自定义域名 Range 请求先 307 至固定 workers.dev origin，再返回 206；带 query 为 400，未知路径为 404。 |

长稳测试范围为单台 Windows 11 主机、一个活动显示器、250% 缩放的普通桌面观察；没有在这次观察中运行游戏、锁屏、休眠、显示器热插拔或崩溃注入。任务书列出的 15 个目标设备场景由用户报告通过，未收到逐项日志或截图，因此仍标为用户报告。24 小时观察和中国境内多运营商下载测试没有执行。

## 已知限制

- 普通 Cloudflare 全球网络不能保证中国大陆所有运营商及所有时段可达；没有中国境内实测证据。
- Cloudflare Workers Free 是用户报告；OAuth 缺少 Billing Read 权限，账单及额度余量未独立核实。本版本不创建新的付费资源。
- EXE 未签名；项目为非官方粉丝作品。公开可见不代表取得再分发或商业使用许可。

## 发布文件与校验

发行附件包括 `Clawd-1.1.1-windows-x64.exe`、`Clawd-1.1.1-Setup-windows-x64.exe`、`Clawd-Codex-V2.zip`、`Clawd-dark-3840x2160.png`、`Clawd-light-3840x2160.png`、`release-manifest-v1.1.1.json` 和 `SHA256SUMS.txt`。逐项大小与摘要以 manifest 和校验清单为准；manifest 自身由校验清单验证，不作递归自引用。Worker 仍只查询和分发便携 EXE；NSIS 安装向导只作为 GitHub Release 附件提供。

## 构建溯源

portable 程序和安装器中的应用内容来自 `f93060ba8039951e10a77264d79fa3fa8abeacf4`；NSIS 打包配方由 PR #19 加入。manifest 的 `sourceCommit` 标识应用源码，`packagingCommit` 标识安装器发布流程使用的提交；文件名、字节数和 SHA-256 以 manifest 及 `SHA256SUMS.txt` 为准。

## 分发与地域范围

GitHub Release 是唯一的正式版本和文件发布源；Clawd Worker 的 `workers.dev` 主机提供只读 metadata 与流式下载入口，不保存发行副本。服务不承诺所有国家或地区网络持续可达，Cloudflare China Network 不在本版本范围内。
