# Clawd 选择性更新与分发

更新：2026-10-21。GitHub Release 是正式版本和安装文件的唯一来源。Clawd 设置中心提供用户主动触发的版本检查、可选下载、断点续传、SHA-256 校验与手动打开文件位置。应用不在后台轮询，不自动下载、执行、安装或替换正在运行的便携版。

## 当前部署状态

独立 Worker `clawd-updates` 已部署到 `clawd-updates.chronokalamos.com`，并通过 PR #12 启用了专属 `workers.dev` 入口。当前部署版本为 `63720f52-5ccf-40f4-916c-49f3a4c4ad0f`。2026-10-21 实测两个主机的 `/v1/healthz` 都为 200；workers.dev 的 `/v1/latest.json` 为 200 并返回 v1.1.0，自定义域名同一路径仍为 503。实时 Worker 日志显示后者的 GitHub release lookup 收到上游 525。Cloudflare API 只读检查确认 `chronokalamos.com` 的区域级 Origin Post-Quantum Encryption 当前为 `supported`；[Cloudflare 官方文档](https://developers.cloudflare.com/ssl/origin-configuration/automatic-key-exchange/)说明此区域设置也影响 Worker 的 `fetch()` 请求。Cloudflare 的 [workerd issue #7042](https://github.com/cloudflare/workerd/issues/7042) 记录了自定义域名 Worker 访问 GitHub 出现 525、而 workers.dev 访问成功的相同症状。为免影响同一区域的其他项目，不修改此设置。

1.1.1 候选将 `clawd-updates.3507103376.workers.dev` 作为桌面客户端首选地址，并把自定义域名作为兼容入口：对合法的 `/v1/latest.json` 与版本化下载 GET/HEAD 请求返回 `307` 到固定 `workers.dev` origin；不携带 query string，不改变方法或 Range 语义；healthz 直接返回。版本预览 URL 显式关闭。候选保留 Releases API 的 tag、manifest、大小和 SHA-256 核验，对 `browser_download_url` 执行精确仓库/tag/文件名校验，再从固定下载路径手动跳转至 `release-assets.githubusercontent.com`。当前重定向代码仍待 PR CI、合并、部署和线上验证。

用户报告 Cloudflare Workers 为 Free。Wrangler OAuth 有 Worker 脚本写权限和 Zone 读取权限，但没有 Billing Read 权限，故无法独立核对实际账单、套餐余量或账户历史。当前 Worker 没有 R2、Pages、数据库或其他付费绑定；本轮不会升级套餐或创建额外 Cloudflare 资源。

## 请求流程

```text
用户点击“检查新版本”
        │
        ├─ GET https://clawd-updates.3507103376.workers.dev/v1/latest.json (1.1.1 首选地址)
        │       └─ 通过 GitHub Releases API 查询固定仓库的最新正式版本
        │           以发行 manifest 与 Release API asset digest/大小交叉核对
        │           精确校验 browser_download_url 的仓库、tag 与文件名
        │
        └─ 边缘入口失败时，桌面应用直接查询 GitHub Releases API
            并读取 SHA256SUMS.txt

用户选择“下载更新”
        │
        ├─ 首选 clawd-updates.3507103376.workers.dev 的固定版本下载路由 (1.1.1)
        │   Worker 从固定 Release 下载路径获取文件，只允许 HTTPS 跳转到 release-assets.githubusercontent.com
        ├─ HTTP Range 分块续传至本地 updates/<version>/*.part
        ├─ 边缘源不可用时使用 GitHub Release 备用 URL
        ├─ 比对版本、文件名、文件长度和 SHA-256
        └─ 校验成功后原子改名为 EXE，并由用户选择何时手动运行
```

完整包只在字节数和 SHA-256 均匹配时才会以正式文件名显示。下载取消或网络中断时保留 `.part` 文件供后续续传；校验失败的数据不会运行，损坏的完整内容会删除。更新文件保存在 `%APPDATA%\\Clawd\\updates\\<version>`。Clawd 不会自动关闭旧进程或修改它所在的目录。

## 边缘入口隔离

