CLAWD / Codex V2 本地宠物包

此包只提供宠物描述文件与透明 WebP 图集，不包含 Windows 桌宠程序代码。实际播放和触发由 Codex 宿主决定。

将 clawd 子目录中的 pet.json 与 spritesheet.webp 放入 CODEX_HOME/pets/clawd（默认用户目录下的 .codex/pets/clawd），再在 Codex 宠物设置中手动选择。也可在本地项目中使用 scripts/install-pet.ps1；脚本会校验并备份同名目录，不替用户切换当前宠物。

acceptance.json 的 recordedAt 标记图集包构建时的结构、质量和方向验收；其中的宿主状态字段只描述该记录时间。之后用户确认 Codex Mini 已显示 Clawd 且会动；衣柜、互动菜单和四场演出属于独立 Windows 桌宠，不属于此图集包。各基础状态与方向仍未逐项在 Codex 宿主验收。

原始连续性扫描曾把向下外部腿缝列为内部孔；保留原始失败记录，再按四足形状和外部连通性分类后重跑质量脚本。没有改图、修改 bundled 脚本或放宽阈值。部分中间角度与离散眼位步进仍有视觉警告，未宣称匀速角度插值。

更多动作预览见 exports/previews/codex-v2；视觉来源说明见 docs/element-provenance.md。此为本地 Claude / Clawd 粉丝作品，非官方发布。
