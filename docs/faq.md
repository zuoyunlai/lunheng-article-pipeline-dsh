# FAQ

## 为什么 dshmarket 里显示「安装完成但校验失败 / 入口产物缺失」？

这是 dshmarket 的**误报**。它的校验器只认 JS 入口（`main` / `exports` / 兜底 `index.js`），而本插件的入口是 `package.json` 里 `dsh.bundle.patch` 指向的 YAML 补丁 `cordis.patch.yml`——本包**不含 JS 模块入口**（无 `main`/`exports`），因此该校验器会误判。

> ⚠️ **如实披露（v2.5.2-dsh.13 修订）**：本包**并非「零可执行内容」**——`cordis.patch.yml` 含 **7 处 `!!js` 表达式**（1 处路径求值 + 6 处读取 `LUNHENG_*_PROVIDER/MODEL` 环境变量）。这些表达式由 DSH 宿主进程在**加载期以完整 Node 权限**求值，发生在 agent 沙箱与审批关卡之前——**安装本包即等于允许这些表达式在每次启动时执行**。它们只使用 `process.env` / `baseUrl` / 全局 `URL`（CI 有红线规则禁止 `getBuiltinModule`/`child_process`/`require(`/`eval(` 等标识符），但安装者应当知悉这一信任边界。

实测技能可正常加载（`dsh --dump-config` 可见 `skill-filesystem-lunheng` 行，headless 会话技能目录能列出本技能）。

## 版本号为什么是 17.0.0 这种形态？

DSH 版独立维护、独立版本线，版本号不与任何外部版本线共享。**v17.0.0 起版本号 = 纯语义化版本，迭代号进 major**：

| 场景 | 版本 |
|---|---|
| 本轮迭代 | `17.0.0` |
| 下一轮迭代 | `18.0.0` |
| 同一轮内修补 | `17.0.1` |
| 同一轮内小步改进 | `17.1.0` |

**为什么不能写成 `dsh.17.0`**：npm 强制 [semver](https://semver.org)，`major.minor.patch` 三段必须是数字，`dsh` 只能出现在 `-`（prerelease）或 `+`（build metadata）之后——实测 `npm publish` 会直接以 `Invalid version` 拒绝。

**历史版本号** `2.5.2-dsh.N`（截至 `2.5.2-dsh.17`）沿用语义化基线 `2.5.2` + DSH 迭代后缀；换成纯 semver 是为了**去掉那个与 DSH 迭代无关的数字前缀**，同时保证单调递增（`17.0.0 > 2.5.2-dsh.17`，老用户不会看到「降版」）。

**「dsh 通道」怎么装**：`npm i lunheng-article-pipeline@dsh`（dist-tag `dsh` 始终指向最新 DSH 迭代版）。

## 封面为什么没有文生图？

DSH 无内置图像生成工具，封面降级为 SVG 矢量风（本地，程序化）或主人投喂图片。

## 为什么 T3 案例检索员「任何量级必 spawn」？

为保证三角验证可审计——即使主题「无需案例」，T3 也会显式产出 [C-空] 空卡声明无案例需求，避免留下「到底查没查案例」的模糊地带（教训 #56）。
