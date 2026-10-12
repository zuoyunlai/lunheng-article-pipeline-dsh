# 反哺报告：`sjkncs/dsh-research` 对比结论的逐项核实与修订

> 版本：v18.96.0｜**读者**：主人 / 维护者
> **本文件是改进动议，不是机制文件改动**。按 `SKILL.md` §执行能力边界「机制文件写保护」条与 `AGENTS.md` 同名条：`SKILL.md` / `AGENTS.md` / `references/**` / `scripts/**` / `cordis.patch.yml` 任何角色不得用 write/edit 改动；本报告只出**动议 + 可机械 apply 的修订文案 + 验收判据**，实际落地由主人在 host shell 执行（五步安全流程见 `references/maintainers.md` §十四）。
> **上游材料**：`E:\HERNESS\_inspect\dsh-research\`（GitHub `sjkncs/dsh-research` master 全量 49 个文本文件副本）+ `E:\HERNESS\_inspect\dsh-research\对比报告-dsh-research-vs-论衡.md`（第一轮对比报告，下称「一轮报告」）。
> **核实基准**：本机真源仓库 `E:\HERNESS\lunheng-article-pipeline-dsh`（`package.json` version = `18.96.0`，HEAD = `fa1a4981`）+ 本机 pnpm store 内的官方 DSH 包（`node_modules\.pnpm\@deepseek-ai\*`，`dsh 0.1.2-rc.1` / `cordis 4.0.4`）。

---

## 0. 结论摘要（先读这段）

一轮报告共提出 **5 条可借鉴项 + 若干事实断言**。逐条核实后：

| # | 一轮报告的提法 | 核实结论 | 处置 |
|---|---|---|---|
| 1 | 补 L4 preset 层，用 `customSkillDirs` + `baseUrl` 相对携带技能 | **部分成立，且写法必须修正** | 采纳但**改写法**：`customSkillDirs` 这条路对「任意 cwd」不成立，只有 `baseUrl` 那条成立 |
| 2 | 交互式工作台范式 | **成立**，但客户端依赖不可照抄 | 采纳，落法要改（见 §4.2） |
| 3 | 措辞/外观机械红线扫描 | **成立**，且比一轮报告说的更有价值 | 采纳，并可升级为「跨文档对账门」（本报告已抓到现行缺口，见 §3.1） |
| 4 | 面板接宿主 `locale` | **成立**，依赖可用 | 采纳 |
| 5 | `DESIGN.md` 式设计基准 | **成立**（论衡确实没有独立设计基准文件） | 采纳 |

本轮核实**另发现 3 条一轮报告没发现的问题**，其中 1 条是现行文档冲突（P1）、2 条是规则缺口：

- **N1（P1 文档一致性）**：`cordis.patch.yml:37` 与 `SECURITY.md:29` 声称 `!!js`「只允许 `process.env.*` 与全局 `Object.assign`」「不再需要 `baseUrl`/`URL`」；但**规则 ⑭ 的实现**（唯一真源）**明确允许** `baseUrl` 与 `URL`，且 `references/_shared/模型路由.md:10` 也写「只能取 `process.env` 与 `baseUrl`」。**同一事实三处表述，两处与实现冲突**（详见 §3.1）。
- **N2（规则缺口）**：`consistency-check.mjs` 现行 30+ 条规则**不覆盖** `cordis.patch.yml` 注释 ↔ `SECURITY.md` ↔ 规则实现之间的执行面表述对账。本轮实测 `consistency-check` **exit 0 / 87 个 .md / 0 处漂移**，即 N1 是一处**假绿**。
- **N3（事实误植）**：一轮报告写论衡「有 4 个只读工具」——数字对（`lib/tools.js` 4 个），但一轮报告同时把 dsh-research 的「最小工具面」与论衡的「三档 subagent 工具数」并排比较时，**没有指出论衡的分档工具默认不装载**（`cordis.patch.yml:59`），即「工具数恒为 29」是**显式开启后**的实测值，不是默认态。该口径在 `examples/preset/README.md:24-27` 有明确说明，一轮报告未读该文件。

---

## 1. 本轮核实方法（可复现）

| 材料 | 取得方式 | 用途 |
|---|---|---|
| `sjkncs/dsh-research` 全量 | GitHub REST API 取 tree（73 项）→ `contents`/raw API 下载 49 个文本文件（3 个 dotfile 走 contents API，raw 被网络挡） | 一轮报告的事实来源，本轮逐条回查行号 |
| 官方 DSH 实现 | 本机 `node_modules\.pnpm\@deepseek-ai\*`（含 `cordis-plugin-loader` / `cordis-plugin-include` / `dsh-agent-presets` / `dsh-skill-filesystem`） | 裁定「写法是否被官方支持」——这是本轮相对一轮报告的关键增量 |
| 论衡真源仓库 | `E:\HERNESS\lunheng-article-pipeline-dsh`（含 `tests/` 与仓库门，符合 `AGENTS.md` 第 5 条「实现与测试同居的目录才是真源」） | 核实论衡侧现状 |
| 论衡自家门 | 实跑 `node skills/lunheng-article-pipeline/scripts/consistency-check.mjs` | 验证「现行门能不能抓到 N1」 |

**未做**：未改动任何机制文件；未跑 `m-gate-check` / `handoff-check`（本轮不产项目）；未对 dsh-research 做真机安装验证（其声明的 `dsh 0.1.1-rc.2` 与本机 `0.2.0-rc.2` 不匹配，见 §3.3）。

**独立复核**：本轮另派一名**不共享本文结论**的核实员，在真机上独立求证 5 条关键断言（`!!js` 求值域、`customSkillDirs` 路径语义、rank 值、`examples/preset` 是否含 `agent.cordis.yml`、官方 preset 写法同构性）。复核结果：**4 条与我方结论一致；1 条（断言 1）结论同向并补上我方的缺环**——`mount.js:349` `const config = { path: pathToFileURL(preset.path).href }`。核查员同时把 rank 250 的判断说得比本文更重（其原文：「官方子系统契约内不公布此值，**论衡自己为 `RUNTIME_RANK = 250` 编造了来源标注**」）；本文 §4.1(c) 采用**中性表述 + 证据并列**，理由见该处脚注——但两方在「250 无官方依据」这一事实认定上一致。

---

## 2. 一轮报告事实断言逐条核实

记法：✅ 成立 ｜ ⚠️ 部分成立/需修正 ｜ ❌ 不成立

### 2.1 dsh-research 侧

| 断言 | 结论 | 证据 |
|---|---|---|
| 五层装配（Host/Profile/Plugin/Preset/Skill） | ✅ | `scripts/setup.mjs:44-80`（4 步安装）；`presets/research/agent.cordis.yml`（101 行）为 preset 平面 |
| host 半边不注册工具/技能，只挂两条读 YAML 路由 + mkdir | ✅ | `packages/dsh-research-agent/src/index.ts:16`（`inject = ['webServer','agentPresets']`）、`:30-33`（两条路由）、`:60-63`（mkdir）；全文件无 `ctx.skills` / `ctx.tools` |
| preset 用 `customSkillDirs` + `baseUrl` 携带技能 | ✅ 写法确实如此 | `presets/research/agent.cordis.yml:53-57`：`customSkillDirs: [!!js "…fileURLToPath(new URL('skills/', baseUrl))"]` |
| 最小工具面显式裁剪 subagent/workflow/plan-mode/goal/jobs | ✅ | `tests/preset.test.mjs:17` `FORBIDDEN_SERVICES`；`agent.cordis.yml` 全文无这些行 |
| 客户端是 esbuild 构建的 TS/TSX，注册 4 个槽 | ✅ | `build.mjs:34-45`；`src/client/index.tsx:263-288`（`conversation.input.dock` / `settings.general.item` / `sidebar.footer.action` / `shell.overlay`） |
| 工作台 5 模块 × 状态流 × 每模块 2 动作，数据只存 localStorage | ✅ | `src/client/workbench-config.ts:57-233`；`workbench.tsx:243-265`（导入导出 JSON）；`:200-206` 用 `createSnapshotStore(..., {persist:{name:…}})` |
| 测试是契约不变量测试（措辞/emoji/双语键/资源存在） | ✅ | `tests/policy.test.mjs:35-58`；`tests/site.test.mjs:28-33,60-67` |
| CI 三平台矩阵 + `node --check` | ✅ | `.github/workflows/ci.yml:18`（os matrix）、`:36-41`（syntax check） |
| 硬编码 `E:\DeepSeek harness\科研工作台` | ✅ 且本机目录不存在 | `src/index.ts:28`、`src/client/cards.ts:52`；本轮实测 `Test-Path 'E:\DeepSeek harness'` = `False` |
| 客户端依赖 `createSnapshotStore` 与 `connection` 服务 | ✅ | `src/client/index.tsx:10`（import）、`:22`（`inject` 含 `'connection'`、`'workspaces'`） |

### 2.2 一轮报告对论衡的描述

| 断言 | 结论 | 证据 |
|---|---|---|
| 196 文件 / 3.65 MB | ✅ | 实测 `Get-ChildItem -Recurse -File \| Measure-Object` = 196 / 3,651,490 字节（口径 = **已装包** `~/.dsh/profiles/desktop/node_modules/lunheng-article-pipeline`，非真源仓库；真源仓库另含 `tests/` / `audits/` / `docs/` 等，文件数不同） |
| host 半边 `inject=['skills']` 仅此一项 | ✅ | `lib/index.js:25` |
| `ctx.skills.register()` 注册 2 个技能（主 + `lunheng-commands`） | ✅ | `lib/index.js:276`、`:296`；`resourceBase` 在 `:284` / `:304` |
| 4 个只读工具 + 显式登记旗标缺口 | ✅ | `lib/tools.js` 的 `TOOL_FACE_FLAG_GAPS`；`SKILL.md:55` 列名 |
| 面板 `/lunheng-panel` prefix，5 个只读 GET + SSE | ✅ | `lib/panel.mjs:36`（常量）、`:494`（OPTIONS→204）、`:495`（非 GET/HEAD→405）、`:496/532/538/547`（`/ping` `/projects` `/snapshot` `/events`）、`:497`（`/file`）；`lib/client.js:764`（EventSource） |
| 客户端手写 lazy-CJS、零构建链、只 `require('react')` | ✅ | `lib/client.js:6-9`、`:17-19` |
| 注册 `sidebar.panellist` + `main`（+ 可选右栏） | ✅ | `lib/client.js:1146-1151`、`:1163-1178` |
| 主题零颜色字面量、只用 `--dsw-alias-*`、明暗交宿主 | ✅ | `lib/client.js:36-38` 注释 + `T()` 取 token 带浅色兜底 |
| 「每个会话工具数恒为 29」 | ⚠️ **需限定** | `cordis.patch.yml:57` 原文是「实测**工具数恒为 29**」，但这是**三档装载时**的值；`:59` 明确「未设任何 `LUNHENG_*` → 三行不装载（默认零成本）」。一轮报告未给出该限定，也未读 `examples/preset/README.md:24-27`（同一说明） |

### 2.3 跨项目可比性

| 断言 | 结论 | 更正 |
|---|---|---|
| 论衡 peer 声明 `>=0.1.2-rc.1 <0.2.0`；本机 `dsh 0.2.0-rc.2` 超出 | ✅ | `package.json` peerDependencies 段；`dsh --version` = `0.2.0-rc.2` |
| dsh-research 锁 `0.1.1-rc.2` | ⚠️ 事实对，**表述位置须改** | 该版本号在 `scripts/setup.mjs:13`（`DSH_VERSION`）与 `site/data/snapshot.json:6`，**不在 package.json**——一轮报告写「dsh-research 锁 0.1.1-rc.2」未给位置，读者会去 package.json 找不到 |
| **一处行号/路径误植** | ❌ | 一轮报告 §3 末行写「`src/index.ts:28`」——真实路径是 `packages/dsh-research-agent/src/index.ts:28`。根目录不存在 `src/` |
| 拼写 | ❌ | 一轮报告末段出现「論衡」繁体混用（应为「论衡」） |
| 未发现的重要差异 | ⚠️ **遗漏** | 一轮报告未指出：dsh-research 的 preset 是**官方意义上的真 preset**（目录含 `agent.cordis.yml`，`dsh-agent-presets/lib/types/discovery.js:35` `COMPOSITION_FILE = 'agent.cordis.yml'`）；而论衡 `examples/preset/` **不含** `agent.cordis.yml`（只有 `preset.yml` / `README.md` / `agent-tiered/cordis.yml`），且 `examples/preset/README.md:54` 自己声明「`preset.yml` 不是 DSH 加载的 cordis 配置——它只是给主人读的分档说明」。**「论衡有 preset 层」与「论衡没有可加载的 preset」是两件事**，一轮报告的「论衡没有 preset」结论对，但没给这个决定性证据 |

---

## 3. 本轮新发现（一轮报告未覆盖）

### 3.1 【N1｜P1 文档一致性】`!!js` 允许面的三处表述分歧，两处与实现冲突

论衡对「`!!js` 能用什么」有**四处**表述，其中**两处与规则实现冲突**：

| 出处 | 原文 | 与实现是否一致 |
|---|---|---|
| **规则 ⑭ 实现**（唯一真源）`scripts/_lib/cc-rules/docs-version-rules.mjs:155` | `const FORBIDDEN = ['getBuiltinModule','child_process','require(','import(','eval(','new Function','node:','fs.']` —— **不在该集合即允许** | — |
| 同上 `:160`（报错文案）与 `consistency-check.mjs:39`（规则目录注释） | 「`!!js` 只允许 **`process.env` / `baseUrl` / 全局 `URL`** 级取值」 | ✅ 一致 |
| `references/_shared/模型路由.md:10` | 「`!!js` **只能取 `process.env` 与 `baseUrl`**」 | ✅ 一致 |
| **`cordis.patch.yml:37`** | 「**只允许** `process.env.*`、全局 `Object.assign` 级取值（v18.0.0 起**不再需要** `baseUrl`/`URL`）」 | ❌ **与实现冲突**（`URL(` 与 `baseUrl` 均未列入 `FORBIDDEN`） |
| **`SECURITY.md:29`** | 「仅 `process.env.*` 与全局 `Object.assign`。（v18.0.0 起技能目录不再由 patch 求值挂载，故 `baseUrl` / `URL` / `decodeURIComponent` / `process.platform` **已不再需要**……）」 | ❌ **与实现冲突**（同上；且 `process.platform` 确实未被禁——`examples/preset/agent-tiered/cordis.yml` 与官方 `standard` preset 都在用 `!!js process.platform === 'win32'`） |

**为什么这是 P1 而不是措辞问题**：`cordis.patch.yml:37` 是**执行面披露**（`SECURITY.md` 同一内容的真源之一），它的职能是告诉主人「这些表达式能做什么」。**把允许面写窄**会导致两个具体后果：
1. 维护者按该句判断「论衡不可能用 `baseUrl`」，从而**否决本报告 §4.1 的采纳路径**（把一条官方支持的写法误判为违规）；
2. `process.platform` 被写成「不再需要」，但官方自带 preset（`dsh-agent-presets/presets/standard/agent.cordis.yml:46,50`）**正在用**它——这句话把官方现行写法描述成过时。

**根因**：v18.0.0 删除旧的 `skill-filesystem` 挂载行时，「本包不再需要 `baseUrl`」这个**局部事实**被写成了「`!!js` **不允许** `baseUrl`」这个**全局规则**；而规则 ⑭ 的实现从来没改过（一直是「黑名单」而非「白名单」）。这正是 `AGENTS.md`「M 门行」条点名的同一类病：**把局部事实升格为全局断言**。

**现行门为何没抓到**：`consistency-check.mjs` 有 30+ 条规则、含大量跨文档对账（版本漂移、M 门口径、脚本计数、分档映射），但**没有一条**把 `cordis.patch.yml` 的执行面注释 ↔ `SECURITY.md` 的执行面行 ↔ 规则 ⑭ 的 `FORBIDDEN` 集合做三方对账。本轮实跑 `node skills/lunheng-article-pipeline/scripts/consistency-check.mjs` → **exit 0**，「一致性自检通过：87 个 .md 文件 + cordis.patch.yml/examples/.dsh 同步，**0 处漂移**」。**这是假绿**。

### 3.2 【N2｜规则缺口】执行面表述缺一条机械对账

承接 N1：建议新增规则（编号由维护者按 `_lib/cc-rules/rule-registry.mjs` 分配，本轮不预设号），判据建议三向：

1. 从规则 ⑭ 的 `FORBIDDEN` 数组**派生**「允许面」文案的关键词集合；
2. 断言 `cordis.patch.yml` 的「执行面披露」段与 `SECURITY.md` 的「允许的表达式内容」行**出现同一组关键词**；
3. 断言两份文档中出现的关键词 ⊆ 允许面（出现 `FORBIDDEN` 中的标识符必须处于「禁止…」语境，即与非注释行检查同构）。

**注意**：这属于新增机械消费面，按 `AGENTS.md` 的教训（「改文档前先查有没有机械消费者依赖该字符串——『语义等价』不是机械面的通行证」），落地时**必须同时**改文档与规则，且先把规则写成会红的测试（`tests/scripts/consistency-check.test.mjs` 里加反例），再修文档。

### 3.3 【N3｜事实限定】论衡的「有 preset」需要一句限定

- 官方判定 preset 的依据：`dsh-agent-presets/lib/types/discovery.js:35` `export const COMPOSITION_FILE = 'agent.cordis.yml'`；同文件 `:296` 在一个目录缺少该文件时给出的诊断是「the composition file agent.cordis.yml is missing — **the directory still occupies the id**」。
- 论衡 `examples/preset/` 实际内容：`preset.yml` / `README.md` / `agent-tiered/cordis.yml` —— **无 `agent.cordis.yml`**。
- 论衡自己的表述：`examples/preset/README.md:54`「`preset.yml` 不是 DSH 加载的 cordis 配置——它**只是给主人读的分档说明**」；`:52` 标题即「preset.yml 仅是分档说明文件」。
- 因此正确说法是：**论衡有「分档安装示例目录」，没有可被 DSH 名单加载的 preset**；H6 落地的是「一份可以被复制进 preset 的 cordis 配置片段」。

> ⚠️ 附带发现（低优先）：`examples/preset/preset.yml` 与 `README.md` 都声明「`preset.yml` 只是说明」，但 `preset.yml` **位于一个叫 `preset` 的目录里、文件名也叫 preset**，且 `package.json#files` 含 `examples` → 随包发布。新主人按字面去找 preset 会被这对命名误导。建议在 `examples/preset/README.md` 顶部补一行「本目录不是 preset，是可加载配置片段的安装指南」。

---

## 4. 五条借鉴项：逐条裁定与修订后的落地判据

### 4.1 借鉴项 1｜L4 preset 层 —— **采纳，但写法必须改**

**一轮报告的建议**：「preset 可以是完整可交付物（`preset.yml` + `agent.cordis.yml` + 自带技能 + 自带 YAML 数据），`setup.mjs` 一条 `cpSync` 装好；preset 能携带技能并相对解析路径：`customSkillDirs` + `new URL('skills/', baseUrl)`。」

**核实结果：一句话里的两个机制，一个成立、一个不成立。**

**（a）`baseUrl` 那条：✅ 官方成立，且有源码级因果**

- 求值实现：`@deepseek-ai/cordis-plugin-loader` 的 `evaluate = new Function('ctx','expr','with (ctx) { return eval(expr) }')` —— `src/config/utils.ts:5-9`（`lib/index.js:233` 同构）。**`ctx` 就是该行的 loader 上下文**，故 `with (ctx)` 让 `baseUrl` 成为表达式的自由变量。
- `baseUrl` 被谁写成 preset 目录：`@deepseek-ai/cordis-plugin-include` 的 `Include` 构造函数 —— `src/index.ts:181` `this.filename = fileURLToPath(new URL(this.config.path, this.ctx.baseUrl))`、`:188` `this.ctx.baseUrl = new URL('.', pathToFileURL(this.filename)).href`。
- 该 `ctx` 就是嵌套行的求值域：同文件 `:162-166` 的注释**逐字**说明——「Tree-carrier marker… `internal/config` interpolation keeps it literal — a `!!js` expression inside a nested row's config **belongs to that row's fiber, resolving lazily in the row's own context**」。
- preset 确实走 `Include`：`@deepseek-ai/dsh-agent-presets` 的 `mount.js:40` `class PresetTree extends Include`；`mount.js:30-34` 注释「`Include` **rewrites its own context's `baseUrl` to the composition's directory**」；`mount.js:56-59`「That is right for a relative specifier — **a preset's own files travel with it**」。
- **闭合链路末环（本轮独立复核补充，我方未读到）**：`mount.js:349` `const config = { path: pathToFileURL(preset.path).href }` —— preset 文件路径就是这样交给 `Include` 的，`Include` 再据此重写 `baseUrl`。**从「preset 怎么加载」到「`baseUrl` 等于 preset 目录」全链无缺环**。
- 官方包对这套机制的产品化表述：`dsh-agent-presets/README.zh.md:52-53`（`SHIPPED_PRESET_ROOT` 注释）「the way **each preset's own skills travel inside its directory**」。

**结论**：`new URL('skills/', baseUrl)` 在 preset 平面**允许且语义正确**——`baseUrl` 指向该 preset 目录，`skills/` 随之解析。

**（b）`customSkillDirs` 那条：❌ 对「任意 cwd」不成立**

- `@deepseek-ai/dsh-skill-filesystem/lib/index.js:79`：`this.customSkillDirs = (config.customSkillDirs ?? []).map((root) => resolve(root))` —— Node 的 `path.resolve`，**相对当前进程 cwd**，不是相对 preset 目录。
- 官方文档同口径：`README.zh.md:71`「Additional local skill roots」未声明任何 base；`:54` 说明 `includeDefaultRoots: false` 的语义。
- 因此 dsh-research 的那行**真正的承载者是 `baseUrl`，不是 `customSkillDirs`**。一轮报告把两者并列为「两种可选方案」是**误导性对等**：若论衡照此只写 `customSkillDirs: ['skills']`（相对路径字符串），行为取决于 dsh 进程的 cwd，preset 换目录或被用户家目录加载即失效。

**（c）本轮发现的额外风险：rank 冲突**

若论衡**同时**保留包入口的 `ctx.skills.register()`（rank 250，`references/maintainers.md:13`）**并在 preset 里加 `customSkillDirs`**（rank 300，同表 `:14`），同名技能会**双注册**，按「低 rank 静默顶替」的既有口径由 **250 取胜**（`maintainers.md:19-20` 已论证同型情形）。带来两个后果：preset 自带的技能目录**看起来没生效**（静默），以及两处技能正文可能版本漂移。

> **注（须如实标注的不确定）**：官方 `dsh-skill-filesystem/README.zh.md:44-52` 的 rank 表**只有** 100 / 200 / 300 / 400 / 500 五档，**没有 250**。`maintainers.md:13` 的 `250 | runtime` 行是论衡自己的标注（该表头写「官方 rank 表（`docs/subsystems/skills` 子系统契约）」——把自定义行并入官方表，是**引用纪律问题**，但不影响结论方向：runtime 必须 rank 低于 custom 才可能「bundle 压过 custom」，`maintainers.md:20` 的 v18.0.5 更正段也确认「候选 rank 恒为 `RUNTIME_RANK = 250`（非 600）」。**建议**：把该行改为「（本包自注，非官方表行）」或在表下加一条注，避免读者拿修改过的官方表去对账。

**修订后的落地判据（供主人 review）**

| 项 | 内容 |
|---|---|
| 目标 | 让论衡的三档 subagent 工具从 profile 全局沉到 preset 作用域，并让 preset 自带技能/资源 |
| 前置事实 | 论衡 `examples/preset/agent-tiered/cordis.yml` 已含三档行（含 `disabled` 与 `agentOptions` 的 `!!js`），可直接作 preset 的 `agent.cordis.yml` 主体 |
| 必须做 | ① 建 `agent.cordis.yml`（否则该目录按官方口径「occupies the id」但不可加载）；② 若要在 preset 里携带技能，**只用 `baseUrl` 写法**，不要指望 `customSkillDirs` 的裸相对路径；③ **决定技能来源唯一化**——若 preset 带技能，就要么让包入口不再注册同名技能、要么接受 250 压过 300 并**在文档里写明** |
| 不可省 | 按 `AGENTS.md` 文件修改第 5 条，改动在**真源仓库**做，四道门全绿后再同步镜像 |
| 需要先验证 | `!!js` 在 **preset 平面**是否真被求值（论衡 `examples/preset/agent-tiered/cordis.yml:29-32` 已把这条列为「不确定点 3」）。**注意**：论衡自己那条不确定点问的是「preset 平面是否允许 `!!js`」——本轮已由 `mount.js` + `discovery.js` 的 `entryListSchema`（import 自 `cordis-plugin-include`）证实**允许**；但「运行时确实求值」仍建议在能起 headless 的环境做一次对照实验，因为论衡 `cordis.patch.yml:91-93` 已如实记录「本机 `--dump-config` 只打印声明行」这一观测限制 |
| 成本 | 中（新建目录 + 文档 + 门；不含改包入口） |
| 建议 | **采纳**，但把它当「作用域收窄 + 可选模型发现」的增量，不要当成「技能装载方式的替换」——后者会与现有 250 路径打架 |

### 4.2 借鉴项 2｜交互式工作台 —— **采纳，落法要改**

**成立部分**：声明式 UI 数据模型（`{key,title,icon,hint,statuses[],fields[],actions[{label,build(fields)}]}`，`workbench-config.ts:20-56`）+ 动作把字段拼成开场白塞进输入框（`:73` 等）+ 只存 localStorage + 导入导出（`workbench.tsx:243-265`）。论衡现在是**只读**面板（`panel.mjs:495` 明写「本路由是只读面」），确实缺这一半。

**须修正部分（一轮报告已提示，本轮补强证据）**：dsh-research 的客户端 `inject = ['slots','theme','connection','sessions','workspaces','locale']`（`index.tsx:22`），依赖 `createSnapshotStore`（`:10` import，来自 `@deepseek-ai/dsh-client-runtime/client`）与 `connection` / `workspaces` 服务。而本机 client Service 目录实测只有 `layout` / `locale` / `sessions` / `slots` / `theme` / `timer` / `uiWorkspace` / `workspaces` —— **无 `connection`、无 `dsh-client-runtime/client` 的注册面**；且 `workspaces` 的实测方法签名为 `create / rename / delete / archiveSession / unarchiveSession / insertSessionBefore`，**没有** `connectWorkspace` / `startSession`（那两个在 `uiWorkspace` 上）。

> **论衡为什么不受此影响**：论衡客户端 `exports.inject = []`（`lib/client.js:1187`）+ `lib/client.js:1145` 用 `ctx.inject(['slots'], …)` 只注入 slots，其余服务一律**运行时 `ctx.get()` 探测**（如 `:851` 的 `sidebarRight`）。这正是它能跨宿主版本活下来的原因——**照抄 dsh-research 的 `inject` 清单会把这个优势丢掉**。

**修订后的落地判据**

| 项 | 内容 |
|---|---|
| 目标 | 给运行面板加「开工入口」：把论衡的必填开场要素变成填空式动作 |
| 形态建议 | 模块换成 Phase 而非论文模块（定题 / 检索 / 分析 / 写作 / 审计 / 终检），动作模板预置论衡必填口径 |
| 必须做 | ① 持久化用论衡现有的裸 `localStorage` + try/catch 模式（`lib/client.js:791,805,807,821,828`）或自建 store，**不要**引入 `createSnapshotStore`；② 保持 `inject` 不扩张，新服务走 `ctx.get()` 探测 + 缺席降级 |
| 成本 | 中（手写 lazy-CJS 里加表单/状态/持久化） |
| 建议 | 采纳，作为只读面板之外的第二个入口 |

### 4.3 借鉴项 3｜措辞/外观机械红线扫描 —— **采纳，并升级**

**成立**：`tests/policy.test.mjs`（59 行）扫 `site/ presets/ scripts/ desktop/ packages/**/src` + 白名单文件，断言「禁『预览版』/『测试版』、禁 emoji 码位」；`tests/site.test.mjs:28-33` 断言 zh/en 键集合 `deepEqual`，`:60-67` 断言 HTML 引用的本地资源全部存在。

**论衡现状（本轮核实）**：论衡有 `G14 中文 AI 痕迹闸`，但那是 **LLM 推理判定**（`docs/introduction.md` 明写「零 exec」）；`repo-hygiene-check` / `consistency-check` 覆盖的是**版本/计数/结构**类机械面。**「文档宣称」与「实现/规则」的三方对账**恰好是空白——N1 就是从这个空白里漏出去的实证。

**升级后的落地判据**：见 §3.2（新增执行面三方对账规则）。

**另一条已核实的空白（本轮原列为「待核」，现已消解）**：dsh-research 的 `site.test.mjs:60-67` 断言的是 **HTML 属性型引用**（`href` / `src`）指向的本地资源存在。论衡的 `check:link` 覆盖的是**另一族**——`scripts/link-check.mjs:3-46` 自述其范围是「技能目录内 **.md 的路径型引用**」，且明确「**不解析代码块里的路径**」、解析顺序分「Markdown 链接按引用所在文件目录」「反引号裸路径按五候选根」两条通道。即：**HTML 属性引用不在 `link-check` 覆盖面内**，两族判据不重叠。是否值得补，取决于论衡是否把 HTML 当交付面——`lib/client.js` 是运行时字符串、模板经 `md2html.mjs` 生成；若 `md2html` 产出物含外链资源（CSS/图件），建议在 `md2html` 侧或 `final-check` 侧加一条同型断言（**本轮未核 `md2html.mjs` 的产物引用面，属新增待核**）。

### 4.4 借鉴项 4｜面板接宿主 `locale` —— **采纳**

**成立**：本机 client Service 目录实测含 `locale`，方法签名 `register(ns, locale, dict)` / `bind(ns)` / `getSnapshot()` / `subscribe(fn)` / `getLocale` / `setLocale` / `addLanguage`，与 dsh-research `locale.ts` 的桥接契约吻合（`locale.ts:146-162`）。

**可直接抄的两条硬经验（dsh-research 踩过的坑）**：
1. **缺席兜底**：宿主无 `locale` 服务时回退内置词典，不阻断渲染（`locale.ts:128-144`）；
2. **裸方法引用丢 `this`**：`subscribe`/`getSnapshot` 必须用闭包绑定实例，否则 `useSyncExternalStore` 会因 `listeners undefined` 失败（`locale.ts:149-154` 注释逐字记录）。

**论衡的适配**：论衡客户端是 `React.createElement` 手写风格（`lib/client.js:17-19`），无 `useSyncExternalStore` 生态，故第 2 条对论衡不适用（**不要照搬**）；第 1 条适用，且与论衡既有的「缺席降级」纪律同向（`lib/client.js:731` 的座位如实汇报、`:771-777` 的 EventSource 退化分两态）。

**成本**：低-中（现有中文字符串抽一层 `t()`）。

### 4.5 借鉴项 5｜`DESIGN.md` 式设计基准 —— **采纳**

**成立**：论衡真源仓库根实测**无** `DESIGN.md`（`Get-ChildItem -Recurse -Include 'DESIGN.md'` 仅命中 pnpm store 内的第三方文件）。而论衡客户端已积累大量样式约定，且这些约定**只活在注释里**，例如：
- `lib/client.js:36-38`：只用 `--dsw-alias-*` 语义 token、**禁颜色字面量**、**禁主题选择器**、明暗交 `ui-theme`；
- `lib/client.js:41` `T(name, fallback)`：每个 token 带浅色兜底，宿主未定义时退化为旧观感而非不可读；
- `lib/client.js:49` 的 v18.93.1 修：未显式设色的文本必须继承 `--dsw-alias-label-primary`（否则暗色下黑到看不见）。

**落地建议**：抽成 `DESIGN.md`（dsh-research 的 `DESIGN.md` 结构可作模板：色彩令牌 / 字体 / 间距标尺 / 组件 / 动效 / 响应式 / **给 AI 的禁令清单**），并把它纳入 `lib/guard.js` 的机制文件保护范围。**注意**：新增机制文件会触发 `plugin-surface-check` / `repo-hygiene-check` / 词预算门，须同批过门；`SECURITY.md:32` 的「本版 N 个」类计数声明若涉及文件数则需同步（**本轮未逐一核对该文件是否含文件计数**，属**待核**）。

---

## 5. 修订清单（可直接按序执行；全部为动议，须主人 apply）

> 每条给「改哪份 / 怎么改 / 为什么 / 验收」。所有改动按 `AGENTS.md` 文件修改操作约束：**改前 `wc -l` + `cp` 备份 → `edit` 精确匹配（禁 `sed -i`）→ 改后 `wc -l` + `diff` → 跑门**。

### R1（P1｜N1）修 `cordis.patch.yml:37` 的允许面表述

- **文件**：`cordis.patch.yml`（包根；机制文件）
- **现文（:37）**：`#   - **只允许** \`process.env.*\`、全局 \`Object.assign\` 级取值（v18.0.0 起不再需要 \`baseUrl\`/\`URL\`）；`
- **修订**：把「只允许 A」拆成「允许面 = 规则 ⑭ 的补集」与「本包当前实际用到的子集」两句，避免把局部事实写成全局规则。参考文案：
  > `#   - **规则 ⑭ 的允许面**（真源 = \`scripts/_lib/cc-rules/docs-version-rules.mjs\` 的 \`FORBIDDEN\` 补集）：未命中 \`getBuiltinModule\` / \`child_process\` / \`require(\` / \`import(\` / \`eval(\` / \`new Function\` / \`node:\` / \`fs.\` 的表达式均允许——含 \`process.env.*\`、\`baseUrl\`、全局 \`URL\`、\`process.platform\`。`
  > `#   - **本包当前实际只用到** \`process.env.*\` 与全局 \`Object.assign\`（v18.0.0 删除 skill-filesystem 挂载行后，技能路径那处 \`baseUrl\` 求值随之移除）——这是**本包的选择**，不是规则的限制。`
- **为什么**：现文与规则实现冲突，且会把官方支持的 `baseUrl` 写法误导为违规（直接影响 §4.1 的采纳判断）。
- **验收**：`node skills/lunheng-article-pipeline/scripts/consistency-check.mjs` exit 0；人工复核「允许面」与 `FORBIDDEN` 集合一致。

### R2（P1｜N1）修 `SECURITY.md:29` 的同一表述

- **文件**：`SECURITY.md`（仓库根，**不随包**）
- **现文**：「仅 `process.env.*` 与全局 `Object.assign`。（v18.0.0 起技能目录不再由 patch 求值挂载，故 `baseUrl` / `URL` / `decodeURIComponent` / `process.platform` 已不再需要——表达式面比 v17.0.0 **更窄**。）」
- **修订**：保留「本包 v18.0.0 后实际只需 env + Object.assign」这一**陈述**，删去「仅」「不再需要 `process.platform`」这类**对规则的断言**；补一句指向规则 ⑭ 真源。
- **为什么**：`SECURITY.md` 是主人读的安全面真源；把允许面写窄等于**低报**能力面——与 v18.2.6 已修过的「漏算 3 处 `disabled`」是同一类错（那次是少报，这次仍是少报方向）。
- **验收**：与 R1 文案互查一致；`no-write-check` 不涉；`SECURITY.md` 内的计数声明同步（若涉）。

### R3（P2｜N2）新增执行面三方对账规则

- **文件**：`skills/lunheng-article-pipeline/scripts/_lib/cc-rules/`（新规则文件）+ `consistency-check.mjs`（注册）+ `tests/scripts/consistency-check.test.mjs`（反例）
- **判据**：见 §3.2 三条。
- **为什么**：本轮实证该空白导致 N1 假绿（exit 0 / 0 漂移）。
- **顺序**：**先写会红的测试**，再修 R1/R2 让它转绿（防止「改完文档再补规则」时规则被写成迁就现状）。
- **验收**：新规则在 R1/R2 未做前必须 **红**；做完后 exit 0；`tests/**` 全绿。

### R4（P2｜N3）给「论衡有 preset 层」加限定

- **文件候选**：`examples/preset/README.md`（顶部补一行「本目录不是 preset，是可加载配置片段的安装指南」）；`cordis.patch.yml:133-134` 的「论衡示例预设」段名（该段是**纯注释**，`§5 标准（DSH 默认）— 论衡示例预设` 这个标题会让人以为存在 preset 行）
- **为什么**：官方判定 preset 的依据是目录内含 `agent.cordis.yml`（`discovery.js:35`），论衡该目录没有；`examples/preset/README.md:54` 自己也这么声明，但目录名 + 文件名构成误导。
- **验收**：`consistency-check` 的 `examples/` 相关规则不红；人工确认全仓再无「论衡有 preset」的无限定表述。

### R5（P2｜引用纪律）`references/maintainers.md` 的 rank 表标注来源

- **文件**：`skills/lunheng-article-pipeline/references/maintainers.md:9-17`
- **现文**：表头写「官方 rank 表（`docs/subsystems/skills` 子系统契约）」，但 250 行是论衡自注，官方 `dsh-skill-filesystem/README.zh.md:46-52` 表**只有** 100/200/300/400/500。
- **修订**：250 行加「（本包自注：`RUNTIME_RANK`，非官方表行）」或表下加注。
- **为什么**：把自注并入「官方表」会让读者拿它去与官方对账而找不到依据，属引用纪律问题。
- **验收**：`consistency-check` 的 rank 相关规则（若有）不红；`docs-facts` 类守卫不红。

### R6（P2｜可选）借鉴项落地

- 见 §4.2（工作台）、§4.4（locale）、§4.5（DESIGN.md）。三条**互不冲突**，可分批；每批按「真源仓库改 → 四道门 → 同步镜像」执行。
- **§4.1（preset 层）单独一批**，且必须先答三个问题：① 是否把技能来源唯一化；② `!!js` 在 preset 平面的运行时求值是否已在 headless 环境实测；③ 是否接受 250 压过 300 的既有口径。

---

## 6. 本轮报告自身的能力边界（如实声明）

1. **未改动任何机制文件**：本报告只出文案与判据，实际 apply 须主人在 host shell 执行。
2. **未在真机安装 dsh-research**：其声明面向 `dsh 0.1.1-rc.2`，本机为 `0.2.0-rc.2`；其客户端的 `connection` / `createSnapshotStore` 依赖在本机不存在（已实测），故「安装验证」这一步**无法在本机做**，相关结论均基于**源码 + 官方契约**推导。
3. **`!!js` 在 preset 平面的「运行时确实求值」未做对照实验**：已由源码链路（`entryListSchema` → `Include` → `PresetTree extends Include` → `mount.js:30-34,56-59`）证实**语义与允许面成立**，但「实测求值」受本机 `--dump-config` 只打印声明行的限制（论衡 `cordis.patch.yml:91-93` 已记录同一观测限制），建议在可起 headless 的环境补一次对照。
4. **原两处「待核」已在本轮消解其一**：`scripts/link-check.mjs` 的覆盖面已逐行核（结论见 §4.3，HTML 属性型引用确实不在其内）；`SECURITY.md` 已核实**不含**受 R5/R6 影响的具体文件计数（`grep '个 \.md|个 \.mjs|文件数'` → 无命中）。**新增一处待核**：`scripts/md2html.mjs` 产物是否含需存在性校验的外链资源。
5. **rank 250 的来源**：官方 README 表无此行（已核），论衡表有（已核）；但 `RUNTIME_RANK = 250` 的**出处文件**（`lib/index.js` 或 skills 注册路径代码）本轮**未逐行定位**，属**待核**——不影响「低 rank 取胜」的方向性结论。
6. **一轮报告的措辞误植已在本报告 §2.3 更正**（`src/index.ts` → `packages/dsh-research-agent/src/index.ts`；「論衡」→「论衡」）。一轮报告文件本身**未修改**（它是上一轮交付物，按「不改写历史」原则保留原状）。

---

## 7. 附：本轮核实用到的命令（可复现）

```powershell
# 论衡真源仓库定位与版本
Get-Content 'E:\HERNESS\lunheng-article-pipeline-dsh\package.json' -Raw -Encoding UTF8
git -C 'E:\HERNESS\lunheng-article-pipeline-dsh' log --oneline -5

# 论衡自家门（本轮实测 exit 0）
node 'E:\HERNESS\lunheng-article-pipeline-dsh\skills\lunheng-article-pipeline\scripts\consistency-check.mjs'

# !!js 求值域（唯一真源）
#   …\@deepseek-ai+cordis@4.0.4_…\node_modules\@deepseek-ai\cordis-plugin-loader\src\config\utils.ts  L5-9
#   …\cordis-plugin-include\src\index.ts  L162-166（嵌套行求值域注释）、L181、L188

# preset 走 Include 的证据
#   …\@deepseek-ai+dsh-agent-presets\lib\types\mount.js  L30-34 / L40 / L56-59
#   …\dsh-agent-presets\lib\types\discovery.js  L35（COMPOSITION_FILE）

# customSkillDirs 的路径语义
#   …\@deepseek-ai+dsh-skill-filesystem\lib\index.js  L79（resolve(root)）

# rank 表
#   …\dsh-skill-filesystem\README.zh.md  L46-52（官方：100/200/300/400/500）

# 官方 preset 写法对照
#   …\dsh-agent-presets\presets\standard\agent.cordis.yml  L46 / L50 / L83-87

# 规则 ⑭ 的允许面（唯一真源）
#   …\skills\lunheng-article-pipeline\scripts\_lib\cc-rules\docs-version-rules.mjs  L155

# 本机 client 服务面
#   cordis_inspect_query(platform=client, provider=Service, method=listService)
```

---

**动议等级汇总**：P1 = R1、R2（文档与规则实现冲突，且影响借鉴项判定）；P2 = R3、R4、R5、R6。
**本轮未产生任何机制文件改动**；以上六条待主人 review 后在 host shell apply。
