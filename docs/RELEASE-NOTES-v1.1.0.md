# Clawd 1.1.0

本版本在 1.0.1 基础上增量完善 Windows 场景识别、设置体验和可复现交付；保留现有陶土像素角色、图集、造型、动作、演出、物理和本地任务状态桥。

## 主要变化

- 以原因集合统一游戏、全屏、手动隐藏、Windows 锁屏与系统挂起的可见性仲裁。
- 原生探针输出版本化 JSON，支持用户显式添加 EXE 的完整路径/文件名规则、进程运行状态、心跳监测和退避重启。
- 新增桌面设置中心、衣柜画布预览、场景模式、游戏/例外规则编辑和托盘状态提示。
- 旧设置文件可迁移；配置损坏时先备份，保存采用串行队列和临时文件替换。
- 宠物隐藏时停止动画帧与鼠标命中更新；设置预览在窗口隐藏时暂停。
- 设置页增加手动版本检查和可选下载：优先使用 Clawd 独立更新入口，失败时回退 GitHub；支持 Range 断点续传、取消后保留进度和完整文件 SHA-256 校验。不会后台轮询、自动下载、执行、安装或替换正在运行的便携版。
- 新增隔离的 Cloudflare Worker `clawd-updates` 与专用子域 `clawd-updates.chronokalamos.com` 配置；GitHub Release 保持唯一发布源，不使用 R2，不修改其他 Worker、DNS 记录或路由。普通全球边缘网络不承诺中国大陆全运营商可达。
- 修复 QA 脚本的个人目录依赖和缺失证据清单，新增 Windows GitHub Actions 构建/测试工作流。

## 验证

- `npm run check`：通过。
- `npm test`：34 项通过。
- `python -m unittest discover -s tests`：4 项通过。
- `npm run build`：本机 Windows 构建与 C# 探针编译通过。
- `Clawd-1.1.0-windows-x64.exe`：本地 Windows x64 portable 构建为 99,961,650 bytes（约 95.3 MiB）；SHA-256：`6259cba20101cc2b7b7c98fd72e28c73e36f051ea8f16e73d4e3c693ef8bcbb4`。
- 本地 `SHA256SUMS.txt` 同时覆盖 Windows EXE、Codex V2 宠物包和浅/深两张 4K 壁纸；发布资产和远端哈希须在 GitHub Release 创建后复核。
- 更新后的 portable 实际启动冒烟：通过；加载五张图集、原生探针可用，应用和便携启动器均正常退出。证据范围与限制见 `docs/architecture-audit.md`。
- Windows GitHub Actions Hosted Runner：在最终源码提交合并前必须通过；结果以 [PR #1 checks](https://github.com/LYL-Z/clawd-desktop/pull/1/checks) 为准。
- 真实游戏、多显示器、DPI、锁屏与长时间运行：本版本尚未完成目标设备验收。

## 发布范围

Windows x64 portable EXE、Codex V2 宠物图集、浅/深 4K 静态壁纸、版本化 Release notes 与 SHA-256 清单。便携程序未签名；不建议为运行程序关闭 Windows 安全保护。更新只在用户主动操作后发起，SHA-256 校验只证明与发布清单的字节一致，不等于发布者签名。发布后的 tag 和资产以 [GitHub v1.1.0 Release](https://github.com/LYL-Z/clawd-desktop/releases/tag/v1.1.0) 为准。
