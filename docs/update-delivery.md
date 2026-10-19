# Clawd 选择性更新与分发

更新：2026-10-19。GitHub Release 是唯一正式版本和安装文件来源。Clawd 设置中心提供用户主动触发的版本检查、可选下载、断点续传、SHA-256 校验与手动打开文件位置。应用不在后台轮询，不自动下载、执行、安装或替换正在运行的便携版。

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

Clawd 使用单独的 Worker 服务和精确子域主机名。部署前先只读检查目标 DNS 记录和 Custom Domain；任一已存在时必须停止，不能覆盖或删除。部署后再核对目标域名已绑定到 Clawd Worker、其他 Worker 与既有路由保持原样。该流程不改动主站 DNS、其他项目 Worker 或其他域名。

## 网络、费用与信任边界

- 普通 Cloudflare Workers 全球网络可增加 GitHub 之外的下载入口，但不能保证中国大陆所有运营商、地域、线路和时段都可达。Edge 与 GitHub 同时不可达时，Clawd 仍保留已下载字节并报告失败。
- 本设计使用已启用的 `chronokalamos.com` Free Website zone 与 Workers 免费入口，不启用 R2，不创建付费存储或商业套餐。Cloudflare 当前文档列出 Workers Free 每日 100,000 次请求、单次 CPU 10ms 等限制；每次下载的每段 Range 都会计入请求量，超过免费日额度后服务可能返回限制错误。我们不会为突破额度自动升级或启用付费资源；实际费用状态以 Cloudflare 账户控制台为准。[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Cloudflare 中国网络不是免费线路开关；其官方接入需要 Enterprise 计划、单独的 China Network 服务、ICP 及内容审核等条件，因此本项目不作中国大陆全网可达承诺。[Cloudflare China Network 接入要求](https://developers.cloudflare.com/china-network/get-started/)
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

Worker 部署需要当前 Cloudflare 账户对 `chronokalamos.com` 具有 Workers 与 DNS 写权限。首次绑定前，先核对目标 DNS、当前 `clawd-updates` 脚本和 zone 路由；只允许写入 `clawd-updates.chronokalamos.com` 与 `clawd-updates` 这两个精确目标，不执行批量 DNS、zone 路由或账户级重置。部署后验证健康检查、正式版本元数据、单字节 Range、跨中断续传和完整包 SHA-256。发布服务器检查不替代中国境内多运营商实测。

## 验证记录

本地 Worker 单元测试覆盖正式版筛选、SHA-256 清单与 GitHub digest 一致性、Range/If-Range 透传、错误路由拒绝；本地下载器测试覆盖续传、双来源回退、摘要校验和取消后保留进度。Cloudflare 部署、公开 HTTPS 可达、真实 Release 大文件下载和中国网络线路验收须分别记录实际结果；未实测前不得写成完成。
