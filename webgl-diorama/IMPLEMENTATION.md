# 实现指南

## 骨架

`scaffold/` 是一个能直接跑的最小场景「暮色池塘」，包含全部固定交互和通用系统。复制出来后按下表改：

| 文件 | 内容 | 改法 |
|---|---|---|
| `build.js` | 把 `src/*` 和 `three.module.min.js`（r160）拼成零外部请求的 `index.html` | 新模块加进 `MODULES`，放在 `main` 之前 |
| `src/head.html` | 页面结构、HUD 与面板样式 | 换标题、副标题、按键说明、加载文案；按主题调 `:root` 配色 |
| `src/core.js` | 数学、噪声、过程贴图、几何合并、渲染器、世界模型、共享 uniform 与 GLSL、灯光 | 只重写 "world model — REPLACE PER SCENE" 一段 |
| `src/fx.js` | 粒子池、飘落物（drifters）、空格彩蛋包络、HDR 后期 | 通常不动 |
| `src/water.js` | 平面反射水面 | 有水调用 `buildWater()`，无水不调用 |
| `src/main.js` | 相机、拾取、HUD、主循环、分步加载 | 不动；文件头写着场景契约 |
| `src/scene.js` | 示例场景 | 整个替换；变大后拆成多个模块 |

所有模块按 `MODULES` 顺序拼进同一个 `<script type="module">`，共享一个作用域：后面的模块直接使用前面声明的名字，不写 import / export。提示词里"Three.js r160 CDN"与"不引用任何外部资源"就是这样同时成立的——r160 源码内联进了 HTML。

## 场景契约

scene 模块定义 `SCENE`、`PANEL`、`BUILD_STEPS`、`UPDATERS`、`INTERACT`、`PICK_VOLUMES`，字段说明在 `main.js` 文件头，`scene.js` 里每一项都有能跑的写法。容易踩的点：

- `SCENE.burstName` 用四字名（"嫦娥奔月"），长了彩蛋按钮会折行。
- `SCENE.cam` 是默认机位，视觉中心要占住画面主体。机位偏远是最常见的毛病，截图验收时一起调 `dist`。
- 无水场景：保留 `POND` 和 `waterSDF` 的声明（`waterSDF` 恒返回正数即可），`fx.js` 与 `water.js` 引用了它们；并让 `groundH` 处处 ≥ 0——`surfaceAt` 把低于 0 的地面当作水面。

## 防穿模契约

穿模来自"几何体一套、运动约束另一套"。骨架只用一套**解析世界模型**：几何体从它生成，所有运动都受它约束。

1. 地形 `groundH(x,z)`，水域 `waterSDF(x,z)`（< 0 为水内，水面 y = 0），全部内容在 `WORLD_R` 半径内。
2. 每个能让东西落脚的顶面都登记为固体：`discSolid` / `boxSolid` / `ellSolid`；立在水里的东西（石头、桥墩、茎）同时登记进 `waterObstacles`。
3. 登记在 `BUILD_STEPS` 里完成——它们跑完后 `bakeSurface()` 才把一切烘进 0.1 m 网格。
4. 会动的东西按类型找约束入口：
   - 粒子、飘落物、相机、双击拾取：`surfaceFast(x,z)`（烘焙表，O(1)）
   - 水中游动：`waterFree` 选点，`constrainWater` 推回
   - 站立的生灵：放在 `surfaceAt(x,z)` 上，动作只向上（跳起、抬头）
5. 散布物体用 `scatter()`：互不重叠，也避开地标。
6. 体素场景同理：高度网格就是 `groundH`，每堆方块的顶面登记为 `boxSolid`。

## 技法速查

写提示词时用"提示词写法"一列的说法；实现时从"做法"一列入手。标"参考"的指 `reference/mid-autumn-moon/src/` 下的文件。

