# Clawd 选择性更新与分发

更新：2026-10-20。GitHub Release 是唯一正式版本和安装文件来源。Clawd 设置中心提供用户主动触发的版本检查、可选下载、断点续传、SHA-256 校验与手动打开文件位置。应用不在后台轮询，不自动下载、执行、安装或替换正在运行的便携版。

**部署状态：**客户端和专用 Worker 源码已实现，但截至本记录日期 Worker 尚未发布到 Cloudflare，域名也没有公网下载验收。应用仍可通过固定 GitHub 源回退查询/下载。Cloudflare 账户当前套餐/计费状态未能通过账户接口确认，因此未执行部署，避免产生未授权费用。

## 请求流程

```text
用户点击“检查新版本”
        │
        ├─ GET https://clawd-updates.chronokalamos.com/v1/latest.json
        │       └─ 查询固定仓库 LYL-Z/clawd-desktop 的最新正式 GitHub Release
        │
        └─ 边缘入口失败时，直接查询 GitHub Releases API 并读取 SHA256SUMS.txt

用户选择“下载更新”
        │
        ├─ 首选 clawd-updates.chronokalamos.com 的固定版本下载路由
        ├─ HTTP Range 分块续传至本地 updates/<version>/*.part
        ├─ 边缘源不可用时使用 GitHub Release 备用 URL
        ├─ 比对版本、文件名、文件长度和 SHA-256
        └─ 校验成功后原子改名为 EXE，并由用户选择何时手动运行
```

完整包只在字节数和 SHA-256 均匹配时才会以正式文件名显示。下载取消或网络中断时保留 `.part` 文件供后续续传；校验失败的数据不会运行，损坏的完整内容会删除。更新文件保存在 `%APPDATA%\Clawd\updates\<version>`。Clawd 不会自动关闭旧进程或修改它所在的目录。

## 边缘入口隔离

边缘 Worker 的名称为 `clawd-updates`，配置只绑定 `clawd-updates.chronokalamos.com`。它只接受健康检查、最新版本元数据和固定仓库 Windows x64 正式 Release 文件的 GET/HEAD 请求，并传递 Range/If-Range。约 95 MiB 的 Windows 程序不会被上传成 Cloudflare 静态资产或拆分成另一套镜像；Worker 按请求将 GitHub Release 响应流式转发，保持 GitHub 为唯一源文件位置。它没有上传、认证、设置同步、遥测、远程命令或任意 URL 代理接口，不依赖 R2。

设计上 Clawd 使用单独的 Worker 服务和精确子域主机名。先前只读预检未发现 `clawd-updates.chronokalamos.com` 的精确 DNS/Custom Domain 冲突；没有写入任何 DNS、Worker 或 route。部署前仍需重新只读检查目标 DNS、Custom Domain 和 Worker；任一已有资源时必须停止，不能覆盖或删除。若未来获得明确的零新增费用状态并获准部署，只能绑定此精确子域及 `clawd-updates` 服务，部署后需验证既有 Worker 与路由未变。流程不授权改动九霄主站、GlassDesk、主站 DNS 或其他项目服务。

## 网络、费用与信任边界

- 普通 Cloudflare Workers 全球网络可增加 GitHub 之外的下载入口，但不能保证中国大陆所有运营商、地域、线路和时段都可达。Edge 与 GitHub 同时不可达时，Clawd 仍保留已下载字节并报告失败。
- Worker 实现不依赖 R2 或其他存储产品，但这不代表账户必然是零费用。Cloudflare 文档称 Workers Free 每日 100,000 次请求、单次 CPU 时间 10 ms；每次下载的每段 Range 都会计入请求量，超出免费日额度会被限流。[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) 与 [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) 说明公开费率，不证明当前账户的实际套餐、余量或账单。部署前必须确认账户仍处于免费 Workers 计划、无须新增订阅/付费升级；未能确认时保持未部署。不会自动升级或创建付费资源。
- Cloudflare 中国网络不是免费线路开关；官方要求 Enterprise 计划、单独的 China Network 服务、ICP 与内容审核，因此不在零新增费用范围内，也未启用。[Cloudflare China Network 接入要求](https://developers.cloudflare.com/china-network/get-started/) 普通全球 Worker 即使以后部署，也不能保证中国大陆所有网络均可达。
- SHA-256 用于核验字节完整性以及检测与发布清单不一致，不等同于 Authenticode 或独立发布者数字签名。Windows EXE 仍未签名；只从本项目公开 Release 获取并核对哈希，不要关闭 Windows 安全保护。
- GitHub Release 或更新入口遭入侵、发布者账号失陷、更新域名/DNS 被控制等情形超出 SHA-256 的独立信任能力。没有代码签名、独立签名密钥验证或外部审计。
- 版本检查、下载只在对应按钮点击后发起。网络服务会接收到常规 HTTPS 请求元数据（如来源 IP）；Clawd 不发送个人设置、应用规则、任务状态或本机路径。

## 本地操作

```powershell
npm test
npm run check
npm run build
npm run deploy:updates
```

若将来进行部署，当前 Cloudflare 账户必须对 `chronokalamos.com` 具有精确所需权限，且免费额度/费用已确认。首次绑定前先重新核对目标 DNS、当前 `clawd-updates` 脚本和 zone 路由；只写入 `clawd-updates.chronokalamos.com` 与 `clawd-updates` 两个精确目标，不执行批量 DNS、zone 路由或账户级重置。部署后验证健康检查、正式版本元数据、单字节 Range、跨中断续传和完整包 SHA-256。发布服务器检查不替代中国境内多运营商实测。

## 验证记录

本地 Worker 单元测试覆盖正式版筛选、SHA-256 清单与 GitHub digest 一致性、Range/If-Range 透传、错误路由拒绝；本地下载器测试覆盖续传、双来源回退、摘要校验和取消后保留进度。Cloudflare 部署、公开 HTTPS 可达、真实 Release 大文件下载和中国网络线路验收均未取得证据；每项须分别记录实际结果，未实测前不得写成完成。
