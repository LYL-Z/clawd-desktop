# Clawd Desktop 1.0.1

状态：已发布  
发布日期：2026-10-18  
目标平台：Windows x64 portable；另含 Codex 宠物资源包  
源码标签：`v1.0.1` 指向 `1a2c12a97ae6cca440ef1eabe3b3b8d70fb1cd10`。该 Release 没有发布构建 manifest，因此不能仅凭标签断言每个二进制都由该提交构建。

## 新增

- 公开仓库首次提供当前源码快照及重新打包的 Windows x64 便携程序。
- 附带 `Clawd-Codex-V2.zip`。宠物动画由 Codex 宿主控制；该包不会向 Codex Mini 添加独立 Windows 程序的衣柜或互动菜单。
- 同一 Release 还保留一个名为 1.0.0 的历史二进制；它不是由 1.0.1 源码构建。

## 调整

- 本 Release 将 1.0.1 作为公开仓库中当前源码与支持构建的版本。
- 由于没有可用的 1.0.0 原始源码快照，无法对两个版本逐项比较；本说明不推断未记录的功能变化。

## 修复与回归保护

- 原 Release 说明没有列出可核实的单项缺陷修复或回归测试映射，因此不对 1.0.1 作未记录的修复承诺。

## 安全与隐私

- Windows 程序未进行代码签名；SHA-256 用于检查文件完整性，不认证发布者身份。
- 这是非官方 Claude / Clawd 粉丝项目，不代表 Anthropic 或 OpenAI。仓库没有授予通用开源或商业再利用许可，第三方名称与素材归各自权利人所有。

## 兼容性与升级

- Windows x64 便携程序，无安装向导。Release 未记录设置迁移或自动升级；运行新版前应保留旧文件并自行备份重要数据。回退时可重新运行先前保留的便携程序。
- Codex V2 包受宿主支持范围约束；它不会提供独立 Windows 程序的菜单功能。
- 不要把历史 1.0.0 二进制作为受支持回退目标：其源码与构建环境无法从当前仓库复核。

## 验证范围

- Release 说明记录：`npm run check`、8 项 Node 测试、4 项 Python 回归测试通过；Windows 包使用 Electron 44.7.2 和 electron-builder 26.15.3 构建。
- Release 没有记录精确 SHA 的 Windows CI 结论、跨设备验收或长时间稳定性测试；这些项目不在本版本的已验证范围内。

## 已知限制

- 发布程序未签名，Windows 可能显示未知发布者提示。
- 本版本的公开说明没有提供可与 1.0.0 源码逐行比较的基线，也没有记录全面的设备兼容性或长稳结果。
- 1.0.0 历史二进制的原始源码快照不可用，无法核实其完整功能、修复和构建环境。详见[1.0.0 历史二进制说明](RELEASE-NOTES-v1.0.0.md)。

## 发布文件与校验

以下大小和摘要来自当前公开 v1.0.1 Release 的资产记录。`SHA256SUMS.txt` 列出三个下载文件；下表中的摘要也包含校验文件本身的摘要。

| 文件 | 类型 | 大小（bytes） | SHA-256 |
| --- | --- | ---: | --- |
| `Clawd-1.0.1-windows-x64.exe` | Windows x64 portable | 99,910,606 | `f5fa38aa6fb15f749bf1dd62975d87a7ca5fecbc550d49df05ed455da459b31c` |
| `Clawd-1.0.0-windows-x64.exe` | 历史 Windows 二进制 | 99,910,786 | `562c25bd224c699aec86f867c60ee436f2f0be4b2c065e00df1d807e92931405` |
| `Clawd-Codex-V2.zip` | Codex 宠物资源 | 27,890 | `a7946c582545ef613189ae5eb9fdcb390ddd0e88a12f37fd16482b8e77cbe625` |
| `SHA256SUMS.txt` | 校验清单 | 329 | `53ffb660d2e9b1322769eeb2407b4fd56c07ba993231900b0c89e4c7f0d1fcaa` |

## 构建溯源

源码标签 `v1.0.1` 的提交为 `1a2c12a97ae6cca440ef1eabe3b3b8d70fb1cd10`。Release 正文称便携程序是从当时公开源码重新打包；但由于没有随包 manifest，不能把该提交与二进制摘要建立更强的构建证明。历史 1.0.0 二进制不属于该源码标签。

## 分发与回退

正式下载来源为[公开 v1.0.1 Release](https://github.com/LYL-Z/clawd-desktop/releases/tag/v1.0.1)。下载后可用 `SHA256SUMS.txt` 核对文件完整性。该版本不提供安装器或自动替换程序的更新器；回退仅指重新运行用户自行保留的较早便携文件。
