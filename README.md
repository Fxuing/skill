# skill

自用的 Agent Skill 合集（Claude Code / Pi 通用）。

| 技能 | 做什么 |
|---|---|
| [`webgl-diorama`](webgl-diorama/) | 用选择题引导用户挑出画面与玩法 → 写成场景提示词 → 生成单文件 HTML 的 Three.js 3D 微缩场景 |

## 安装

把技能目录整个复制到你的技能目录，不要只拷 `SKILL.md`：

```bash
# Claude Code
cp -r webgl-diorama ~/.claude/skills/

# Pi
cp -r webgl-diorama ~/.agents/skills/
```

Windows 上同样操作，`~` 换成 `C:\Users\<你>` 即可。装好后对 Agent 说"做个 3D 微缩场景"就会被触发。

## webgl-diorama

把一个主题变成一座**微缩场景（diorama）**：镜头贴近观察的小世界，边界清晰、细节密集、处处在动、可以把玩。产出两件东西：**场景提示词**（规格书）和**单文件 HTML**（可直接双击在 Chrome 打开，零外部请求）。

| 文件 | 内容 |
|---|---|
| `SKILL.md` | 主流程：定画面 → 定玩法 → 起草并确认 → 实现 → 验收 |
| `INSPIRATION.md` | 出题规矩、选项素材库（风格载体 / 时段氛围 / 生灵 / 飘落物 / 玩法 / 时令表） |
| `PROMPT-TEMPLATE.md` | 提示词模板与逐槽填法 |
| `EXAMPLES.md` | 四条已验证的场景提示词（中秋水榭、雨后禅院、雨林鱼缸、体素工地） |
| `IMPLEMENTATION.md` | 实现指南：场景契约、防穿模契约、技法速查、性能要点 |
| `scaffold/` | 可跑的最小场景骨架「暮色池塘」，实现时复制出来改 |
| `reference/mid-autumn-moon/` | 范例提示词 1 的完整实现，只供阅读（搬技法时需要 `scaffold/three.module.min.js`） |

### 要求

- **Node.js**：构建用。`cd <场景目录> && node build.js` 会把 `src/*` 和 Three.js r160 源码拼成一个 `index.html`。
- **Chrome / Edge**：打开生成的 `index.html` 即可，不需要服务器、不需要联网。
- 可选：chrome-devtools MCP（用于自动截图、控制台报错与 FPS 验收）。

### 骨架自带什么

所有固定交互与通用系统都已实现，改场景只需要动 `src/scene.js`（或按 `build.js` 里的 `MODULES` 拆成多个模块）：

- H 键沉浸模式（UI 淡出）、F 键全屏、鼠标拖拽环视、滚轮缩放、闲置自动巡航；
- 双击拾取与涟漪、空格彩蛋包络、右下角调节面板、实时 FPS 显示；
- 解析世界模型（`groundH` / `waterSDF` / 固体登记）保证物体不穿模；
- 粒子池、飘落物、水面平面反射、HDR 辉光与丁达尔光束、时段预设插值。

## 许可

第三方组件（Three.js）的许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。技能本身由作者保留权利，未附开源许可。
