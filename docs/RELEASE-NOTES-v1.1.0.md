# Clawd 1.1.0

本版本在 1.0.1 基础上增量完善 Windows 场景识别、设置体验和可复现交付；保留现有陶土像素角色、图集、造型、动作、演出、物理和本地任务状态桥。

## 主要变化

- 以原因集合统一游戏、全屏、手动隐藏、Windows 锁屏与系统挂起的可见性仲裁。
- 原生探针输出版本化 JSON，支持用户显式添加 EXE 的完整路径/文件名规则、进程运行状态、心跳监测和退避重启。
- 新增桌面设置中心、衣柜画布预览、场景模式、游戏/例外规则编辑和托盘状态提示。
- 旧设置文件可迁移；配置损坏时先备份，保存采用串行队列和临时文件替换。
- 宠物隐藏时停止动画帧与鼠标命中更新；设置预览在窗口隐藏时暂停。
- 设置页增加手动版本检查。仅点击时访问 GitHub 最新正式 Release，不进行自动下载、安装或更新。
- 修复 QA 脚本的个人目录依赖和缺失证据清单，新增 Windows GitHub Actions 构建/测试工作流。

## 验证

- `npm run check`：通过。
- `npm test`：25 项通过。
- `python -m unittest discover -s tests`：4 项通过。
- `npm run build`：本机 Windows 构建与 C# 探针编译通过。
- `release/v1.1.0/Clawd-1.1.0-windows-x64.exe`：本地 portable 候选包已生成，99,946,131 bytes（约 95.3 MiB）；SHA-256：`6fee169fd0ea3ecf9f79c88d2974bf4434869de6d4cf1d7228c375e1c960e51f`。
- portable 实际启动冒烟与打包应用动作/造型/方向/演出离线资源桌面自动化：通过；证据范围与限制见 `docs/architecture-audit.md`。
- Windows GitHub Actions Hosted Runner：待分支推送后首次运行。
- 真实游戏、多显示器、DPI、锁屏与长时间运行：本版本尚未完成目标设备验收。

## 发布范围

Windows x64 portable EXE。安装包未签名；不建议为运行程序关闭 Windows 安全保护。项目没有自动更新器。公开 Release 的 tag、EXE 与 SHA-256 只有在实际发布后才能视为可下载发布资产。
