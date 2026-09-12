# FAQ

## 为什么 dshmarket 里显示「安装完成但校验失败 / 入口产物缺失」？

> **v18.0.0 起已不适用**：本包现在带 JS 包入口（`main` → `lib/index.js`，注册技能并经 `ctx.effect` 可逆注册），dshmarket 一类「只认 JS 入口」的校验器不再误报。若仍看到该校验失败，请确认安装的是 v18.0.0 及以上。

## 本包「零可执行内容」吗？

**不是，安装前请知悉信任边界**（完整版见 [`SECURITY.md`](../SECURITY.md)）：

- **包入口** `lib/index.js`：纯 ESM、零第三方依赖，只在 `apply` 期读随包 `SKILL.md` 并经 `ctx.skills.register()` 注册技能；不派生子进程、不联网、不写文件。
- **加载期 `!!js`**（`cordis.patch.yml`）：含 **3 处 `!!js` 表达式**（3 处分档 agentOptions，各自读取 `LUNHENG_*_PROVIDER/MODEL` 环境变量，未设则返回 `undefined`）。它们由 DSH 宿主进程在**加载期以完整 Node 权限**求值，发生在 agent 沙箱与审批关卡之前——**安装本包即等于允许这些表达式在每次启动时执行**。它们只使用 `process.env` 与全局 `Object.assign`（CI 红线规则 ⑭ 禁止 `getBuiltinModule`/`child_process`/`require(`/`eval(` 等标识符）。
  > v17.0.0 及更早还有第 4 处 `!!js`（技能目录路径求值，用 `baseUrl`/`URL`）；v18.0.0 改由包入口注册技能后，这处求值**已删除**，表达式面更窄。

实测技能可正常加载：`dsh --profile <profile> --dump-config` 可见本包层与三档 `tool-subagent-*` 行，新会话的技能目录能列出 `lunheng-article-pipeline`。

## 版本号为什么是 18.0.3 这种形态？

DSH 版独立维护、独立版本线，版本号不与任何外部版本线共享。**v17.0.0 起版本号 = 纯语义化版本，迭代号进 major**：

| 场景 | 版本 |
|---|---|
| 本轮迭代 | `18.0.3` |
| 上一轮迭代（未单独发布，内容随本版首发） | `17.0.0` |
| 同一轮内修补 | `18.0.3` |
| 同一轮内小步改进 | `18.1.0` |

**为什么不能写成 `dsh.17.0`**：npm 强制 [semver](https://semver.org)，`major.minor.patch` 三段必须是数字，`dsh` 只能出现在 `-`（prerelease）或 `+`（build metadata）之后——实测 `npm publish` 会直接以 `Invalid version` 拒绝。

**历史版本号** `2.5.2-dsh.N`（截至 `2.5.2-dsh.17`）沿用语义化基线 `2.5.2` + DSH 迭代后缀；换成纯 semver 是为了**去掉那个与 DSH 迭代无关的数字前缀**，同时保证单调递增（`17.0.0 > 2.5.2-dsh.17`、`18.0.0 > 17.0.0`，老用户不会看到「降版」）。

**「dsh 通道」怎么装**：`npm i lunheng-article-pipeline@dsh`（dist-tag `dsh` 始终指向最新 DSH 迭代版）。

## 封面为什么没有文生图？

DSH 无内置图像生成工具，封面降级为 SVG 矢量风（本地，程序化）或主人投喂图片。

## 为什么 T3 案例检索员「任何量级必 spawn」？

为保证三角验证可审计——即使主题「无需案例」，T3 也会显式产出 [C-空] 空卡声明无案例需求，避免留下「到底查没查案例」的模糊地带（教训 #56）。
