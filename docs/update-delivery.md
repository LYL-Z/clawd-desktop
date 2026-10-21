# Clawd 选择性更新与分发

更新：2026-10-21。GitHub Release 是正式版本和安装文件的唯一来源。Clawd 设置中心提供用户主动触发的版本检查、可选下载、断点续传、SHA-256 校验与手动打开文件位置；内置更新器只分发便携 EXE，不自动下载、执行、安装或替换正在运行的程序。Windows x64 NSIS 安装向导作为 GitHub Release 附件单独提供，安装版用户应使用该向导升级。

## 当前部署状态

独立 Worker `clawd-updates` 已部署到 `clawd-updates.chronokalamos.com`，并启用专属 `workers.dev` 入口。PR #13 将资产传输切换到经验证的 GitHub Release 下载路径；PR #14 增加自定义域名兼容重定向。PR #14 head `e41f782b9940de7d5fc7ae017e4b25cf9795b7cb` 的 push 与 PR Windows CI 均通过，合并提交为 `fdda659d419a882d36532c702415f0b2b6981bb2`。部署版本为 `77e92a01-7b3f-488e-83f3-1b540ff4b91c`。

2026-10-21 v1.1.1 发布后复验：workers.dev `/v1/latest.json` 返回 tag `v1.1.1`、资产大小 99,969,008 字节及 SHA-256 `b5ee0f56972a3759a6a709afcd8cc5b1d0b37cd84704e868a307a53cab811fa5`。通过 Worker 完整下载返回 HTTP 200，99,969,008 字节，耗时 129.568 秒；下载结果摘要与本地 EXE 和 GitHub Release asset digest 相同。单字节 Range 为 206 且 `Content-Range: bytes 0-0/99969008`；越界 Range 为 416 且 `Content-Range: bytes */99969008`；HEAD 返回 200 与正确长度。自定义域名 Range 请求按设计先返回 307 至固定 workers.dev origin，跟随后 Range 为 206。healthz 返回 200，带 query 的请求为 400，未知路径为 404。此前自定义域名到 GitHub 的 525 由固定重定向路径绕开；没有修改区域 TLS/PQ、DNS、zone routes 或其他项目资源。

客户端将 `clawd-updates.3507103376.workers.dev` 作为首选地址，自定义域名作为兼容入口：对合法的 `/v1/latest.json` 与版本化下载 GET/HEAD 请求返回不缓存的 `307` 到固定 `workers.dev` origin；不携带 query string，healthz 直接返回。版本预览 URL 显式关闭。Worker 保留 Releases API 的 tag、manifest、大小和 SHA-256 核验，对 `browser_download_url` 执行精确仓库/tag/文件名校验，再从固定下载路径手动跳转至 `release-assets.githubusercontent.com`。

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

本地 Worker 单元测试覆盖稳定版本筛选、发行 manifest 与 GitHub asset digest 一致性、可信重定向、Range/If-Range 透传、query 参数拒绝和错误日志脱敏；下载器测试覆盖续传、双来源回退、摘要校验及取消后保留进度。部署后公网验证覆盖 healthz、metadata、固定 307 alias、单字节 Range 206、越界 Range 416、HEAD、query 拒绝、未知路径和完整 99,969,008 字节 Worker 响应 SHA-256；该完整响应与 v1.1.1 本地构建及 GitHub asset digest 一致。安全复审未发现实质性问题。中国境内多运营商可达性仍无实测证据；海外网络结果不能替代该项。