| 提示词写法 | 做法 |
|---|---|
| 水面倒影（Planar Reflection Shader） | `buildWater()`：镜像相机 + 斜裁剪面、菲涅尔（IOR 1.33）、光路闪烁 |
| 涟漪（Ripples Shader） | `addRipple(x, z, amp)`；自定义着色器拼入 `GLSL_RIPPLE`；漂浮物用 `ripplePush` 被推开 |
| 飘落、漂浮的花瓣 / 落叶 / 雪花 | `makeDrifters` / `spawnDrifter` / `updateDrifters`：落下 → 水上漂或地上停 → 淡出 |
| 水花、火花、萤火、光尘、雨滴 | `makePool` + `emit`（kind 0 火花 / 1 水滴 / 2 漂浮光点）；`splashAt` |
| 植物随风摇曳 | `windMaterial(mat, flutter)`；CPU 端对应 `windAt` |
| 丁达尔光束（God Rays） | `POST.rayDir` 设为亮光源方向，天空在该方向画出 HDR 亮盘 |
| 辉光（Bloom） | 自动：颜色或 emissive 超过 1 的部分发光 |
| 灯笼、烛光等暖色点光 | `PointLight` 加入 `LAMPS`，每帧同步到 `G.uLampPos` / `G.uLampCol`（自定义着色器最多 3 盏） |
| 时段色温 / 天气切换 | `PRESETS` + 每帧阻尼插值，见 `scene.js` `updatePresets` |
| 天空、远山、太阳 | `scene.js` `buildSky`：天空球跟随渲染它的相机，倒影里同样正确 |
| 巨型满月、月晕（Moon Halo Shader）、星空、薄云 | 参考 `sky.js` |
| 环境反射 | `scene.js` `buildEnvironment`：小环境场景 → PMREM |
| 毛发、次表面散射（SSS） | 简版：`MeshPhysicalMaterial` 的 sheen（`scene.js` 生灵）；精细版：毛发壳层 + 包裹光照，参考 `rabbit.js` |
| 生灵微动作（眨眼、转耳、呼吸、好奇张望） | `scene.js` `updateCritter` / `critterLookAt` |
| 鱼群游动；群聚（Flocking/Boids） | 参考 `life.js` 金鱼；群聚在其上加分离、对齐、聚拢三力，每步用 `constrainWater` 约束 |
| 荷叶、荷花 | 参考 `life.js` |
| 亭台、翘角飞檐 | 参考 `pavilion.js` |
| 石拱桥、踏步石、草地、白墙 | 参考 `garden.js` |
| 满树花叶与花簇 | 参考 `tree.js`；简版见 `scene.js` `buildTree` |
| 水面薄雾 | 参考 `fx.js` `buildMist` |
| 超白玻璃（IOR 1.52） | 自写：`MeshPhysicalMaterial` 的 `transmission` / `ior` / `thickness` |
| 焦散（Caustics Shader） | 自写：`onBeforeCompile` 给材质叠加按世界 xz 采样的动态焦散纹理 |
| 雨后湿润（Wetness Shader） | 自写：随天气预设降低 roughness、压暗 albedo |
| 体素方块 | 自写：`BoxGeometry` + `InstancedMesh`，逐实例颜色 `setColorAt` |

参考实现早于骨架，命名不同（`uGold` ↔ `uBurst`、`MOON_DIR` ↔ `SUN_DIR`），搬技法时改成骨架的命名。它只供阅读；要构建它，先把 `scaffold/three.module.min.js` 复制进去。

## 性能

骨架已经做了：像素比上限 1.5、2048 阴影图每帧只更新一次、倒影半分辨率渲染、首帧前 `renderer.compile` 预编译全部着色器、HUD 实时显示 FPS。新增内容时保持：

- 同一种东西超过十几个就用 `InstancedMesh`；静态零件用 `mergeGeos` 合成一个网格。
- 只让主光投影；点光一律不开阴影。
- 每帧逻辑里复用模块级临时向量，不 `new` 对象。
- 粒子控制在几千以内；大片半透明面片换成小点精灵。

FPS 不达标时依次排查：独立网格太多（该实例化、该合并的没做）→ 半透明叠加 → 每帧 CPU 循环 → 投影物数量。