Worker 名称为 `clawd-updates`，保留 `clawd-updates.chronokalamos.com` 自定义域名，并为该 Worker 单独启用 `clawd-updates.3507103376.workers.dev`。1.1.1 客户端将后者作为首选更新主机；自定义域名只对合法 metadata 和下载 GET/HEAD 请求重定向至 workers.dev，query string 仍在重定向和上游访问前拒绝，healthz 直接返回。版本预览 URL 显式关闭。服务只接受健康检查、版本元数据和固定仓库 Windows x64 正式 Release 文件的 GET/HEAD 请求，并传递 Range/If-Range。约 95 MiB 的 Windows 程序不上传到 Cloudflare 静态资产、不拆成另一套镜像；Worker 通过精确校验后的 `browser_download_url` 从 GitHub Release 流式转发，保持 GitHub Release 为唯一文件源。服务没有上传、认证、用户识别、设置同步、远程命令或任意 URL 代理接口，也不依赖 R2。

所有 query string 都在任何上游访问或应用错误日志之前拒绝。Worker Logs 关闭普通 invocation logs，并开启 Cloudflare query-string 脱敏；只保留元数据失败时的结构化诊断，记录固定错误类别、白名单错误名称/网络错误码及 HTTP 状态，不记录异常原文、请求头或响应正文。Cloudflare 的自定义日志事件仍可能带有固定 Worker 的 URL/path 上下文。

Clawd 与 GlassDesk、九霄主站及其他项目使用不同的 Worker 名称与精确子域；本次更新只部署到 `clawd-updates`，不变更其他 Worker、DNS 记录或 zone routes。部署前后都应重新列出这些资源，确认只有 Clawd 目标发生变化。

## 网络与费用边界

- 普通 Cloudflare Workers 全球网络提供额外的访问入口，但 Worker 仍需读取 GitHub Release API 和文件资产；GitHub 上游网络、API 限流或 Cloudflare 配额异常仍可能使服务暂时不可用。不能保证中国大陆所有运营商、地区和时段都可达；中国网络可达性须由不同网络的真实设备测试。
- Cloudflare 文档列出的 Workers Free 限额为每天 100,000 次 Worker 入站请求、每次 CPU 时间 10 ms、每次调用 50 个 subrequests；下载续传的各个 Range 请求分别计入入站请求额度，超额时请求会失败。请以 [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) 和 [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) 的当前条款为准。用户报告当前是 Free，但账单与余量未由 Cloudflare Billing API 独立确认；不把“零新增资源”说成账单已核验。
- Cloudflare China Network 需要 Enterprise 计划、单独的 China Network 服务、ICP 与内容审核，本项目不启用。[接入要求](https://developers.cloudflare.com/china-network/get-started/)
- SHA-256 用于核验完整性及检测文件与发布元数据不一致，不等同于 Authenticode 或独立发布者签名。Windows EXE 仍未签名；GitHub Release、更新域名/DNS 或发布者账号遭入侵的风险，不能由 SHA-256 单独解决。
- 版本检查和下载只在用户按下对应按钮后发起。服务会接收到常规 HTTPS 请求元数据（例如来源 IP）；Clawd 不发送本地设置、应用规则、任务状态或路径。

## 本地操作

```powershell
npm test
npm run check
npm run build
npm run deploy:updates
```

部署前需确认目标 `clawd-updates` Worker、精确 DNS/Custom Domain 与 zone routes；若发现与预期不同的资源占用或配置，先停止并核对，不覆盖其他项目。部署只针对 `cloudflare-updates/wrangler.jsonc` 里的单独 Clawd 主机名。部署后需验证健康检查、版本元数据、单字节 Range、跨中断续传及下载后完整 SHA-256。服务器端检查不能替代中国境内多运营商实测。

## 验证记录

本地 Worker 单元测试覆盖稳定版本筛选、发行 manifest 与 GitHub asset digest 一致性、可信重定向、Range/If-Range 透传、query 参数拒绝和错误日志脱敏；下载器测试覆盖续传、双来源回退、摘要校验及取消后保留进度。本机使用公开 Release 实测到 API 元数据 200，且 Worker 模块处理单字节 Range 返回 `206 bytes 0-0/99,967,264`；这是本机直接网络路径，不代表 Cloudflare 线上 Worker 已修复。公网健康检查虽为 200，旧版 `/v1/latest.json` 曾返回 503；新的 Worker 部署后须再次核验，并记录完整安装包大小和 SHA-256。中国网络线路尚未取得测试证据。
