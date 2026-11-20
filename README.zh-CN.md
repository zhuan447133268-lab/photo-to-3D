# photo-to-3d-demo

把一个产品照片集，做成**经过实测的单文件交互式 Three.js 演示页**：可拖拽旋转、点选零件、爆炸拆解、线框、自动旋转、重置视角——全部在一个 HTML 文件里，发给人就能打开。

现成的成品在 [`demo/`](demo/README.md)：双击 `demo/mdr-zx310.html` 就能看，不用装任何东西，也不用构建。
[`demo/spoked-wheel-mesh.html`](demo/README.md) 是第二条路线：把一个重建网格做成了 51 个可点选零件——
24 根辐条、24 颗铆钉都在里面。

![轨道旋转](docs/screenshots/01-orbit.png)

它是 [img2threejs](https://github.com/img2threejs/img2threejs) 的前端封装。上游做的事是：按轮次
（pass）把「按照片写出来的 spec」生成成 Three.js 工厂代码，到生成完就结束了。这个仓库补的是**交付的另一半**——
而且这另一半**拿到一个现成网格也能用**，完全不需要上游 checkout：

| 上游给的 | 这里补的 |
| --- | --- |
| 生成好的 `factory.ts` | 预览壳：拾取、选中高亮、爆炸、线框、HUD、参考图卡片 |
| 评审脚本与 spec 规范 | 证据抓帧契约（`setCamera` + 七种渲染模式） |
| 组件树 | 单文件打包器，内联 JS 与全部贴图（3–6 MB，零外部引用） |
| — | 六项交互断言，在真实浏览器里跑并产出截图 |
| — | 驱动层抽象，同一套测试既能无头跑，也能在宿主 app 里跑 |

本仓库没有复制 img2threejs 的任何代码，只是调用它的命令行工具，见 [NOTICE](NOTICE)。

## 它到底是什么（以及不是什么）

**生成器从头到尾没打开过照片。** `generate_threejs_factory.py` 读的是
`spec/object-sculpt-spec.json`，把它编译成 Three.js 基础几何体——方块、圆柱、圆锥、旋转体、挤出体。
那份 spec 里的每个数字，是 agent（或人）**看着照片**写进去的。三层的分工必须说清：

| 层 | 来源 | 读像素吗 |
| --- | --- | --- |
| 几何 | spec 里的数字 → 基础体拼装 | **不读** |
| 材质 | 裁图 → 调色板 + albedo / roughness / height / normal / ao | **读**：stage1 的提取器真的逐像素统计；demo 那 35 张贴图就是这么来的 |
| 比例与分件边界 | 人/模型拿渲染帧和照片对照着判断 | 没有求解器，也没有测量 |

所以精度上限是**基础几何体的分辨率**，不是照片的分辨率。辐条、连杆、铆钉、针织纹理、刻字，照片不会
自动变成这些——要得到它们，得同样用基础体一块块搭，而这一步就是"跑出一堆散件"的来源。

名字描述的是**输入和输出**：照片进去，可交互 3D 页面出来；中间是**按照片量出来、用基础体搭起来的装配**，
不是重建网络。要真正带拓扑的网格，得先有重建服务（混元 3D 这类，需要 GPU 服务、凭证和网络）；而重建出来的
网格一旦拿到手，本仓库就能把它交付掉——见下面的 B 路线。本技能的每次交付都要写清哪些部件是量出来的、
哪些是推出来的。

### 两条路线

上面那个上限属于 spec 编译器，不属于整条流水线。当网格已经存在时，同一套预览壳、同一棵零件树、同一份
抓帧契约、同样六项断言照用——这时几何就是重建出来的东西，辐条和铆钉都在。

| 你手上有什么 | 路线 | 命令 |
| --- | --- | --- |
| 只有照片 | **A** — 程序化 spec + 八轮评审 | `build_pass.sh` |
| 混元3D / Tripo / Meshy / 扫描仪 / DCC 导出的 GLB | **B** — 网格导入 | `build_mesh.sh` |

**B 路线不做重建**：仓库里没有神经模型，不上传任何东西，也没有 GPU 环节。网格是你带来的，流水线负责让它
可点选、可测、可单文件发出。难点在于重建出的 GLB 通常就是一整块、没有零件名，所以要先焊接再分件——先按连通
分量，大壳内部按折角切，网格是噪声时才退化成空间分块：

| 网格 | 分件方式 | 结果 |
| --- | --- | --- |
| 合并导出的 CAD 模型（互不相连的块） | 连通分量 | 一块一个零件 |
| 单个挤出壳（齿轮、支架） | 连通分量 + 折角 | 齿 / 侧壁 / 端面 |
| 神经重建（一整张带噪声的曲面） | 空间分块兜底 | 分块，并明确标成"块"而不是零件 |

实际走了哪条路，看 `window.__demo.model.userData.meshStats`。

![重建网格爆炸视图](docs/screenshots/05-mesh-wheel-explode.png)

随仓库发布的辐条轮 demo 爆炸视图：51 个零件，每一个都是文件里现成的岛。

## 交付物长什么样

```
dist/<产品名>.html            约 4 MB，离线可开，无 CDN、无同级文件
review/captures/*.png         每轮至少一张证据帧，加交互测试截图
spec/object-sculpt-spec.json  整个模型即数据：几何、材质、假设、评审历史
```

![点选零件](docs/screenshots/02-select.png)

点一个零件，只有它亮——镜像的另一半不会跟着亮，读数区打印它的组件 id、层级、材质。第一次做基本
都会在这里翻车：生成器**每个材质 id 只发一个材质实例**，左右件共用。

![爆炸视图](docs/screenshots/03-explode.png)

## 安装（每台机器一次）

```bash
git clone <本仓库> ~/photo-to-3d-demo
bash ~/photo-to-3d-demo/assets/build/bootstrap.sh --check
```

`bootstrap.sh` 会做两件事：把 `playwright-core` 装进仓库（它驱动你本机已有的 Chrome，不下载浏览器）；
在没有现成 checkout 时，把 [img2threejs](https://github.com/img2threejs/img2threejs) clone 到
`$HOME/.cache/photo-to-3d/img2threejs`。之后 `--check` 会跑一遍生成器的 `--help`，并通过驱动层真正
拉起一次浏览器——所以缺东西的机器在这里就失败，而不是做到第三轮才发现。

它检查 Node 18+、npm、git、Python 3.9+（只用标准库）和 Chrome，缺什么就直说。`three` 与 `esbuild`
**故意不**全局安装：由 `setup_workspace.sh` 按工作区固定版本，因为换一个 three 可能改变 PMREM 或
OrbitControls 的行为，把已经签过字的评审结果作废。

两个变量都可选，默认值能跑：

| 变量 | 默认解析顺序 | 什么时候要设 |
| --- | --- | --- |
| `IMG2THREEJS_ENGINE` | `build_pass.sh` 第三个参数 → `~/.workbuddy/skills/img2threejs` → `~/.cache/photo-to-3d/img2threejs` | 上游 checkout 放在别处 |
| `PYTHON` | `python3`，没有再找 `python` | 两个都不在 `PATH`，或 `python3` 低于 3.9 |

## 快速开始

还需要同一个物体的 2–4 张照片；只看 `demo/` 里的成品则什么都不用装。

```bash
bash ~/photo-to-3d-demo/assets/build/bootstrap.sh --check   # 依赖 + 引擎，一次即可
SLUG=my-product
WP=~/photo-to-3d/$SLUG

bash ~/photo-to-3d-demo/assets/build/setup_workspace.sh "$WP"
cp /path/to/photo.jpg "$WP/reference/ref.jpg"

# 阶段 1–2：按材质裁图、提取 PBR、写 spec/object-sculpt-spec.json
# 然后逐轮执行（顺序固定，一轮只解决一件事）：
bash ~/photo-to-3d-demo/assets/build/build_pass.sh "$WP" blockout
python3 -m http.server 8100 --directory "$WP/build" &

node ~/photo-to-3d-demo/assets/build/capture_frames.mjs --url http://127.0.0.1:8100/ \
  --out "$WP/review/captures" --pass-id blockout --shots silhouette,refmatch --driver playwright

# 看这张帧 → 改 spec → 记录评审 → 下一轮
ENGINE="${IMG2THREEJS_ENGINE:-$HOME/.cache/photo-to-3d/img2threejs}"
python3 "$ENGINE/forge/stage4_review/append_review.py" "$WP/spec/object-sculpt-spec.json" ...
```

打包与测试：

```bash
python3 ~/photo-to-3d-demo/assets/build/pack_single.py "$WP/build" "$WP/dist/$SLUG.html"
node ~/photo-to-3d-demo/assets/build/test_interactions.mjs --url http://127.0.0.1:8100/dist/$SLUG.html \
  --out "$WP/review/captures" --prefix single-file --driver playwright
```

断言失败时脚本以非零码退出，并把截图写在报告旁边。每一轮改什么、怎么判，见
[`SKILL.md`](SKILL.md) 与 [`references/pipeline.md`](references/pipeline.md)。

## 快速开始——B 路线：网格已经有了

不用写 spec，不用跑八轮，也不需要 img2threejs checkout：这条路只要 Node、`three`、`esbuild` 和 Python。

```bash
WP=~/photo-to-3d/my-widget
bash ~/photo-to-3d-demo/assets/build/build_mesh.sh "$WP" /path/to/model.glb --locale zh \
  --ref-photo /path/to/photo.jpg          # 可选：填上「重建输入」那张卡片

python3 ~/photo-to-3d-demo/assets/build/pack_single.py "$WP/build" "$WP/dist/widget.html" --mesh
node ~/photo-to-3d-demo/assets/build/test_interactions.mjs --url http://127.0.0.1:8100/dist/widget.html \
  --out "$WP/review/captures" --prefix mesh --driver playwright
```

构建会先焊接重复顶点（合并导出的 GLB 是非索引的三角汤，直接按索引找连通会得到"一个三角形一个零件"），再烘焙
节点变换、把曲面切成零件、把网格归一化到单位尺寸，最后把 GLB 以 base64 data URL 内嵌，保证打包后
`external_refs: []` 仍然成立。

零件树分得不对时，能动的只有这些开关——网格本身不是拿来改的：

| 现象 | 参数 |
| --- | --- |
| 只有一个零件，炸不开 | 下调 `--mesh-dihedral`，或 `--mesh-partition spatial` |
| 实心件的端面被切下来单算 | 调高 `--mesh-min-segment-triangles` |
| 碎成几千片 | 调低 `--mesh-max-parts` |
| 本来分开的块被合在一起 | `--mesh-partition components` |
| 过曝 | `--exposure`（网格模式默认 0.72） |

[`demo/fixtures/`](demo/README.md) 里放了两个可再生成的样例网格，所以网格这条路不用建模软件、不用联网也能测：
`node assets/build/make_sample_mesh.mjs` 就能重建它们。

## 八轮流程

```
blockout -> structural-pass -> form-refinement -> material-pass
         -> surface-pass -> lighting-pass -> interaction-pass -> optimization-pass
```

顺序固定，因为跳过一轮就失去归因能力：你再也说不清一处差异是几何、材质还是光照造成的。每一轮都是：
生成 → 构建 → 抓证据帧 → **看它** → 改 spec → 记录评审。不看帧、批量改参数，只会得到一堆没人能解释的差异。

**脚本不替你打分**。`append_review.py` 记录的是你看到的东西，而且拒绝在缺少层分数、缺视角清单
（必须含 `long-axis` 与 `thickness-axis`）、或引用了不存在的截图文件时记录。分数可以低，不能不给。

## 目录

```
SKILL.md                    给 agent 的操作流程，以及什么时候该拒绝接活
plugin.json                 插件清单（schema 1）
demo/                       一个打包好的成品，不用构建就能打开
docs/screenshots/           README 里那五张帧，由浏览器实测截取
references/
  pipeline.md               每一轮改什么、看什么
  traps.md                  31 条 症状 → 原因 → 修法，全部来自真实交付
  review-cli.md             append_review.py 的参数集与硬规则
  browser-run.md            两种驱动、抓帧预设、emitImage
assets/build/
  bootstrap.sh              依赖检查 + clone 引擎 + 真拉一次浏览器（--check）
  setup_workspace.sh        建目录 + 固定 three@0.169.0 / esbuild@0.24.0
  build_pass.sh             A 路线：生成工厂 → 拷贴图 → 打包
  build_mesh.sh             B 路线：内嵌 GLB → 生成 mesh_rig + 预览壳 → 打包
  make_sample_mesh.mjs      不用建模软件就能重建 demo/fixtures/*.glb
  pack_single.py            内联 JS 与全部贴图，并校验零外部引用
  browser.mjs               与后端无关的页面操作助手
  capture_frames.mjs        七种抓帧预设
  test_interactions.mjs     六项断言 + 截图
assets/viewer/
  index.template.html       页面（中英双语）
  main.template.ts          拾取、高亮、爆炸、线框、HUD、抓帧钩子
  render_viewer.py          填模板：工厂模式读导出名，网格模式读 GLB
  mesh_rig.ts               B 路线：加载、焊接、分件、默认灯光/环境/控制器
drivers/
  playwright.mjs            自己拉起 Chrome，任何环境可用
  zcode.mjs                 用宿主 app 的浏览器桥
  index.mjs                 调度器（--driver / DEMO_DRIVER）
demo/
  fixtures/spoked-wheel.glb, gear.glb   网格路线的样例，源码可重建
```

`build/` 与 `dist/` 不进仓库，`setup_workspace.sh` 会把它们放在仓库之外。

## 浏览器实测

六项断言，全部是测出来的，不是假设的：

1. 拖拽后相机位置发生变化
2. 点击后读数区有内容，且**只有被点的那一个网格**被点亮
3. 点空白处会取消选中（否则残留的高亮会让后面每一张证据帧都带一块蓝色）
4. 爆炸把零件移开了非零距离，且相机自动后退把拆开的装配留在画面内
5. 线框覆盖 100% 的网格
6. 自动旋转开启时方位角推进、关闭时保持不动

![线框](docs/screenshots/04-wireframe.png)

两种驱动都能跑：`--driver playwright` 自己拉起 Chrome（不需要 app 会话），`--driver zcode` 用宿主
应用的浏览器桥。两者共用同一套标签页接口，所以断言完全相同。启动代码与三个坑（合成器截图超时、
OrbitControls 阻尼尾巴、冷启动开标签页）在 `references/browser-run.md`。

## 什么时候别用

- 有机形态（人脸、布料褶皱、毛发、植物）：走扫描或常规建模。
- 需要加工、维修、尺寸准确的：这是视觉重建，不是 CAD 模型。
- 玻璃、镜面占比高的物体：从照片提取的贴图会明显劣化。
- 用户只是想要一张"看起来像 3D 的图"：短视频更快。
- 用户要的是**重建出来的网格**（辐条、连杆、铆钉、真实拓扑），但手上还没有网格：那是神经重建服务，不是 spec
  编译器。网格一旦有了，走 B 路线就能交付。

## 许可

Apache-2.0，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。与 img2threejs、任何作为测试对象的品牌、
Three.js 官方均无隶属关系。