# Changelog

本文件记录 DSH bundle（lunheng-article-pipeline）的版本历史。DSH 版独立维护、独立版本线：**v17.0.0 起版本号 = 纯语义化版本，迭代号进 major**（`2.5.2-dsh.17` → `17.0.0` → `18.0.0`；历史 `-dsh.N` 段见下）。方案变更理由与映射见 `## 17.0.0` 段。

## 18.1.0 — 2026-09-12

> **功能发布：第三方审计改进方案「C 组 · 中期偏架构」六条逐条处置**（审计报告 `run/guannian-yu-linian/audits/论衡第三方全量审计-v2.md` §4-C）。四条**已启用**、一条给**可选配方**、一条**仍未接线**（处置表见 `skills/lunheng-article-pipeline/references/_shared/DSH-集成方案.md` §七）。
> **默认行为不变**（主人既定「装了不坏」优先）：M 门 23 项的检查内容、Phase 结构、闸门数量、四道门脚本的输出契约**均未改**；新能力一律**可选**——宿主缺服务/缺包时**只降级**，技能注册与流水线照常（v18.0.0「入口 import 失败 → 技能不注册」的形态不得重演）。**官方依据**均取自 `dsh-plugin-guide/references/official-docs/`（快照 commit `d347e703…`，2026-09-04），行号写进各模块头注释与集成方案，不凭记忆。

### 新增 C-1：两个只读机检脚本 → DSH 原生工具

- **做什么**：入口 `lib/index.js` 在**同一个 `apply` 内**额外注册两个**只读**工具——`lunheng_m_gate`（M 门机械预检）与 `lunheng_char_count`（汉字字数）。实现 `lib/tools.js`。
- **为什么**：官方 `docs/cookbook/adding-a-tool.md` 要求「**返回一个规范 JSON 值**，不要让调用方从散文里解析 id 与字段」；此前主控只能 `pwsh node scripts/…` 再让模型读 stdout 与 6 个退出码。工具化后规范值、参数校验、`output.render` 人类可读文本、`exec.signal` 取消、Code Mode 调用一次拿齐。
- **参数错 ≠ 内容错（写死）**：`exit 10`（参数/路径错）与 `70`（内部错误）**不是内容结论**——工具此时 **throw**（官方：throw = 工具失败），**不得**返回一个 `exit:10` 的「规范值」被主控当成「M 门跑过了」。内容判定（`0/1/2/3`）才进返回值。
- **诚实标注（不许夸大）**：官方 `docs/subsystems/tools.md:370` 明确 canonical value **只在执行期有效**（日志只持久化 `content`/`error`/`meta`），故**工具化不会自动改善审计留痕**——闸门实据真源仍是落盘的 `M-Gate-Report.json`（v18.0.5 已把它与正文指纹绑定）。
- **为什么不是 patch 行、不要 `exports`/`Config`**：走**动态 `import('@deepseek-ai/dsh-tools')` + `ctx.get('tools')`**（官方 `guide/plugin-dev-guide.md:139`：可选依赖不写 `inject`），`inject` 仍只有 `['skills']`。若为工具而静态 import 宿主包或把 `tools` 写进 `inject`，任何缺该包的 profile 都会**入口 import 失败 → 技能也不注册**（教训 #154）。`package.json` 增 `@deepseek-ai/dsh-tools`（**optional** peer）只为如实声明，不是安装依赖。
- **三条降级路径**（两条有 CI 门钉住）：宿主无 `tools` 服务 → 不注册；`@deepseek-ai/dsh-tools` 不可解析 → 打印一行说明并跳过；任一模块抛错 → 只丢该能力。`tests/entry.test.mjs` 覆盖「注入契约等价替身真跑两个工具」与「包不可用时的降级」；`pack-smoke.mjs` 覆盖**发布物**侧（解包目录里包不可解析 → 必须安静降级为 0 个工具，且 guard/命令照常注册）。
- ⚠️ **本版内实测到并修掉的一处真缺陷（不许省略）**：首版 `lib/tools.js` 在 `output.schema` 里写了 `required`（根 1 处 + 数组 `items` 1 处）。用**宿主真实的 `defineTool`**（从本机已装 DSH 包目录取，`run/_cgroup-real-definetool.mjs`）一灌即抛
  `JsonSchemaError: unsupported JSON schema: schema.required is not supported by the value schema DSL`。
  **为什么危险**：`defineTool()` 是**定义期**抛错 → 两个工具**永不注册**；而入口的降级 `catch` 会把它吞成一行提示（技能照常注册）→ 于是「81 个测试全绿 + 生产里两个工具都不存在」可以同时成立。**用替身 `defineTool` 的测试看不见这一类问题**。
  **根因（读宿主源码确认）**：`@deepseek-ai/dsh-tools` 的 `defineTool` 不是直接吃 JSON Schema，而是先编译**作者期 DSL**——只认 `type/oneOf/properties/additionalProperties/items/enum/const` + 注解 `description/title/default/examples`；`type:'object'` **必须显式** `additionalProperties`；**`required` 只在「参数属性」层可用**（源码 `lib/index.js:600-608` 的 property 分支 `allowRequired:true`），`output.schema` 走 `compileValueSchema`（同文件 `:770-783`，`allowRequired:false`）→ **任何层级的 `required` 都会被拒**。
  **修法与防线**：移除两处 `required`（`output.schema` 全程不用）；新增 CI 用例**「工具定义必须符合宿主 value schema DSL」**——按上述规则做结构断言（不依赖宿主包，裸仓库可跑），并带**反向自证**（把 `required` 注回、把 `additionalProperties` 删掉两个探测样例必须被判违规，防断言恒真）。**对抗验证**：把 `required` 注回 `output.schema` → 用例变红并点名「DSL 不支持该关键字」（`run/_adv-dsl-required.mjs`，注入物已还原）。
  **顺带得到的结论**：`tests/entry.test.mjs` 用替身是**必要的**（裸仓库没有宿主包），但替身**只验证「我们的行为」，不验证「我们的声明能否被宿主接受」**——后者只能靠「真实包探测（人工，记录在案）+ 按源码规则写结构断言（CI）」。这是本轮 C-1 最值得记住的一条。

### 新增 C-4：机制文件写保护从「文档纪律」升级为**机制否决**（部分）

- **做什么**：入口注册全局 `ctx.tools.guard()`（`lib/guard.js`）——`write`/`edit` 类工具命中**机制路径**（技能目录 + `cordis.patch.yml` + 包内 `lib/` + 仓库 `scripts/`）**在分发前即被拒**，返回理由含改进路径（写 `audits/反哺报告-vN.md`）与授权方式。
- **官方依据**：`docs/subsystems/tools.md:313-324`——`guard()` 返回值**只收紧**权限，后续监听器无法改回允许；plain-context guard **全局生效**。
- **三条如实声明的缺口**：① **只管工具调用**——`pwsh` 可直接写盘（官方对子进程的围栏是部署级 `ctx.sandbox`，插件改不了别人的 profile），官方**没有** per-path 只读声明 API → 定位是「**比 prompt 强、比机制强制弱**」；② **技能目录部署下不生效**（guard 由入口安装，只有 bundle 部署会跑入口）；③ **授权是主人的动作**——`LUNHENG_ALLOW_MECH_EDIT=1`（宿主环境变量），agent 不得自行声明授权。
- **宁松勿误伤**：受保护根**不含** `docs/`、`README`、`CHANGELOG`（文档可自由改）；guard 自身异常一律返回 `undefined`（不改变权限）。

### 新增 C-5：`/lunheng-status` 人类命令

- **做什么**：`lib/commands.js` 注册斜杠命令 `/lunheng-status [项目名]`——读 `run/<项目>/status.md` 与 `进展-主人版.md`，**不产生模型消息**（官方 `docs/subsystems/commands.md:5`：interactive adapter 直接 dispatch，不进模型轮次）。省略项目名时取 `run/` 下 `status.md` 最近修改的项目。项目不存在时返回可读提示（不抛错），并列出 `run/` 下现有项目名。

### 新增 C-6：文档词预算门（`repo-hygiene-check` 规则⑨）+ 规则① 扩面

- **动机**：本包的成本结构里，**唯一每次会话恒定的开销就是被载入上下文的文档**（`SKILL.md` 由入口注册 → 每次技能激活都在上下文；`AGENTS.md` 在技能目录内自动生效）。而此前**没有一条门看「涨没涨」**——膨胀是唯一无人反对的方向。官方先例：`official-docs/AGENTS.md` 的 `verify-doc-budgets`。
- **三条设计**：① 技能目录内所有 **≥12 KB 的 .md 必须登记**上限（新胖文档不能悄悄逃过测量，实测首轮就抓出 `DSH-集成方案.md` 未登记）；② **上限即棘轮**——上限取「当前字节数向上取整到整 KB」，任何增长必须**在同一次提交里显式抬升上限**并在本文件写明理由；③ `SKILL.md` + `AGENTS.md` 另有**常驻集合计**上限（防「瘦 SKILL、肥 AGENTS」换个口袋）。
- **本轮显式抬升（附理由，规则⑨ 要求的同提交动作）**：`SKILL.md` 30→**32 KB**、`AGENTS.md` 20→**21 KB**、常驻集合计 50→**52 KB**（实测 51.3 KB）。**为什么必须增长**：C 组有四处**运行期事实**必须写进常驻集——① 原生工具「清单里有就优先用、没有就照旧 `pwsh`」；② `/lunheng-status`；③ 写保护已机械化（含 `LUNHENG_ALLOW_MECH_EDIT=1` 与「`pwsh` 不经此门」的残余缺口）；④ 四门提问方式与「子代理问不了」。**同时做了压缩**（退出码段去掉重复叙述，净增 < 1.5 KB）。**长期目标仍是 20 KB**（`target` 字段记录，只报告不判失败）——本轮是**棘轮**，不是瘦身令；瘦身需主人拍板口径。
- **规则① 扩面（自查发现的真实缺口）**：语法检查此前只扫 `.mjs`，**入口与 C 组新增的 `lib/*.js` 不被任何静态门检查**（唯一下场是「被测试 import」，而 `lib/tools.js` 只在有宿主包时才装载）；扫描集同时改为「git 跟踪 **∪ 未跟踪未忽略**」——因为 `npm pack` **会打包尚未 `git add` 的新文件**，旧规则①看不见它们。
- **对抗验证**：给 `SKILL.md` 追加 330 B → 规则⑨ 报超限并给出两条合法出路（先瘦身／同提交抬升上限，含建议值）；新建 12.7 KB 未登记 `.md` → 覆盖臂报；新建语法错的未跟踪 `lib/_probe-broken.js` → 规则① 报。三次注入均实测变红，注入物已全部移除（`SKILL.md` 字节数已复核回原值）。

### 变更 C-3：四道人在环闸门改用 `ask_user_question` 提问留痕

- **做什么**：四门（Phase 0 / 2.5 / 3.5 / 5）在写完 `阶段确认-<阶段>.md` 后，主控用 `ask_user_question` **一问**把决策点摆给主人——选项 ≤5，**第一个即主控建议**并在标签末尾加「（推荐）」（官方约定：推荐 = 放最先 + 标注，**无独立推荐字段**）；`multi_select` 默认 false。确认单 **§6 增「提问方式」栏**、新增 **§7**（形态与边界），`00-主控-扩展职责.md` §二十一 与 `SKILL.md` 同步。
- **为什么**：官方 `docs/tool-catalog.md:18` 记录该工具写入 `tool/call` + `tool/result` 两个事件（问题原文在 `tool/call`，答复在 `tool/result`），**两者都进 append-only 会话日志、可重放**——「问过什么、什么时候问的」不再只存在于对话里。
- **如实更正（不许把留痕说满）**：官方**没有** `user-questions/*` 专用日志事件——「日志审计事件对」的说法只存在于 `approval/asked` + `approval/decided`。故**§6 的人工回填仍是权威留痕**，工具只是让问答自动进日志。另：早期内部笔记把 `AskUserQuestionIntent` 记成 `{approve: boolean}`，**实为 `{kind:'plan-review', approve: <选项标签字符串>}`**（`docs/subsystems/user-questions.md:35-44`）——本版按官方更正。
- **两条硬边界**：① **只有主控问得了**——官方 `user-questions.md:136-140`「an owned child has no human answerer and would block forever」，子代理调用被拒（`DELEGATED_CALLER`）→ **闸门必须留在主控**（现状正确，勿外移；T1-T9 只能把「需主人决定」写进交接报告）；② **工具失败 ≠ 主人同意**——无提供方/无人应答时调用**失败**（`NO_PROVIDER`/`ASK_ABORTED`），**不得**当通过，退回书面确认单并在 §6 记失败码。官方未定义超时，故规则是「同一门只问一次、未答复就等」。

### 配方 C-2：分档工具行移入 agent preset（**可选，默认不动**）

- 三个分档工具行仍留在**包级** `cordis.patch.yml`（「装了不坏」优先）。若主人希望「只有选定该预设的会话才有这三个工具」，官方机制是**把同样的行挂进 preset 组合**（`docs/subsystems/tools.md:484-504`、`docs/subsystems/skills.md:13`：preset 的 standing composition 注册落在**该预设的作用域层**；`docs/architecture.md:131` 是入口判据），并可借 `modelSelectionSettings`（`@deepseek-ai/dsh-tool-subagent`，默认关）+ `list_subagent_models` 用官方**模型发现链**替代「改 env 必须重启」。
- **三步配方 + 每步验证 + 回滚 + 五条已知限制**见 `references/_shared/DSH-集成方案.md` §八。**诚实标注**：官方知识库里**没有任何 preset 组合文件的完整示例**，且组合文件名只有摘要级依据（「preset cordis.yml」vs `agent.cordis.yml`）——配方明确要求「照抄你部署里已存在的预设目录」，并标为**未在真实部署验证**。另：官方**没有**「全局工具行会让每个会话都付 token 成本」的量化陈述，「`modelSelectionSettings` 要求工具行在 preset scope」也**不是官方原文**（是从 `capability-seams.md:491` 推出的）——配方里都如实写了。

### 发布后修正（v18.1.0 发布当天；**只动仓库脚本，未改动已发布产物**）

- **现象**：`v18.1.0` 的 tag 推送后，`publish` 流水线五道门 + 发布 + 发布后审计**全绿**（npm 18.1.0 已带 provenance 发布成功），但同一次推送触发的 `ci` 流水线在 **`macos-latest`** 上红：`script-tests` job 的 `pack-smoke：…` 用例失败，报 `resourceBase 未指向解包技能目录：{"kind":"directory","path":"/private/var/folders/…"}`。
- **根因**：**macOS 的符号链接 + Node 的 realpath**。`os.tmpdir()` 在 macOS 返回 `/var/folders/…`，而 `/var` 是指向 `/private/var` 的符号链接；`pack-smoke.mjs` 用 `mkdtempSync(tmpdir())` 得到**非规范化**路径，但 Node 解析 ESM 时会 realpath → 入口算出的 `resourceBase.path` 是**规范化**路径 → `resolve(a) === resolve(b)` 字符串比较必然不等（`resolve` 不做符号链接展开）。同一原因还会让脚本喂给 guard 的探测路径与 guard 的受保护根前缀不匹配 → `guard 未否决技能包内写入` 假失败。
- **为什么本地没发现**：本机是 Windows，`tmpdir()` 与真实路径一致；而这条路径**第一次被 CI 跑到**（v18.0.5 引入 `pack-smoke`，但那一版按主人指示从未推送，故历史上从未在 macOS 上执行过）。**这是「本地全绿 ≠ CI 全绿」的又一实例，且只由平台差异触发。**
- **修法**：`scripts/pack-smoke.mjs` 新增 `canon()`（`realpathSync` + 异常回退 `resolve`），**解包目录一律先规范化再使用**，`resourceBase` 两侧都用 `canon` 比较。
- **复现与验证（在 Windows 上复现了 macOS 的失败条件）**：用 **junction** 当 `TEMP`/`TMP`（`E:\HERNESS\run\_symtest\link → real`）→ **修复前**精确复现两处失败（`resourceBase` + `guard`）；**修复后**同一条件下全绿，正常 `tmpdir` 下同样全绿。
- **影响面（如实）**：`scripts/pack-smoke.mjs` **不在 `files` 白名单内**（仓库级门，不随包分发），故 **npm 上的 18.1.0 产物不受影响**，无需重发；`v18.1.0` tag 上那条 `ci` 红记录属于**仓库门的历史**，无法也不应更改。若主人希望「tag 与全绿提交一一对应」，可另发一个**仅含此修正**的补丁版（内容与 18.1.0 的随包文件一致，仅 `CHANGELOG.md` 不同）。

### 未做（如实登记，不假装做了）

- **C-2 未改为默认**：换作用域就不再是「装了就可用」，需主人主动选会话预设；且官方无完整示例，不宜把未验证配方变成默认路径。
- **Phase 内并行仍不用 `workflow` 工具**：该工具的用法说明限定「**仅在用户明确要求 workflow 或大规模多 agent 编排时**使用」，3 个检索员用 `subagent` 手动并行更合规——维持 v18.0.5 的降级判定（主人明确认可后可再议）。
- **`Config`（Schemastery）不引入**：会重新让入口「解析配置才能启动」，与教训 #154 相反；当前也没有需要暴露给 `cordis.yml` 的可调参数。
- **P3 全局强调通胀（加粗 / emoji）不动**：大量 emoji 是**机检字面量**（`m-gate-check` 按符号定位），批量清理会破坏契约。

### 门与验证（本版全绿）

- 五道门：`consistency-check`（文档一致性）、`plugin-surface-check`（打包面 11 通过 / 0 失败 / 0 提示 + `[patch-deps]`）、`repo-hygiene-check`（⑨ 条，含新增词预算门）、`pack-smoke`（发布物冒烟，**含 C 组三条断言**）、`node --test "tests/**/*.test.mjs"`（**81 通过 / 0 失败**）；官方 `dsh-plugin-dev check` **11 passed / 0 failed / 0 warned / 3 skipped**。
- 包面新增文件：`lib/tools.js`、`lib/guard.js`、`lib/commands.js`（均随包，`files` 白名单的 `lib` 目录覆盖；`pack-smoke` 已把三者列入「必须存在」清单）。

## 18.0.5 — 2026-09-12

> **第三方全量审计（对照官方插件规范）后的修订版**。审计报告：`run/guannian-yu-linian/audits/论衡第三方全量审计-v2.md`（4 路独立只读子审计 + 主控自做的运行面复核；评分 6.7/10，扣分点集中在「**运行时真实性保证**」这一层）。
> 本版**逐条修订 P0 / P1 / P2 / P3 与改进方案 A、B 组**；不改 M 门 23 项的**检查内容**、不改 Phase 结构与闸门数量。行为对账：同批真实项目在 v18.0.4 与 v18.0.5 上**逐门比对**，除下表列出的有意变更外**判定完全一致**（`run/_compare-v1804-v1805.mjs`：门数 22=22、exit 码全同）。
> ⚠️ **本版未单独发布到 npm**（`18.0.5` 不是一个已发布的版本）——它的全部内容**包含在 [`18.1.0`](#1810--2026-09-12) 里，随 18.1.0 首发**。保留本节是为记录修订过程与逐条理由（发布时主人指示「先不发版」，其后直接发了 18.1.0）。要装这一批修正请用 `lunheng-article-pipeline@18.1.0` 或 `@dsh`。

### 修复：P0 —— T8 裁定未与「所审正文」绑定（报告可为旧结论放行）

- **现象（审计实测）**：在真实项目副本里改一段正文后重跑，进程 `exit=2`、`script_exit_raw=2`，但落盘 `M-Gate-Report.json` 的 `exit` **仍是旧裁定的 0**，`build-evidence-bundle` 生成的审计视图写 `通过 16/22 ｜ P0: 2 ｜ exit: 0`——**同屏自相矛盾**，而该视图被 8 个角色当闸门真源读；连带 M-Exist-5 的「闸门 ↔ 报告矛盾」分支**永久不可达**。
- **修法**：报告新增 `verdict_scope`（`draft_sha256` + `draft_bytes`）；写入时**只有指纹一致**才保留 T8 裁定的 `exit`，否则置 `verdict_stale: true` + `verdict_stale_reason`，落盘改用本次**机械值**并 stderr 明示「旧裁定已过期，请重裁」；审计视图渲染为 `exit: <机械值>（T8 裁定已过期，原裁定 N）`；M-Exist-5 在 `verdict_stale` 时回退比对 `script_exit_raw` 并报 P0 提示。

### 修复：P1 —— 七条（全部配回归用例）

1. **退出码在异常路径上撞码**（与 v18.0.2 修的类别同型）：新增 `scripts/_lib/exit-guard.mjs`，**11 个随包脚本全部 import**：fs 类未捕获异常统一 `10`、其余内部错误 `70`（EX_SOFTWARE，与内容判定彻底分开）；`count-chars <目录>`、`m-gate-check <目录> <目录>`、`build-evidence-bundle --source <目录>`、`final-check <文件当项目>` 等改为**入口 `statSync().isFile()/.isDirectory()` 前置校验**（实测全部由 `exit 1` 变为 `10`）。
2. **`final-check` 子步骤 spawn 失败被记成「P1 残留」**：改为 `70` + 独立推荐语（实测 `PATH=''` 场景：旧版 `exit 1` +「可触发 T5 修订一轮」→ 新版 `70` +「内部错误，与正文内容无关」）。
3. **证据包布局口径分裂**：`findCard()` 增加「证据包内相对路径」档（`evDir/<rel>`），M-Form-6 / M-Exist-2 / M-Exist-3 统一走它；新增**布局异常单独一条 finding**（`M-Exist-2`，P1）——`test-paper-01` 由 4 条互相矛盾的 P0 变为「1 条布局异常 + 真实问题」，`M-Exist-3` 从假 P0 变通过。
4. **`count-chars --summary` 不带 degraded**：正文区起点退化标记**提到 summary 分支之前**（两模式共用）；顺带修 `avgPerSection` 除零（旧版 JSON 变 `null`）、UTF-16 BOM 输入改为**响亮拒绝**（旧版静默给 `hanChars: 0`）、未知参数（`--ful`）显式拒绝（旧版静默走默认口径）。
5. **测试网 10 项盲区**：新增 10 个用例覆盖 M-Form-1/2/6/7/8、M-Exist-1/2/3、consistency ⑩ 与 pack-smoke；「取最大版本」的**假测试**（断言可被上一次运行残留满足）改为「断言 v3 在、v1 不在」。**对抗验证**：注入 5 处实现缺陷（顺序断言失效 / 空文件判定失效 / 悬空引用判定失效 / 双向对比失效 / 信任级别判定失效）→ **5/5 变红**（此前 10/10 不变红）。
6. **门自身自证**（第三方审计独立命中，本版重写）：`repo-hygiene-check` 规则⑧ 从「grep `process.exit(字面量)` + 全文数字匹配（近乎恒真）」改为**解析实参**——字面量、本文件 `const`、`exit-guard` 导出常量三级解析；解析结果必须是声明集子集；每个声明码必须可解析（动态 exit 才退回字面量并如实标注）；**每个读盘脚本必须 import guard**，否则判失败；`exit-guard` 必须真在盘且导出契约常量。对抗验证：把「路径错」改回 `exit 1` → 报；删 guard import → 报；删 guard 模块 → 报。
7. **patch 引用未声明的核心包**：`package.json` 增 `@deepseek-ai/dsh-tool-subagent`（optional peer，与 `@deepseek-ai/dsh` 同版本区间）；`plugin-surface-check.mjs` 新增自加检查 **`[patch-deps]`**——patch 里每个行 `name` 必须是本包名、已声明依赖或宿主核心包白名单，否则**阻塞发布**（官方 `manifest-peers` 只扫源码 import，看不到 patch 行名；负对照已证宿主改名即整树起不来）。

### 新增：P1 —— 安装→启动→卸载 这一段补上门（此前 CI 与本机都没有）

- 新增 `scripts/pack-smoke.mjs` + CI job **`pack-smoke`** + `publish.yml` 门 4/4：`npm pack` → 解包 → 断言关键文件齐备 / 自注册行恰一行 / patch 行依赖已声明 / `tests` 不随包 / **真跑解包后 `lib/index.js` 的 `apply`**（注册名、正文非空、frontmatter 已剥离、`resourceBase` 指向解包目录、11 张角色卡齐）。对抗验证：删自注册行 → 报；patch 引用不存在的包 → 报。
- ⚠️ **如实更正**：`CHANGELOG` 旧文曾写「CI 的 verify job 绿」——**CI 从来没有 verify job**（本次已就地更正）。官方 `dsh-plugin-dev verify` 在本机仍不可达，原因**不止** pnpm：DSH Desktop 的 `dsh.cmd` 硬编码 `DSH_HOME`，使 verify 声称的「干净 mkdtemp profile」失效（会把依赖装进真实 `~/.dsh/profiles/compat`）。`pack-smoke` 覆盖「发布物可装载」，**仍不等于官方 verify**。

### 口径与文档：P2 / P3（12 + 10 项）

- **分档映射第 15 处漏网**：`examples/preset/preset.yml` 把 T6/T9 写在强推理档 → 改为「分析写作 T4-T5 / 批判审计 T6+T7+T9+G14」并加真源指针；规则 ⑩c **扫描面扩到 `.yml/.yaml/.json`**（一行多档按分隔符切段逐段判定）。对抗验证：两种旧口径写法均被报出，真源口径不报。
- **SKILL.md 两处官方事实错**（已核宿主源码）：① `version` **不会**落进 `metadata`（只有 `metadata:` 键会；顶层键被丢弃）；② 本包 bundle 形态经 `ctx.skills.register()` 注册，rank 恒为 **`RUNTIME_RANK = 250`**，**不是 600**——由此更正两个反直觉后果：项目级副本（100）会**静默顶替**已装 bundle，而「拷到 `~/.dsh/skills`（400）覆盖 bundle」**不成立**；自检判据改为「读到的绝对路径 + 版本头」。
- **否定路由前置**：官方目录只渲染 `name` + `description`（原文：「不包含…路由提示」），故「何时不该用」并入 `description`（`whenToUse` 保留但注明对模型不可见）。
- **五语 README 结构镜像**：es/pt/hi 补回语言切换器行与 `### Documentation` 9 行表（表行 33 → **44**，五份一致）；修 es/pt 的 `each side's account` 误译；新增规则 **㉑**（切换器 + 表格行数 + `##` 标题数五份必须一致）。对抗验证：删 hi 切换器 → 报。
- **发布命令推错 tag（7 处）**：`git tag vX && git push origin v18.0.0` → 推送目标改为与 tag 一致；README 的发布步骤同步为「四道门」。
- **字数口径冲突**：`字数判定表.md` 原写「正文=引言起至结语（不含关键词）」，与 `count-chars.mjs` 实现（`## 摘要` 之后，**含关键词**）不一致——按**脚本为真源**收敛，并给出同口径的 pwsh 复核片段（差值是关键词那几十字，但在 1%/5% 阈值上足以翻转 P1/P2）。
- **篇幅分层两套阈值**：`QUICKSTART.md` / `任务简报-template-lite.md` 的「轻量 ≤4000 / 中段 4000-8000 / 重量 8000+」改为指向 `SKILL.md` 的四档真源；`pipeline-readme.md` 的「轻量档 ≤2000 / ≤3000」统一为「2000-3000 轻量档」「<2000 简化直写」。
- **`交付说明` 字段数 12 vs 两处「11」**、**G 项数**（改为「15 主项 + 3 子项 = G0.5/G2.5/G4-2」，与 M-Exist-9 同口径）、**`docs/troubleshooting.md §8` 的 `--source` 退出码 2→10**（该节自相矛盾）、**`glossary.md` 悬空规则号「㉑」→ ⑩/⑩b**、**启动必读清单两处不一致**（SKILL.md 为真源、AGENTS.md 改指针并补 §十二）、**T0 扩展卡 `00-主控-扩展职责.md` 补进 SKILL.md 角色卡索引**（此前只能从 coordinator 卡的指针到达）、**QUICKSTART 的「纯 skill」与 bundle 安装自相矛盾 + 空 TL;DR** → 均已修。
- **SVG 消毒缺口（安全）**：未加引号的 `on*=` 既不剥离也不告警、且被 `md2html` 原样写进导出 HTML → 补 `/\son\w+\s*=\s*[^"'\s>]+/gi`（实测 `onload=alert(1)` / `<rect onclick=alert(x)/>` 现在都剥离并告警，干净文件不受影响）。
- **两份 token 脚本数据源判序相反**（`token-cost` 单文件优先 vs `token-budget` 目录优先，同机两份报表取不同快照且都 exit 0 无告警）→ 统一为**目录式优先**并加「两布局并存」显式告警。
- **三档「一键退路」不摘工具行**：`LUNHENG_TIERING=off` 旧版只让 `agentOptions` 变 undefined，三行仍挂树（实测工具数恒 29）→ 三行加 `disabled: !!js "process.env.LUNHENG_TIERING === 'off'"`（与宿主自用写法一致）。⚠️ **未验证**：本机 `--dump-config` 只打印**声明行**（判定实验：把三行改成恒真后 dump 里依旧在），故「off 是否真摘掉三行」在本机无法坐实；退化行为安全（宿主若忽略该键 = 与 18.0.4 完全一致）。
- **新增机检：编码事故的第二道网**。本轮修订中我用 PowerShell `Get-Content | Set-Content` 往返改 `examples/preset/preset.yml`，把它写成了本地编码——规则⑤（fatal UTF-8 解码）**确实抓到了**；但同类事故更隐蔽的形态是「合法 UTF-8 但含 U+FFFD 替换字符」（字符已丢失、解码不报错），故规则⑤ 增加 **U+FFFD 零容忍**。对抗验证：注入 1 个 U+FFFD → 报。**教训**：改 UTF-8 文件只用 `edit`/`write` 工具或 Node `fs`（`\uFFFD` / GBK 往返不可逆）。

### 未做（如实记录，附理由）

- **把机检脚本暴露成原生 `defineTool`**（审计改进方案 C 组）：属**新增能力**而非缺陷修复，会改变插件对外表面（新增工具、需 Schemastery `Config`、`manifest-peers` 判定变化），需独立回归与安装冒烟 → 建议单独一版（v18.1）。官方依据与最小改造方案见审计报告 §4C。**另注**：官方 `tools.md` 明确 canonical value 只在执行期有效，故「改成工具」**不会**自动改善审计留痕——闸门实据真源仍是落盘的 `M-Gate-Report.json`（本版已把它修对）。
- **分档工具行移入可选 agent preset**（C 组）：同上，属部署形态变更，且与「装了不坏」的既定取向冲突，需主人决策。
- **四道闸门改用 `ask_user_question` 留痕**（C 组）：收益明确（决策进入 `tool/call ↔ tool/result` 日志对），但需改派发话术与模板，且 `headless` 下无人类应答者要保留降级分支——建议与 C 组一起做。
- **`ctx.tools.guard()` 机制化写保护**（C 组）：只能覆盖 `write`/`edit`（`pwsh` 仍可写文件，官方无 per-path 只读声明），属「比 prompt 强、比机制强制弱」的部分强制，需先与主人对齐预期。
- **词预算门**（C-6）：本版未做——SKILL.md 现 30.5 KB（审计指出它从「瘦身到 16.9 KB」回涨到 28.5 KB），加门需先定目标值并真的减重，否则只是把现状钉成上限。
- **P3 风格项**：全局强调通胀（4,189 处加粗 / 2,134 emoji）**不动**——大量 emoji 是**机检字面量**（如 `## 📇 索引段`），批量清理会直接破坏契约；只能逐处人工判断，收益纯可读性、风险契约破坏。审计视图里的文件名注入面（Windows 下仅能插入 `（）「」` 类误导文案）同理留待专门处理。

## 18.0.4 — 2026-09-12

> **收口版**（v18.0.3 的补漏）：v18.0.3 把「机检硬格式」的副本改成指针，却留下 **4 处指向旧表的悬空指针**（最刺眼的一处写在 `SKILL.md` 摘要里，仍称「四份模板顶部已列机检硬格式表」——表已搬走）；同时清掉冗余审计 §二.5 的「同一句连写两遍」。**纯文档层修正，不动脚本与任何门禁判定**（四道门与 66 个用例仍是同一套）。

### 修复：v18.0.3 去重后遗留的 4 处悬空指针（教训 #156）

- `SKILL.md`「素材卡机检硬格式」摘要行：原本复述条目 + 声称「四份模板顶部已列『机检硬格式』表」→ 改为**指向真源** `references/_shared/机检硬格式.md`（摘要不再复述条目，只留影响面）。
- `references/agents/02-数据检索-data-scout.md`：数据卡硬格式条目 → 纯指针（**§一 通用 + §三 数据卡专属**）。
- `references/templates/任务简报-template-lite.md` ×2：`（见上「机检硬格式」表）` → `（见 ../_shared/机检硬格式.md §五）`。
- **教训 #156 已入库**（`references/memory/lessons.md`）：**同一事实的宿主数 = 副本数 + 「指向副本的说法」数**——把副本改成指针时，要 grep 的是方位词（`见上` / `顶部` / `详见`）+ 被搬家内容的标题，只处理副本本体等于只收敛了一半。

### 去重（冗余审计 §二.5：同卡内相邻两行重复同一句）

- 8 张角色卡（T1/T2/T3/T4/T5/T6/T7/T9）的「执行约定」原为**两行**：引用块 `> **执行约定**：状态机…` 与下一行粗体 `**4 层防御（DSH 精简版）**：状态机…`（内容逐字相同）→ 每卡删引用块那一行，保留带 `glossary.md` 指针的粗体行（并统一为可点击链接）。**共 −8 行**。

### 仍延后（下一批，附理由——不混进收口版）

- **§二.2** `m-gate-check.mjs` 的 4 类重复片段抽 helper（同文件内 4 份「取最新审计报告」、4 份 `auditsDir`、4 份表格切行、3 份卡片扫描、2 份索引段解析，−60~70 行）：动的是 **23 项门禁的实现结构**，须逐门重验行为基线。
- **§二.4** 测试夹具抽 `tests/_fixtures.mjs`（−150~210 行，不减任何断言）：**零运行时收益 + 中等风险**。
- **§三.1** G 清单与 M 门 6 对同源规则在 `audit-checklist-quickref.md` 标注「与 M-x 同源」（避免 T7 以为是两条）；**§三.2** 交接报告六要素 ≈30 处宿主的收敛。

## 18.0.3 — 2026-09-12

> **同轮内的去重 + 口径统一版**（承接 `## 18.0.2` 的冗余审计）：删掉同一事实的多份副本，把每条多副本收敛为「一处真源 + 指针」，并修掉一条**在 14 处副本里方向相反**的角色↔工具映射。**不改任何门禁语义**——M 门 23 项检查内容、退出码契约、G0-G14 清单、Phase 结构与闸门数量全部不动（新增的 ⑩c 是**追加**的文档一致性规则，不改变既有规则判定）。

### 去重（同一事实只留一处 + 指针）

- **机检硬格式 5 份副本 → 1 份真源**：新增 `references/_shared/机检硬格式.md`（图位独占一行 / 引用闭环 / 索引段完整性 / 素材加载清单 / 闸门记录实据 / 文末白名单六段），4 张 `*-template-lite.md` 的内嵌表与 `pipeline-readme.md` 派发话术 §格式硬约束 全部改为指针。
- **删 3 个孤儿文件**：`references/templates/README-模板拆分方案.md`（模板拆分的历史方案，拆分已完成）、`审稿报告-template.md`（格式真源在 `09-审稿-peer-reviewer.md`）、`先行者清单-template-lite.md`（格式真源在 `01-文献检索-literature-scout.md`）——三者全库无引用者。
- **能力档表 4 份副本 → 1 份真源**：`SKILL.md` 内嵌的「DSH 默认候选示例」表（与「禁止写死厂商默认值」自相矛盾）、`pipeline-readme.md` §能力分层原则表 + §DSH 分档预设接线表、`operations.md` 模型建议表 → 压缩映射 + 指向 `references/_shared/模型路由.md` §二。真源表不含的「错配后果 / 档位选择理由」保留在各自原处（信息不丢，只是不再重抄一张表）。
- **删 `operations.md` 的 v2.2.8 硬编码 fallback 链**（`deepseek-v4-pro → MiniMax-M3 → deepseek-v4-flash → glm-5.3`）：与 v2.3.12 起的「能力档 + 候选池」抽象矛盾，兜底链真源 = `scripts/model-routing.mjs` 输出 + `_shared/模型路由.md` §四。
- **脚本内重复实现**：`count-chars.mjs` / `token-budget.mjs` 各自的汉字计数 → 共用 `_lib/han.mjs` 的 `countHan`（对同一输入输出**逐字节一致**，已用备份副本对账）；`_lib/cards.mjs` 删掉无引用者的 `cardPattern`。
- **过期数字**：模板体积断言改为实测（`lite 13.0 KB ↔ full 55.2 KB`）；`SKILL.md` 模板清单补全为 **26 个**（v18.0.3 实测）。

### 口径统一（此前「文档层」与「真源」方向相反）

- **分档工具 ↔ 角色映射**（真源 = `scripts/model-routing.mjs` 的 `tool → roles` + `references/_shared/模型路由.md` §二）：`subagent_strong` = **T4 / T5**；`subagent_audit` = **T6 批判 / T7 审计 / T9 审稿 / G14 检测**。此前**14 处副本**（五语 README 各 1 处、`docs/installation.md`、`docs/usage.md`、技能 `README.md`、`examples/preset/README.md`、`cordis.patch.yml` 注释、`SKILL.md` ×2、`pipeline-readme.md`、`docs/introduction.md`）把 T6/T9 列在**强推理档**——按文档派发会拿强推理模型跑顶配批判，且无门可拦。
- **22 处 / 9 个文件**的「候选池见 SKILL.md 模型分工表」→ 改为指向真源 `references/_shared/模型路由.md` §二：该表在 v18.0.0 前后已迁出 `SKILL.md`，这些指针**长期悬空**（指向不存在的段落）。
- **删残留的写死模型名**：`06-批判` / `07-审计` / `09-审稿` 三张角色卡里的 `claude-opus-5 → minimax-m3 → deepseek-v4-pro` 示例池（同段文字已声明「v2.3.13 起不再硬编码模型名」，却仍把旧池抄在括号里）；顺带删掉 `07-审计` 里一处空的 `- ` 列表残骸。

### 新增机检（防复发：这条映射漂移此前无门可拦）

- **一致性规则 ⑩c 分档映射全库对账**：从真源 `model-routing.mjs` 现场派生 `tool → roles`，再逐行核对每张表 / 每条 `#   - subagent_x:` 注释里的角色集合（当前 **30 处断言**）；**真源不可派生即 P0**（规则失效不得静默放行）；复合写法 `subagent_retrieval/strong/audit` 不是断言，不误报。配对抗测试：注入旧口径（T6/T9 塞回强推理档）必须报、真源改写导致派生失败必须 P0 报。
- `AGENTS.md` 里「21 类漂移」这个数字改为指向脚本头规则表——**「加规则忘改数字」本身就是同类漂移**（⑩b 加进 18.0.2 时该数字就没跟着动），去掉数字胜过再维护一个数字。

### 未做 / 延后（如实记录）

- **测试夹具抽取（`tests/_fixtures.mjs`）延后**：`tests/scripts.test.mjs` 里约 150–210 行是各用例重复的临时仓库搭建，可抽公共模块，但**零运行时收益 + 中等风险**（66 个用例的行为基线要整体重测），留待专门一批做，不混进去重版。
- 官方 `dsh-plugin-dev verify`（`pnpm pack` + 干净 `DSH_HOME` 安装冒烟）在本机跑不通——**本机环境问题，非本包缺陷**。~~（CI 的 verify job 绿）~~ **该说法已于 v18.0.5 更正**：CI 从来没有 verify job（`.github/workflows/` 全目录无 `verify`），这句话当时是错的；v18.0.5 起改由 CI 的 `pack-smoke` job 覆盖「发布物可装载」这一段（仍不等于官方 verify，见 `## 18.0.5`）。
- 官方资料对照后判定的**尚未落地项**：`subagentModelSelection`（原生「按调用选模型」）仍不默认开启（宿主未提供该服务即加载期抛错，详见 `_shared/模型路由.md` §五；主人 2026-09-11 已确认维持现状）。

## 18.0.2 — 2026-09-11

> **本版是冗余审计（`audits/论衡冗余审计-v1.md`）后的缺陷修复版**：修掉 1 处**静默失效的机检门**、3 类**口径/退出码漂移**，并各配一条机检或回归测试（这些都是"此前无门可拦"的东西）。

### 修复：M-Form-9 在 Phase 4 静默失效（P0，与 v18.0.0 修的 M-Integrity-1 同一 bug 的第二份拷贝）

- **现象**：`m-gate-check.mjs` 里「从被审文件定位 `01-任务简报.md`」有**两份实现**。v18.0.0 已把 M-Integrity-1 那份改成 `findBriefUpward(dirname(draftPath))`（向上查找，兼容 `final/` 与 `drafts/`），但 **M-Form-9 那份仍是旧的 `draftPath.replace(/final[\\/]定稿\.md$/, …)`** → 审 `drafts/初稿-vN.md` 时替换不命中 → 把初稿当简报读 → `pledged=0` → **「图位不足」比对在 Phase 4 静默不判**。
- **修法**：把 `findBriefUpward` 提到**模块级**（单一定义），M-Form-9 与 M-Integrity-1 共用；M-Form-9 另加「briefPath ≠ draftPath」自检，杜绝把正文当简报读。
- **回归测试**：新增「审 `drafts/初稿-vN.md` 时必须从上级目录的简报取拍板图位数」——**已对抗验证**：回退修复 → 用例红；恢复修复 → 绿。

### 修复：退出码撞码（此前无任何门覆盖退出码语义）

| 脚本 | 旧 | 新 | 后果 |
|---|---|---|---|
| `m-gate-check.mjs` | 定稿/证据包路径不存在 → `1` | **`10`** | `1` 的语义是「P1 内容失败」→ `final-check` 会把「路径传错」渲染成「⚠️ 存在 P1 残留，可触发 T5 修订」→ **误导主控去改正文** |
| `final-check.mjs` | 用法/路径错 → `2` | **`10`** | `2` = 「P0 致命」；且与自身推荐语声称的 `else = exit 10` 自相矛盾 |
| `build-evidence-bundle.mjs` | `--source` 缺值/不存在 → `2`（4 处） | **`10`** | 同上（fail-fast 时机不变） |
| `count-chars.mjs` | 缺参/文件不存在 → `1` | **`10`** | 同上 |
| `normalize-trust-level.mjs` | 缺参 → `1` | **`10`** | 其「有未决条目 → 1」保留（自有语义，已在头注释声明） |
| `model-routing.mjs` | 无候选 → **`3`** | **`4`** | `3` 在 M 门 =「仅 P2·soft·SKIP，**可放行**」→ 调用方会把「需人工决定」误读成「可以继续」 |

- **新增机检**：`repo-hygiene-check.mjs` ⑧「退出码表」——11 个随包脚本的 `process.exit()` 数字必须在表内声明，且表内每个码必须在脚本里以字面量出现（防表格腐烂）。**已对抗验证**（注入 `exit(7)` → 红灯；还原 → 绿）。
- **文档同步**：`docs/troubleshooting.md §8` 重写（两类撞码说明 + 非闸门工具的自有命名空间清单）、`SKILL.md` / `AGENTS.md` 的闸门留痕条、`model-routing.mjs` 头注释。

### 修复：脚本数量三口径并存（9 / 10 / 11）

- **现象**：磁盘真值 **11**；`SKILL.md:43` 白名单行 = 11 ✓，但 `SKILL.md` 另一处写「共 10 个」且漏 `token-budget`、`glossary.md` 两处写「随包 **9 个**」。旧规则 ⑩ 只核白名单那一行 → **另两处长期失真且无门可拦**（"多宿主事实"的典型代价）。
- **修法**：`SKILL.md` / `glossary.md` 三处改为**指针**（「清单与数量见 §执行能力边界 的随包脚本白名单——该行是唯一真源」）。
- **新增机检**：`consistency-check.mjs` 规则 **⑩b**「脚本计数全库对账」——任何「随包 N 个 / N 个 .mjs 校验脚本 / 共 N 个脚本 / N 个门禁脚本」断言都必须等于磁盘真值（CHANGELOG 历史段豁免）。**已对抗验证**（注入「随包 **7 个**」→ P1；还原 → 0 漂移）。

### 修复：规格 ↔ 脚本双向漂移

- **规格缺两条已实装规则**（实现有、文档无）：① M-Form-7 的**五节顺序断言**（v18.0.0 实装，错序 P1）；② M-Form-4 的**文末节二级扫描**（v18.0.0 实装，只豁免书目条目行，其余照常扫，命中 P0）。两条已补入 `references/_shared/M-Gate-Algorithm.md`。
- **反向漂移**：`M-Exist-3` 文档名为「数据信任级别一致性」并列有信任级别检查步骤，但脚本只做 **[Dxx] 正文↔数据卡 引用闭环**，**完全不查信任级别** → **门名名实不符**。处置：**改文档以匹配实现**（更名 + 声明信任级别由 M-Form-6 / G12 承担），并说明为何不新增未校准的 P0 门（风险高于收益）。

### 裁决：退化路径版本号规范矛盾（需主人知悉）

`references/_shared/degraded-scenarios.md` 原写「跳过 Phase 3.5 时 v1→v2（无变更）→ v3（T6 批判）→ v4」，与 `pipeline-readme.md` 「批判后修订版命名为 **v2**（**不跳号到 v3**）」（该规则源自 `test-paper-01` 的真实编号错位教训）**互相矛盾**。

**裁决：以 `pipeline-readme.md` 为准**——跳过 Phase 3.5 时**不产出「无变更的 v2」副本**（与 v1 实质相同的副本既无信息量，又让「v2」同时指两种东西），批判后修订版即 v2，T9/G14 修订为 v3。`degraded-scenarios.md` 已改写为指针视图并留下裁决记录。**若主人认为应保留「空 v2」双轨，请指出——本处仅文档层改动，回退成本极低。**

### 验收

| 项 | 结果 |
|---|---|
| `tests/**/*.test.mjs` | **65/65 通过**（新增 3 例：D1 回归 / 退出码契约 / model-routing 码位） |
| 反向验证 | D1 回归：回退修复 → 红；退出码表：注入 `exit(7)` → 红；规则 ⑩b：注入「随包 7 个」→ P1（均已还原并复绿） |
| `scripts/consistency-check.mjs` | exit 0（含新规则 ⑩b，0 处漂移 + `.dsh` 镜像同步） |
| `scripts/repo-hygiene-check.mjs` | 全部通过（新增 ⑧ 退出码表：11 个脚本一致） |
| `dsh-plugin-dev check` | 11 通过 / 0 失败 / 0 提示 / 3 跳过（无豁免） |
| 打包产物冒烟 | `npm pack` 解包后跑入口 + 组合包契约测试 → 通过 |

## 18.0.1 — 2026-09-11

> **本版是 18.0.0 的缺陷修复版**（npm 版本不可覆盖，故前滚重发）：修复「bundle 自注册行缺失」——
> 它使 `dsh plugin add` 装上的包里**技能根本不会被注册**。`18.0.0` 保持原样不动。

### 缺陷：patch 缺自注册行 → 入口从不被 import → 技能不注册（P0，只影响 bundle 安装路径）

- **现象**：装完 18.0.0 后，组合树里**没有一行引用本包**：

  ```
  $ dsh --profile <临时> --dump-config | Select-String 'name:\s*lunheng-article-pipeline'
  （0 命中）
  # 只有层头 "# == lunheng-article-pipeline" + 3 行 tool-subagent-{retrieval,strong,audit}
  ```

  即三档 subagent 工具装上了，但 `lib/index.js` **从未被 import** → `ctx.skills.register()` 从未执行 →
  **知识库技能不出现**（README「作为 bundle 安装（推荐）」那条路径不产出技能；「复制技能目录」那条仍可用）。
- **根因**：官方 `docs/user/develop/basic/publish.zh.md` 明确要求组合包的 patch **插入一行 `name` = 本包包名**——
  「插件行按包名而不是相对源码路径引用这个包，这样 Node 的模块解析才能找到已安装的代码」；参考包
  `dsh-plugin-guide` 正是 `- insert: [{id: dsh-plugin-guide, name: dsh-plugin-guide}]`。
  **`package.json#main` 不会因为「包被列进 profile 的 `bundles`」就自动执行——patch 里的行才是会被 import 的东西。**
  18.0.0 删掉旧的 `@deepseek-ai/dsh-skill-filesystem` 挂载行时，漏补了这一行。
- **为什么当时四道验证全都避开（值得记住）**：
  1. 官方 `dsh-plugin-dev check` 只验 patch **合法性**（行是否良构 / id 是否唯一），**不验它是否引用本包**——11 项全绿；
  2. 发布前的打包冒烟是**直接 import 入口跑 `apply`**（绕过 loader），恰好测不到「入口会不会被加载」；
  3. 当时 `--dump-config` 的 grep 命中的是**层头** `# == lunheng-article-pipeline`，不是插件行；
  4. 唯一能抓到它的检查（headless 会话「列出技能名」）当时**挂住 150 秒无输出**，被判为环境限制而略过。
  → **「装上了」不等于「装的东西被加载了」**；前者只证明包面完整，后者才证明运行期接上。

### 修复

- **`cordis.patch.yml` 补自注册行**（官方形态）：
  ```yaml
  - insert:
      - id: lunheng-article-pipeline
        name: lunheng-article-pipeline
  ```
  并重排段落编号（1 = 自注册行 / 2-4 = 三档 subagent / 5 = 说明），文件头写明**这一行不能删**及其后果。
- **新增 `tests/bundle-contract.test.mjs`（3 例，机械防线）**：
  ① patch 必须**恰有一行** `name == package.json.name`（自注册行），且其 `id` 亦等于包名；
  ② patch 行的 `name` 只能是本包名或 `@deepseek-ai/*` 核心模块（防拼写错误）；
  ③ `dsh.bundle.patch` / `main` / `skills` 三者磁盘真实存在且都在 `files` 白名单内。
  **守卫有效性已反向实测**：把同一测试文件放进**从 npm 下载的 18.0.0 产物**里跑 → **红**（命中自注册行断言）；在本仓库跑 → 绿。
- **文档与探针同步**：`SKILL.md` 第 6 条与 `AGENTS.md` 包形态段写明自注册行及其后果；`docs/installation.md` 验证预期行补
  `- id: lunheng-article-pipeline`；`docs/troubleshooting.md` 的 `--dump-config` 过滤式补本包名；五语 README 的
  Repository layout 段改为「patch 插入本包自注册行（loader 由此 import 入口）+ 三档工具」。
- **顺带补齐（同批）**：`AGENTS.md` 文件修改约束新增第 5 条 **「改动位置：一律在真源仓库做，再同步部署镜像」**
  （教训 #153——上一版在部署镜像上改脚本、绕过仓库 `tests/`，导致合入后 18 个用例红）。

### 验收

| 项 | 结果 |
|---|---|
| `node --test "tests/**/*.test.mjs"` | **62/62 通过**（新增组合包契约 3 例） |
| **守卫反向验证** | 同一测试跑**已发布的 18.0.0 产物** → 1 红（命中自注册行）；跑本仓库 → 全绿 |
| `dsh-plugin-dev check` | 11 通过 / 0 失败 / 0 提示 / 3 跳过（无豁免） |
| `scripts/consistency-check.mjs` | exit 0（版本点位全量同步至 18.0.1，含 `.dsh` 镜像） |
| `scripts/repo-hygiene-check.mjs` | 全部通过 |
| **组合树实测（发布后）** | 一次性 profile 装 18.0.1 → `--dump-config` 出现 `- id: lunheng-article-pipeline` / `name: lunheng-article-pipeline` 行；对装入副本跑 `apply` → 技能注册成功 |

## 18.0.0 — 2026-09-11

> **发布形态**：tag `v18.0.0`，由 `publish.yml` 以 OIDC Trusted Publishing + `--provenance` 发布到 npm（dist-tag `dsh`）。
> **包含两个迭代**：`17.0.0` 从未单独发布——它的内容（版本号方案迁移 + 11 批机检可信化改动 + 端到端测试反哺的 6 处修复）随本版**首发**，历史记录保留在下方 `## 17.0.0` 段。

**本次发布完成三件事**：① 包形态升级为**官方插件形态**（包入口 + `dsh.bundle.patch`），并把打包面检查的两条历史豁免**清零**；② 把仓库文档与**实现对齐**（此前若干文档仍在描述已被替换的挂载机制）；③ 修复 M 门与自检脚本中使机制长期空转、误报或结构性失效的缺陷。

### 新增

- **包入口 `lib/index.js`**（本版核心）：
  - `inject = ['skills']` + `apply(ctx)` 内经 `ctx.effect(() => ctx.skills.register({ … }))` 注册技能（**注册即 effect，卸载自动清理**；官方检查项 `redline-effect-registration` PASS）；
  - `resourceBase: { kind: 'directory', path: <包根>/skills/lunheng-article-pipeline }` —— `references/**`、`scripts/**` 的相对引用在**任意 cwd** 下可解析（渐进披露）；
  - 不 import harness 任何模块 → `@deepseek-ai/dsh` 保持 **optional peer**（检查项 `manifest-peers` PASS）；入口放在 `files` 白名单内的 `lib/`（检查项 `manifest-files` PASS）。
- **`package.json` 补齐包元数据**：`main` / `type: module` / `files` 含 `lib` / `packageManager: pnpm@11.7.0` / optional `peerDependencies` / `scripts`（`check:consistent` · `check:surface` · `check:hygiene` · `test`）。
- **根 README 五语**：`README.md` 改写为**英文源**，新增 `README.zh.md` / `README.es.md` / `README.pt.md` / `README.hi.md`（12 个 `##` 标题跨 5 语一致，检查项 `readme-five-langs` + `readme-consistency` PASS）；退役 `README.en.md`（英文门面由 `README.md` 承担，避免同一语言两份门面）。
- **`tests/entry.test.mjs`**：用最小 ctx **真执行 `apply`**，断言注册字段（name/source/description/whenToUse/content/resourceBase）与 `resourceBase` 下 `SKILL.md` / `references/` / `scripts/` 齐备，并校验「frontmatter 已剥离且正文与 SKILL.md 正文段逐字一致」。**为什么必要**：包面静态检查不执行入口，「入口 import 得动但 apply 一跑就崩」只有运行时能发现（教训 #152）。
- **`references/_shared/规范-机械门对照表.md`**：逐条勾稽「文档层规范 ↔ 机械门覆盖」，含仍无机械门的 10 项及其人工责任点。
- **`references/_shared/DSH-集成方案.md`**：`defineTool` 注册门禁脚本 / `workflow` 工具接管 Phase 内并行 / DSH 服务映射的契约、示例与边界（**默认未启用**，启用前须知见文档）。
- **`references/glossary.md` §十二**：本技能自用术语（9 个）的**确切含义**与**「不是什么」**，以及与官方文档规范的**刻意偏离**逐条声明（理由 + 代价 + 维护者规则）。
- **`AGENTS.md`「开发参考资料」节**：官方资料入口对照表 + 官方 CLI 机械层 + 冲突裁决顺序（官方 > 本包 > 其他）+ 何时必须查官方资料。
- **`SKILL.md` frontmatter `whenToUse`**：路由边界（不适用场景 / 人在环成本 / 时长预期）从 `description` 迁至官方可选字段（已读实现核实 `dsh-skill-filesystem` 读取该键），`description` 相应精简。
- **教训 #145–#152**（`references/memory/lessons.md`）：exit 字段双语义 / 目录布局假设 / 正式编号被误判 / 报告落盘激活 N/A 门的时序效应 / 名实不符以工具链失败暴露 / 白名单剥离使文末节成免责区 / **BOM 污染** / **入口路径回归**。

### 修复

- **M-Form-3 误判正式编号为「临时编号」→ M 门永不可能 exit 0**（P0）：正则排除 glossary §三 基线编号 `[D-基-x-NN]` 与空卡标记 `[C-空]`。
- **M-Integrity-1 在 Phase 4 场景静默失效**（P0）：简报路径由「只对 `final/定稿.md` 生效的字符串替换」改为**向上查找** `01-任务简报.md`；解析到被审正文自身即 `exit 10`，不再静默降级。
- **M-Form-4 白名单剥离使文末四节成为免责区**（P0）：新增**文末节二级扫描**（仅豁免以数字/基线编号开头的书目条目行，`[C-空]` 行不豁免）。
- **M 门路径传参陷阱**：证据包缺 `数据卡.md` / `文献卡.md` → **stderr 显著告警 + 给出正确用法**（旧版静默产出 8 个假 P0）。
  > **发布前据随包回归用例修正（值得单独记）**：本项最初实现为「缺卡 → `exit 10` 中止」，本机自测通过、文档也照此写了；合入仓库后 `node --test` 立刻红 **18 个用例**——因为**中止会让调用方拿不到任何 JSON**，而本包契约是「**缺卡记 N/A、0 条场景合法**」，且证据包在 `build-evidence-bundle.mjs` 跑之前本就是空目录。现改为**告警不中止**，并把这条判据写进 `M-Gate-Algorithm.md` 与 `SKILL.md`。教训：**「本机自测通过」不等于「契约兼容」**——只在部署副本上改脚本、没跑仓库回归用例，就会把这类跨契约冲突带到发布口。
- **`consistency-check.mjs` 在「技能即包根」部署下完全不可用**（ENOENT）：`REPO_ROOT` 由硬编码「向上两级」改为**双布局自动探测**；「仓库级文档版本头」检查按布局分流（旧版在技能即包根布局下产生 3 条假 P0）。
- **M-Form-7 只核成员资格、不核顺序**：加**五节顺序断言**（错序判 P1）。
- **M-Form-5 禁词表列全词 → 「承重证据」漏网**：改「承重」前缀匹配 + 补内部术语。
- **M-Exist-8 只认「行首即编号」→ T6 的段级条目计 0 条**：放宽为「行首编号 ∪ 列表项 ∪ 标题式」。
- **M-Form-11 漏计 `[D-基-x-NN]` 与 `[先NN]`**：统一素材编号正则 + 纳入 `先行者清单.md` 为卡片真源。
- **`final-check.mjs` 推荐语分档**：旧版只处理 exit 0/1，其余落 `else` → **exit 3（仅 P2）被误报「存在 P0 致命问题」**；现按 0/1/2/3/10 五档给建议，且 exit 3/10 不再当失败。
- **M-Exist-5 自引用循环**：报告重跑覆写会冲掉 T8 裁定段 → 改为写入时**保留** `_t8_llm_review` / `_t8_conclusion`，且 M-Exist-5 **优先采信 T8 裁定段**。
- **`token-cost.mjs` 加 `--project <dir>` 模式**：从项目日志（`agents-log.md` / `status.md` / `01-任务简报.md` / `审计视图-v0.md`）自动提取会话 ID——交付说明的「成本指标」此前**结构性填不上**（主控拿不到 session id）。
- **文档与实现对齐**（此前若干文档仍描述已被替换的挂载机制）：`SECURITY.md`（`!!js` 处数 7 → **3**，脚本数 9 → **11**，信任边界补入口面）、`docs/faq.md`（dshmarket 误报、`!!js` 披露、版本号表）、`docs/architecture.md`（挂载机制）、`docs/installation.md`（验证预期行、删掉「复制预设目录」步骤）、`docs/troubleshooting.md`（技能缺失排查改为按入口路径排查）、`examples/preset/README.md`（`!!js` 单表达式写法与「未设即继承」语义）、`CONTRIBUTING.md`（删掉与自身「禁止本地 `npm publish`」相矛盾的本地发布步骤）。
- **批量改版踩到的两个真缺陷**（若跳过打包产物冒烟会带病发布）：**#151 BOM 污染**（批量版本号替换给 57 个文件写入 BOM → `package.json` 无法 `JSON.parse`）；**#152 入口路径回归**（入口移入 `lib/` 后未同步调整相对路径 → `readFileSync` ENOENT、技能注册失败，而当时两个静态门全绿）。

### 变更

- **`cordis.patch.yml` 只保留 3 段 `- insert:`**（技能挂载行删除）：技能改由包入口注册后，原先「插入 `@deepseek-ai/dsh-skill-filesystem` provider + `customSkillDirs` + `!!js` 路径求值」整段移除 → **加载期 `!!js` 由 4 处降为 3 处**（只剩三段 `agentOptions`），且不再依赖内部包名 `@deepseek-ai/dsh-skill-filesystem`，表达式面只剩 `process.env.*` + 全局 `Object.assign`。
- **打包面豁免清零**（`scripts/plugin-surface-check.mjs`）：历史两条豁免（`manifest-main`「无入口」、`manifest-files`「无 lib/dist」）**来源消失，全部删除**；脚本在空白名单下保持 fail-closed，并新增「本次无豁免」提示。
- **M 门 exit 语义显式化**：`M-Gate-Report.json` 须含 **`script_exit_raw`**（脚本机械原值，禁改）+ **`exit`**（T8 裁定值）；两者不同时须附**证伪证据四件套**与 `_t8_conclusion`；并明确「**脚本是筛子不是判别器**」（实测约 45% 命中需人工修正）。
- **素材卡机检硬格式**写入四份 `*-lite` 模板（索引段标题 / 条目标题 / 信任级别行档位词不加粗 / 总条数只声明本类）——消除「模板人读、脚本机读」的格式返工。
- **交接报告模板**强制产物三要素（路径 + 字节数 + 结构自检结果），防「写盘前失败」。
- **`AGENTS.md` 机制文件写保护**补「**唯一例外：主人显式授权**」+ 5 条安全流程（判据：agent 自发改进 = 禁写；主人明确下令 = 可写）。
- **`SKILL.md` 启动清单**改为三层（必读 3 项 / 按需读 / T7-T8 阶段读）；**技能来源自检**引用**官方 rank 表**（`project-dsh` 100 → `bundled` 600）。
- **`glossary.md` 版本号管理**澄清：frontmatter `version` **不在官方 5 键契约内**（落入 `metadata`），不得假定其他 DSH 组件读取；下游工具应读 `package.json#version`。

### 验收

| 门 | 结果 |
|---|---|
| `dsh-plugin-dev check`（官方 14 项静态门） | **11 通过 / 0 失败 / 0 提示 / 3 跳过**，**无豁免**（本版前为 6 通过 + 2 豁免 + 2 提示） |
| `scripts/consistency-check.mjs`（文档 21 类漂移 + `.dsh` 双写同步） | **exit 0**——0 处漂移（含 `.dsh` 镜像回填与仓库级条目清理） |
| `scripts/repo-hygiene-check.mjs`（语法/JSON/YAML/行尾/UTF-8/发布包面） | **全部通过** |
| `node --test "tests/**/*.test.mjs"`（随包脚本 + 入口回归） | **59/59 通过**（含新增入口 2 例；修复期一度 18 红——见「M 门路径传参陷阱」条的发布前修正） |
| 打包产物冒烟 | `npm pack` 解包后 import 入口并真执行 `apply` → 注册字段与 `resourceBase` 全部正确 |
| 端到端实战回归（本版前一轮） | 6000 字哲学论文全流程：M 门 `pass 18 / P0 0 / P1 0 / P2 4`；T9 审稿 23/30 minor revision |

## 17.0.0（未单独发布 —— 内容随 18.0.0 首发）— 版本号方案迁移：`2.5.2-dsh.N` → `N.0.0`（+ 机检可信化与成本可实测的 11 批改动）

> **本版未单独发到 npm/GitHub**（`npm` 上当时的已发布版 = `2.5.2-dsh.17`）；其全部内容随 **`18.0.0`** 首发，故各文档版本头最终写的是 `v18.0.0`。以下原文保留当时的「发版计划」，仅作为决策记录。

### 为什么改：npm 强制 semver，`dsh.17.0` 这种形态**发布不了**

主人提出「以后版本号能不能写成 `dsh.17.0`，去掉前面的 `2.5.2-`」。**实测结论：字面不行** —— 用 `npm publish --dry-run` 逐形态验证：

| 版本形态 | npm 判定 |
|---|---|
| `dsh.17.0` | ✗ **`npm error Invalid version: "dsh.17.0"`** |
| `dsh.17.0-beta` / `dsh17` | ✗ 拒绝 |
| **`17.0.0`** | ✓ 接受 |
| `0.17.0` | ✓ 接受（但 `0.x < 2.x` → 对已装用户是**降版**，`^2.5.2` 范围也匹配不上 → **不采用**） |
| `17.0.0-dsh.17` | ✓ 接受（prerelease 排序低于同号正式版，且数字 `17` 重复 → 不采用） |
| `17.0.0+dsh.17` | ✓ 接受（build metadata 不参与排序 → 同号不同 build 视为同版本，易踩坑 → 不采用） |

**根因**：semver 要求 `major.minor.patch` 三段必须是数字，`dsh` 这类标识只能出现在 `-`（prerelease）或 `+`（build）之后。**故 `2.5.2-` 这段数字前缀去不掉，只能改它的取值。**

### 新方案（v17.0.0 起）

- **`<迭代号>.0.0`**：本版 = `17.0.0`；下一轮迭代 = `18.0.0`；同一轮内修补 = `17.0.1`；同一轮内小步改进 = `17.1.0`。
- **单调递增 ✓**（`17.0.0 > 2.5.2-dsh.17`，不会让已装用户看到「降版」）。
- **「dsh 通道」身份由 npm dist-tag `dsh` 承载**：`npm i lunheng-article-pipeline@dsh` 语义不变（`latest` 仍指最新稳定版）。
- **发版 = tag `v17.0.0`**（publish 工作流的「tag 必须等于 `v` + package.json version」校验照旧生效）。
- **版本头约定**：未发布期间写「（DSH 原生插件，尚未发布）」，发版时改为「（DSH 原生插件，发布于 <日期>）」。
- **功能注解不追溯改写**：`（v2.5.2-dsh.17 补）` 这类注解记录**当时**的版本号，历史保持原样；本版起新注解用 `v17.0.0`。两条版本线（**包版本** vs 文档里的**上游规约版本线**，如 `references/pipeline-readme.md` 标题的 v2.2.14）互不相干。

### 迁移范围（本版已做）

- **版本声明处**：`package.json` / `SKILL.md`（frontmatter + 版本头 + 正文版本行）/ `cordis.patch.yml` 头 / 全库 45 个文档版本头 / `README.md`·`README.en.md` / `docs/introduction.md`（版本头 + 「当前版本」+ 安装 pin）/ `examples/preset/README.md` 安装 pin —— 共 **63 处**，全部改为 `v17.0.0`。
- **`consistency-check.mjs` 的 10 处版本正则**改为**共享形态真源** `SEMVER`（`\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z.]+)?`）：
  - ① **同时兼容历史 `2.5.2-dsh.N`**（CHANGELOG 历史段、旧注解、旧 pin 里都还有）；
  - ② 每段限 `\d{1,3}`，**排除 `2026.09.11` 这类日期串**被误当版本号；
  - ③ 形态由**一处派生**，后续换方案只改这一个常量（旧版 10 处字面量各写一遍，是典型的「规范一改就要同步十处」）。
- **规则 ⑫ 新增「上游规约版本线」豁免集** `UPSTREAM_SPEC_VERSIONS`：迁移后包版本与上游规约版本（`2.2.14` 等）在形态上不再可分，故显式登记（新增该类标题须登记一行）——**这是把「隐式靠后缀区分」换成「显式白名单」，而不是放宽检查**。

**验证**：`consistency-check` 0 漂移（65 个 .md）｜`repo-hygiene-check` 通过｜`tests` **51/51**｜`plugin-surface` 通过。

### 顺带修掉一个真实副作用：安装文档不得把「未发布版本」当唯一入口

迁移后 `package.json` 已是 `17.0.0`，而**安装 pin 被规则 ⑧/⑬ 要求等于 package.json version** —— 于是 `examples/preset/README.md` 的安装命令变成 `…@17.0.0`，可这个版本**还没发到 npm**（照抄会 404）。而这两条规则的**原意正是「防安装文档指向未发布版本」**。

处置（不改规则、只改文档写法）：

- **首选入口改为 dist-tag**：`dsh plugin --profile web add lunheng-article-pipeline@dsh`（dist-tag 永远指向已发布版，**不可能指向未发布版本**）；
- **锁定版本降为备注**并标注状态：`# 锁定具体版本：…@17.0.0 （v17.0.0 发布后可用；当前 npm 已发布版 = 2.5.2-dsh.17）`；
- `docs/introduction.md` 同样改为「`@dsh` 为首选 + 锁定版备注」。

> **经验**：版本号一改，「当前开发版本」与「当前已发布版本」就分叉了——凡是**给用户照抄的命令**都必须走 dist-tag，而版本号声明（版本头 / 当前版本 / package.json）走具体版本。这条已写进 `CONTRIBUTING.md` 的版本号约定段。

### 端到端测试反哺：6 处机检假阳性 / 窄口径修复（同属 v17.0.0 未发布）

**背景**：主人要求「测试跑一下写论文」。做法是在 `E:\HERNESS\run\论衡M门自省\` 建一个**完整的测试项目**：按 Phase 0 → 5 逐角色写出全部产物（任务简报 → 三卡 → 大纲含 §11 → 定稿 + 素材加载清单 → 批判报告 v1 → 审计报告 v1 + 修订说明 v2 → 审稿报告 v2 → 交付说明 + 两张闸门记录），再用 `final-check` 串联真跑脚本。**这是流水线机械部分的端到端测试**：产物能不能产出、契约能不能对上、脚本能不能跑通（无法从本会话派发 DSH 子代理，故角色卡内容由主控按各 T 卡契约代写 —— 内容质量不可机测，契约与脚本可测）。

**首轮结果：M 门 22 项 pass 11 / P0 4 / P1 3 / P2 4（exit 2）**。逐项拆解后发现：**6 项不通过不是 fixture 的错，而是机检自身的缺陷**——本轮全部修复，最终 **pass 21 / P0 1 / P1 0 / P2 0**（详见下）。

- **① 缺「字面量剥离」→ 论文里被讨论的编号/占位符被当成真实引用**：技术类正文必然出现「**被讨论的**编号与占位符字面量」（例：说明 `[待补]` 这种占位符、代码里的 `??` 运算符、写明「排除合法形态 `[C-主01]`」）。实测旧实现把 `??` 判成「连续问号占位」（P0）、把 `[C-主01]` 判成「正文有、文末无」的孤儿引用。修复：新增 `stripCodeSpans()`，**引用闭环（M-Form-1/8、M-Exist-1/3）与占位符机检（M-Form-3）前先剥离围栏代码块与行内反引号**。**M-Form-4 不剥离**——代码块里写 `scripts/`、`m-gate-check.mjs` 同样是泄露（该规则实际正确地把内部复盘体裁判为 P0，属设计意图）。
- **② M-Form-8 承重墙锚点不认结构信号 → 误报超载**：旧实现用 `/承重墙/` 全行匹配，于是命中**散文里的「承重墙」三字**（我写的禁做项列表：「不出现…承重墙…」）→ 该行非标题 → 走「猜后续 60 行」兜底 → 把论点-论据映射表也当成清单 → 同一编号 ×3 → 误报「承重墙超载」。修复：锚点只认**标题行**或**含「承重证据 top1」标记的行**；行内锚点只取紧随的连续表格/列表行（不猜固定行数）；结构性行**同时**要求「行内有编号」+「行内带论点N 标记」。
- **③ M-Exist-8 把「关闭状态」清单判成重复定义**：06 卡模板要求「批判总结」里逐条列一次「关闭状态」（`- [P0-C1-1] ✓已关闭（…）`），而旧实现按**全文出现次数**判编号唯一性 → 模板要求的重述被误判「编号重复」P1。修复：只统计**条目定义行**（行首即编号且不含已关闭/未关闭/待复核）。
- **④ M-Exist-9 三处窄口径**：(a) 结论词表漏 `✓`（审计报告惯用「**通过** ✓」）；(b) 报告里 `G0` 会**两次**出现（节标题 `## G0 覆盖度` + 条目行 `- **G0**：…`），旧实现「取第一个命中行 + 三行窗口」→ 窗口落在节标题上 → **实据必然为空** → 实测 **14 项**被误报「结论无实据」；(c) 实据量词表缺 `节/章/页/周/月` 等（「10 节齐全」判不出实据）。修复：结论词补 `✓/✗`；**逐命中行各取三行窗口、结论与实据分别在任一窗口成立即可**；量词表扩容。
- **⑤ M-Exist-10 字数预算要求同行有数字**：`### 字数预算` + 换行后「2500–3000 字」的常规写法被误判「未见数字」。修复：允许标题后换行再出现数字。
- **⑥ `final-check.mjs` 步骤顺序导致 M 门读陈旧证据包**：旧顺序 `count-chars → m-gate-check → build-evidence-bundle`，于是 M 门读到的证据包是**上一次**收集的副本——实测文献卡在项目里已更新到 4 条，而证据包副本仍是 2 条 → M-Form-10 报「头部声明 2 条 ≠ 正文条目 1 条」。修复：**证据包刷新排在 M 门之前**（`count-chars → build-evidence-bundle → m-gate-check`），并同步 08 卡与 status 模板的顺序描述。

**残留 1 项 P0 是设计意图，不修**：**M-Form-4 元数据泄露**（命中 `主控` / `scripts/` / `m-gate-check.mjs` / `consistency-check.mjs`）。该稿**主题就是论衡内部机制**，必然引用内部路径 —— 而 M-Form-4 的存在意义正是「论文不得含内部代号」。**结论：论衡的交付契约面向「对外读者文章」（学术/商业评论/行业分析/公众号），「引用内部路径的内部工程复盘」是范围外体裁**；要发这类内容只能改写为「对读者版」（去掉内部路径），或走仓库自身的 CHANGELOG/文档而非论衡交付物。

**验证**：`consistency-check` 0 漂移（65 .md）｜`repo-hygiene-check` 通过（99 文件 / 11 脚本）｜`tests` **57/57**（新增独立文件 [`tests/e2e-feedback.test.mjs`](tests/e2e-feedback.test.mjs)：6 个端到端反哺回归用例，逐条对应上面 6 处修复）｜`plugin-surface` 通过｜端到端终检 **pass 21 / P0 1（设计意图）/ P1 0 / P2 0**。

## 2.5.2-dsh.17（2026-09-11）— 机检可信化 + 成本可实测（11 批）

### 交接链路修订（v2.5.2-dsh.17 发布）

**背景**：一次「论衡各环节交接是否顺畅」的专项审计（产出→消费矩阵 + 契约文本逐条核对）发现 **9 处「文档宣称 ≠ 实际能跑通」**，其中 3 处会让下游直接读不到/读错文件。本批全部修订，且**刻意不发版**（按主人指令：先合入 master，等下次发版一并发出）。

- **① 契约对齐（3 处断链 + 1 处幽灵条目）**：
  1. **「写手版精简段」位置三方冲突**：05 卡 + `pipeline-readme` 曾写独立文件 `analysis/写手版-精简段.md`，而 04 卡 + 派发卡早已是「大纲**末尾 §11**」、证据包也只收 `分析大纲.md` → 按卡找不到文件就会**回退整读大纲**（正是要根治的 50K 上下文；实测 T5 cacheRead 占子代理总量 76%）。**统一为「`analysis/分析大纲.md` 的 §11，同一文件、非独立文件」**（05 卡 / pipeline-readme / 04 卡 / 派发卡四处同步）。
  2. **报告版本号 `v{N-1}` 是错的**：`09-审稿-peer-reviewer.md` 与 `中文AI痕迹-checker.md` 曾按 `v{N-1}` 找批判报告/G14 检测报告 → 会去查不存在的 v0，导致漏检或误报。**定案：报告类产物版本号一律 = 被审正文（初稿）轮次**（`初稿-v2` ↔ `批判报告-v2` / `审计报告-v2` / `复核报告-v2` / `G14-检测报告-v2` / `审稿报告-v2`），写入 `pipeline-readme` §退化路径版本规则并加机械守卫。
  3. **证据包硬编码 `-v1.md`**（批判/审计/复核/反哺/审稿报告）：修订轮（v2/v3）报告**根本不进证据包**，审计视图还会误显示「审计✗/批判✗」。改为**「取最大版本」解析**（与 `M-Gate-Algorithm` §M-Integrity-2「N 取最大」同口径；同文件里「修订说明」一直用的 glob ✓ 属漏改），**并顺带收录此前完全没收的 `G14-检测报告-vN.md`**；视图的报告行现在带实际版本号（`审计报告v2✓`）。
  4. **`audits/复核报告-vN.md` 是幽灵条目**：证据包与视图一直在找它，却**没有任何角色声明产出**（每次运行都显示虚假「复核✗」）。**把产出者定为 T7**（修订轮必产，逐条列「原条目 → ✓已关闭/✗升级 P0 → 依据」）；无修订轮时视图改标 **N/A(无修订轮)**，不再虚假告警。

- **② 占位符语义恢复（21 处）**：DSH 迁移把 shell 片段扫成「（命令已剥离·DSH 用 read 推理）」后语义被剥空，其中 **`交接报告-template-lite.md` / `任务简报-template-lite.md` 的「位置」字段（交接产物落盘位置）**、`G14检测报告/审稿报告-template` 的「归档到 …」路径、**`errors.md` 整张对照表的 9 个「友好版」**、`任务简报-template.md` 一条**禁令的主语**、`数据卡-template.md` 4 处格式行、`字数判定表.md` 核验方法、`case-studies.md` 2 处均已按**有意义的中文/路径**恢复（**不还原 shell 命令本身**——DSH 策略是发布包内 shell 示例按「人类 host shell 验证示例」处理，改为指向白名单脚本）。另把 `errors.md` 三处「（检查 [Dxx]）」这类无信息量提示改写成可执行建议。

- **③ 模板与双轨口径**：`交接报告-template.md` 第 6 项由「status.md 对应行**已置为** Review/Done」改为「**建议变更，由主控执行**」——旧写法与 `AGENTS.md`「status.md 主控独占写」直接冲突（正是 dsh.5 拆双轨要消除的并发写风险）；`pipeline-readme` 的「status.md 状态机」段同步纠正。**定清双轨**：① **交接报告 = 回报本身**（六要素，回给主控的消息，≤10 行，不单独落文件）；② **`agents-log.md` = 落盘的中断续接快照**（四要素，≤5 行）；删掉「或角色专属交接文件」这类含糊口径（不再有第三个交接文件）。

- **④ 机检补强（把这次的审计矩阵固化成规则）**：
  - **④b 占位符零容忍**：「命令已剥离」残留 → P1；
  - **⑲ 交接契约表**：16 个产物的「产出者声明 + 下游读清单/证据包引用」逐条机检（键用版本无关族名，避免误报）——**正是「文档说有人读、实际读不到」这类断链的守门人**（dsh.15 审计视图、本批批判报告/复核报告都属此类）；另加两条守卫：**版本化报告不得写死 `-v1.md`**、**报告版本号不得写 `v{N-1}`**；
  - T7 独立研读清单补「批判报告-vN」（关闭 T6 条目要用它逐条核对；派发卡同步）。
  - 规则头注释同步为 **21 类漂移**（本批 20 类；第 21 类 ⑳ 见「M 门文档自洽机检」批）。

**验证**：`consistency-check` 0 漂移（57 个 .md）｜`repo-hygiene-check` 通过（89 文件/9 脚本）｜`tests` **27/27**（新增 3 例：版本化报告取最大、无修订轮 N/A、④b+⑲ 注入负向）｜`plugin-surface` 通过。

### 模型分层：能力档探测与「角色→模型」匹配（同属 v2.5.2-dsh.17 发布）

**背景**：主人要求「论衡自动检查 DSH 的模型、检测是否可用、并按角色卡所需的能力匹配合适的大模型」，并给出**四档能力表**（检索/分析写作/批判审计/主控，T8 不适用）。此前机制是「装分档预设 + 手填 3 组环境变量」，且**默认值是厂商硬编码**（`deepseek-v4-flash`/`deepseek-v4-pro`）。

- **① 立论依据（三条均实测/源码复核，均写入 `references/_shared/模型路由.md`）**：
  1. `cordis.patch.yml` 的 `!!js` **只能取 env/baseUrl**（CI 红线 ⑭ 禁 `fs.`/`node:`/import）→ **加载期探测不到模型目录**，探测只能由脚本做；
  2. 宿主**没有模型级回退**（`dsh-llm-retry` 只做请求重试）→ **写死一个本机不存在的模型 = 该档工具直接不可用**；本机实测默认模型是 `minimax-cn-openai / MiniMax-M3`（**不是 DeepSeek**），任何厂商默认值都是错的；
  3. `dsh-subagent.resolveChildAgentOptions` 为**逐字段合并**（provider/model 各自继承父级）→ **只给 `model` 也能生效**。
- **② 新增第 10 个随包脚本 `model-routing.mjs`**（只读；不写任何文件、不读/发任何 API Key）：
  - 解析 `<DSH_HOME>/settings.yaml` 得到 provider×模型目录与 `agent-default-model`；**默认自动探测本地 provider**（仅回环地址、3s 超时、零外发），以本机实际广告模型为准补充候选池；
  - 按**主人指定的四档表**输出路由：**检索 T1/T2/T3**（便宜快；**默认本地 Ollama + 远程兜底**）/**分析写作 T4/T5**（强推理）/ **批判审计 T6/T7+T9**（顶配，不得降档）/ **主控 T0**（不参与路由，只给稳定性建议）/ **T8**（不适用）；
  - 输出**兜底链**（主选本地时给出远端兜底）、候选列表、置信度、可复制的 env 片段（同 provider 只给 `_MODEL`，**跨 provider 自动补 `_PROVIDER`**）。
  - 启发式修正（首跑实测踩坑）：`MiniMax` 内含 `mini`/`max` → 必须用**词边界**，否则同族模型同时被判定「便宜」与「强推理」；本地模型**不按命名判「快」**（本机算力决定）；族内版本号做档位内偏好（检索偏好低版本、审计偏好高版本）。
- **③ `cordis.patch.yml` 三档改写（安全性 + 可用性）**：`agentOptions` 改为**单表达式**——**未设任何 `LUNHENG_*` → 整块 `undefined`**（不传空对象，避免无谓触发 provider 的 `agentOptions` 能力门）；**字段独立**（只给 `_MODEL` 即生效）；新增**一键退路 `LUNHENG_TIERING=off`**；**删除全部厂商硬编码默认值**。`!!js` 数量 7 → **4**（1 路径 + 3 档），执行面披露同步更新。
  - **agentOptions 取值语义首次实测**（此前从未验证）：用宿主 `@deepseek-ai/schemastery` 3.18.2 + 与 Config 同构的 schema —— `{provider: undefined, model: undefined}` ✓ 通过（规范化为 `{}`）、**只给 `model` ✓ 通过**、整块 `undefined` ✓ 通过。→ 结论：原形态**能加载**（无 P0 缺陷），新形态更稳。
- **④ 口径与文档**：`AGENTS.md` 模型分配段重写为四档表 + 兜底链 + 「禁止写死厂商默认」；新增单一真源 `references/_shared/模型路由.md`（四档表含**主人原表逐条**、能力维度判据、用法、**兜底链**、为什么不开原生 per-call、验证与证据）；`docs/troubleshooting.md` 新增 **§15**；白名单口径 **9 → 10**（SKILL.md 两处 / QUICKSTART / 主控卡 shell 边界 / `repo-hygiene-check.mjs` 断言 + 发布面提示）。
- **⑤ 原生「按调用选模型」的结论（不改默认行为，写明理由）**：宿主的 `modelSelectionSettings: true` 确实会加上 `provider`/`model`/`reasoning_effort` 三个按调用参数并注册 `list_subagent_models`，但开启需**宿主侧 `subagentModelSelection` 服务 + 工具行位于 Agent/preset scope**，缺任一项**加载期抛错**；宿主 standard 的 `subagent` 行默认未开（本会话工具清单里确无 `list_subagent_models`）。→ 论衡**不默认开启**（否则在不支持的宿主上装了即坏），并把它列为「将来若 DSH 设为默认再启用」的候选。

- **⑥ 主人两点确认已写入机制（2026-09-11，成为不可反复的事实）**：
  1. **T9 与 G14 归「批判审计」档**——主人给出的四档表未单列二者，已确认按「防漏判」原则同档（T9 是独立于写手的对抗性质量闸；G14 是可触发修订轮次的闸门）。文档与脚本中的「推断」措辞已改为「主人确认」，`model-routing.mjs` 的 audit 档角色列表为 `T6/T7/T9/G14`；并注明**若今后要省钱，最合理的降档对象是 G14**（风格识别而非事实核验），但须主人显式同意。
  2. **维持「不默认开启原生 per-call 选模型」**——理由是「装了不坏」优先于「少一步手工」；等 DSH 把它设为默认、或宿主明确具备 `subagentModelSelection` 服务后再评估。
- **⑦ 路由表落盘与遗留项收口**：新增 `templates/模型路由表-template.md`（Phase 0 由主控按脚本结论落 `run/<项目>/模型路由表.md`：本机实况 / 四档主选与兜底 / **是否已启用** / **回退留痕表**），并登记进交接契约表（⑲）+ 主控卡职责 + 运行手册；`token-cost.mjs` 补 **`-h/--help`**（exit 0）与「未知参数附打印用法」——**清掉自 dsh.15 起的遗留项**；测试新增相应断言（含 T9/G14 归属、模板存在、契约登记、帮助行为）。

**验证**：`consistency-check` 0 漂移（**62** 个 .md）｜`repo-hygiene-check` 通过（**95** 文件 / **随包脚本 10 个**）｜`tests` **30/30**（新增 2 例：三档表达式形态 6 项断言 + 路由/跨 provider/兜底/四档归属断言，并抓出并修复「`agent-default-model` 块未退出导致吞掉后续顶层键」的解析真 bug）｜`plugin-surface` 通过。


### 审计条目闭环机检（M-Exist-4；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：07 卡早已规定「打回修订必须附**结构化修订任务书**（编号/严重度/改哪里/怎么改/验收标准/关闭状态）」并要求「验收标准必须**可机械检查**」——**但没有任何脚本校验它**；且上一批引入复核报告后，「关闭状态」出现**双真源**（审计报告的表列 ↔ 复核报告），正是旧版「T5 声称已处理 vs T7 实测未关闭」歧义的结构性根因。

- **① M 门新增 M-Exist-4 审计条目闭环**（M 门 **15→16 项**；脚本机械项 **14→15**）：
  - 结论**非打回**（含「通过」）→ 不要求任务书，只做闭环项（**避免误报**）；
  - 结论为打回 → 必须存在「## 修订任务书」段 + 表头含六列，否则 **P1**；
  - 逐行校验：**编号唯一**（`P0-n`/`P1-n`，跨轮新增须**续号**不得复用）→ 重复 **P1**；编号格式不合约定 → P2；「改哪里 / 怎么改 / 验收标准」空缺或过于笼统（去空白 <4 字）→ **P1**；「关闭状态」非固定词 → P2；
  - **初轮（无复核报告）却标「已关闭」→ P1**——**关闭状态的真源是复核报告**，初轮只能填「待复核」；
  - **闭环对账**：复核报告必须覆盖审计报告的全部编号（缺 → P1）；已有 `drafts/修订说明-*` 却无同号复核报告 → P1（修订复核必须落盘）；
  - 无审计报告 → **N/A**（未进入 Phase 4）。
- **② 接线与真源声明**：07 卡补「**编号与真源规则**」（连续唯一编号 / 跨轮续号 / 关闭状态真源 = 复核报告 / 验收标准必须可机械检查）；05 卡补「**编号必须与审计任务书一一对应**」（段级 diff 清单与修订说明都要**逐条列全编号**，漏条 = 该轮视为未回应）；T7 速查表补 M-Exist-4 交叉引用；`M-Gate-Algorithm.md` 新增 **M-Exist-4 定义段**（判定伪代码 + 真源声明 + 触发时机）。
- **③ 口径收口**：M 门 15→16 项、M-Exist 3→4 项、机械化 14→15 项（**18 个文件**）；补齐「M-Exist 1-3」这类**范围写法**与**枚举清单**（M-Form 枚举补索引段、M-Exist 枚举补审计条目闭环）；并给规则 ⑥b **新增两条派生校验**——「M-Form 形式合规门（**N 项**）」这类**中文括注写法**此前漏检（T7 速查表就漂成 9/3 而未被发现）。

**验证**：`consistency-check` 0 漂移（**62** 个 .md）｜`repo-hygiene-check` 通过（**95** 文件 / 随包脚本 10 个）｜`tests` **32/32**（新增 M-Exist-4 **六条断言**：无报告 N/A、完整任务书+复核覆盖通过、初轮预填「已关闭」报错、编号重复+字段空缺报错、有修订说明无复核报告报错、结论通过时无需任务书）｜`plugin-surface` 通过。

### 素材卡索引段机械校验（M-Form-10；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：T5 上下文占 cacheRead **76%** 的根治此前只做了一半——大纲 §11 精简段 + 段级 diff 已就位，而「**先读素材卡索引段、按编号定位、禁止整卡通读**」这条纪律**只有口头要求、没有机械校验**。三张卡模板自己写着「索引段编号必须与正文条目一一对应（**一致性自检可加**『索引编号 = 实际编号』校验）」——**这条校验一直没加**。

- **① M 门新增 M-Form-10 索引段完整性**（M 门 **14→15 项**，脚本机械项 **13→14**）：对 `文献卡.md`/`数据卡.md`/`案例卡.md` 逐张对账「**索引段编号 ↔ 正文条目编号 ↔ 头部声明条数**」：
  - **索引缺条 → 硬（P1；合计 >2 条 → P0）**——索引缺条 = 下游按索引定位会**静默漏卡**，最终以「漏引 / 孤儿」（M-Form-3 / M-Exist-1）的形式在审计阶段才爆出来，返工代价最高；
  - 索引悬空（正文无此条目）、索引行信息量不足（去掉编号 <6 字）→ **软（P2）**；
  - 头部声明条数不符（best-effort 解析）→ 硬（P1）；
  - **卡片缺失只记备注、不判失败**（0 条场景是合法协议）；
  - 卡片路径：优先证据包，缺失时**自动回退** `<项目>/literature|data|cases`（便于 **T2.5 闸门**提前跑，不必等到终检）。
- **② 触发时机**：T2.5 闸门 ＋ T7 审计 ＋ T8 终检（随 `m-gate-check.mjs` 运行）。
- **③ 接线**：T1/T2/T3 卡（索引段是**机械校验对象**：新增条目必须同步补索引、头部声明须一致）；T4/T5 卡（索引完整性有机制保证 → **可放心按编号定位**，不必「怕漏条」而整卡通读）；T7 速查表新增「素材卡索引核验」小节；`M-Gate-Algorithm.md` 新增 **M-Form-10 定义段**（含判定伪代码与「与读取纪律的关系」）。
- **④ 口径同步**：M 门 14→15 项、M-Form 9→10 项、机械化 13→14 项，共 **18 个文件**（含 docs/README 中英）；并把「**M-Form 1-9**」这类范围写法、规则消息里的陈旧数字（「应为 8 项」）、`build-evidence-bundle` 视图标题一并更正——用**单遍原子映射**替换，避免 13→14→15 **连锁误改**（上一版踩过这个坑）。

**验证**：`consistency-check` 0 漂移（**62** 个 .md）｜`repo-hygiene-check` 通过（**95** 文件 / 随包脚本 10 个）｜`tests` **31/31**（新增 M-Form-10 四条断言：缺条判 P1 且**指名编号**、补齐后通过、悬空+头部声明不符、无卡记 N/A）｜`plugin-surface` 通过。

### 人在环三条链修订（呈现 / 确认 / 输入；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：一次「人在环交互是否可再优化」的专项审计（信息呈现 / 人类确认 / 信息输入 三条链）发现 **2 个真缺口 + 8 处可打磨**——其中「**主人的回复从不落盘**」和「**主人看不到一张属于自己的纸**」是结构性缺口。

- **A. 真缺口（4 项）**：
  1. **决策留痕（C1）**：确认单只写到 `<项目>/阶段确认-<阶段>.md` 但**没有「主人回复」栏位**——主人的原话只留在会话里，换会话/事后审计无法追溯「当时同意了什么、按什么口径驳回」。现确认单新增 **§6「主人回复（主控回填，必填）」**（原话逐字 + 时间 + 落盘结论 + 修订轮次），并定规则 **未回填 = 该门不算完成**；`final/交付说明.md` 固定字段新增第 11 项 **「主人决策记录」**（四门一行制时间线，缺回填则标注「未留痕」，**不得代填**）。
  2. **主人版进展页（P3）**：新增 `templates/进展-主人版-template.md` + `run/<项目>/进展-主人版.md`（≤15 行：现在在哪 / 已完成 / 下一步 / **需要主人做什么** / 风险 / 成本量级），主控**每次派发后 + 闸门后**刷新（覆盖写）——主人不必翻会话，也不必读操作员格式的 `status.md`。
  3. **主人待办清单（C3）**：`任务简报-template.md`（+ 精简版）新增「主人侧输入与待办」段：本项目共 **4 次确认**（Phase 0/2.5/3.5/5）、需要准备的材料（数据/旧作/案例/图片/期刊要求/署名）、预计动手时点、**以及「Phase 0 不必定死的项」**。
  4. **投喂清单与收货校验（I1）**：新增 `templates/主人投喂清单-template.md` —— 投喂一手数据的**唯一入口**（字段：路径｜摘要｜口径范围｜时间｜**可对外引用性**｜脱敏说明｜知情同意）；主控 **4 项收货校验**（路径存在 / 口径时间齐全 / 可引用性明确 / 脱敏与同意已确认，**缺一当场退回**），并接入 **T2.5 闸门**（无清单条目的投喂数据不放行 T4）；`数据卡-template.md`「主人投喂」档要求卡内写 `投喂清单：#N` 可回查。

- **B. 呈现打磨（4 项）**：确认单用途由「2.5/3.5/5 三处」扩为**四门（含 Phase 0）**，并加「**本阶段定什么 / 不定什么**」表（防主人以为 Phase 0 就要定死图位与期刊）；新增「**本轮改动摘要**」段（Phase 3.5/修订轮/5 必填，3-5 条「原条目 → 处置 → 位置」，取自审计报告 P0/P1 + 修订说明）；三播报模板**每条末尾固定加** `🙋 需要主人：<无 / 事项 + 期望时间>`（无事项也写「无」）；Phase 0 附加三块（资源预估 / 主人待办 / **「你的输入落到哪里」表**）。
- **C. 输入规格（4 项）**：新增 `templates/style-baseline-template.md`（§0 强制「旧作仅用于文风对齐：**不外发、不复制表达**」+ 主人确认记录；T6/T7 校核口径；**基线只压文风不压内容**），05/06/07 卡同步引用；洞察录入加**回执与当场退回规则**（`✅ 已录入 [C-主NN v<k>]（类型 X）→ 用于 §Y`；无法定位到论点/论据的要求当场回问；实为一手数据的改走投喂清单）；Phase 0 资源预估按 `docs/token-optimization-plan.md` 的**实测分布**报量级（子代理 cacheRead ≈38M / 墙钟 1-3 小时 / T5 占 76%，按 ±30% 区间报并注明「量级判断非承诺」）。
- **机检**：交接契约表（⑲）**扩充 4 条主人侧产物**（进展-主人版 / 阶段确认- / 主人投喂清单 / style-baseline）；规则解析支持 `templates/` 路径；`docs/troubleshooting.md` 新增 **§14 人在环**（看不到进度 / 决策追不回 / 投喂被退 / 洞察被问回 / 风格基线边界）。

**验证**：`consistency-check` 0 漂移（**60** 个 .md）｜`repo-hygiene-check` 通过（**92** 文件/9 脚本）｜`tests` **28/28**（新增「主人侧三件套齐备 + 确认单含回填段/Phase 0 块」用例）｜`plugin-surface` 通过。

**发版安排**：以上改动**已合入 master，不 bump 版本、不打 tag、不发布**；下次发版时把本段改名为 `## 2.5.2-dsh.17` 一并发出（届时 SKILL.md/package.json/cordis.patch.yml 等版本点位按既有 allow-list 流程 bump；注意本批新增 3 个模板会使发布包文件数由 89 → **92**）。

- **发布运维（dsh.16 发布实测反哺，CI-only 变更、不影响已发布产物）**：
  1. **`2.5.2-dsh.16` 已发布**（2026-09-11T02:22Z）：`_npmUser = GitHub Actions` + trustedPublisher、**含 provenance**（2 条 attestation，已入 sigstore 透明度日志）、`gitHead = 398b1aa`（与 tag 提交一致）、**89 个文件**（较 dsh.15 多 `scripts/_lib/svg.mjs`）、`dist-tags.dsh → 2.5.2-dsh.16` ✓。
  2. **修正「发布后审计」的窗口与分级（dsh.16 首跑实测）**：publish 日志明写「Your package is being processed and **may take a few minutes** to become available」，而 dsh.14 起设的 **120s 轮询窗口仍不够**（本次 gitHead 约 10 分钟后才可取到，且与 HEAD 完全一致——**产物本身没问题，是审计窗口太短误报红灯**）。现改为：窗口 **30 × 15s（≈7.5 分钟）**、等待时提示 npm 的「处理中」语义、**取不到 = `::warning::` + exit 0**（发布步骤自身已返回成功且 provenance 已签署，元数据传播延迟不是本仓库缺陷）、**取到但不一致 = 硬错误**（真正的产物/tag 不对应必须拦）。
  3. **红 run 已转绿（幂等路径验证）**：对该 publish run 执行 `gh run rerun --failed` → attempt 2 **success**。守卫「幂等检查」识别到版本已存在于 npm → 跳过发布步骤 → 审计步骤随之跳过——**未发生二次发布**，同时验证了「重复触发同一 tag 不会重发」这条防线是真的有效。
- **`latest` dist-tag 已同步（2026-09-11，维护者手工执行）**：`dist-tags = { latest: 2.5.2-dsh.16, dsh: 2.5.2-dsh.16 }` ✓ —— 裸包名 `npm i lunheng-article-pipeline` 与 `@latest` / `@dsh` 均解析到 **2.5.2-dsh.16**。**仍建议**配置 `NPM_TOKEN` secret 让 publish.yml 的 dist-tag 步骤自动接管（OIDC 令牌无权重写 `latest`，否则每次发版都要手工补一步）。
- **随包脚本改进：已完成（自 dsh.15 起的遗留项，v2.5.2-dsh.17 发布段内）**：`token-cost.mjs` 已补 `-h/--help`（exit 0，列出全部参数）与「未知参数 → 附打印用法」，不再只报一行 `未知参数`。

### M 门文档自洽机检（规则 ⑳ + ⑥b 收紧；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：M-Form-10 / M-Exist-4 两个新项加进了 `M-Gate-Algorithm.md` 的**节体**，但两个**节头括注**仍写「（9 项）」「（3 项）」——而这份文档就是 M 门口径真源，节头项数是下游（T7 速查表 / `AGENTS.md` / `SKILL.md`）抄写的来源。**为什么 ⑥b 没抓住**：⑥b 上一版的中文括注正则要求「项」**紧跟右括号**（`（N 项）`），而这两处写法是「（9 项，**含** v2.2.1.2 + …）」——**中间夹了说明文字就被静默放过**；这是「规则以为覆盖了、其实只覆盖了最窄写法」的典型形态。

- **① 修两处真实漂移**：`M-Gate-Algorithm.md` 节头 `M-Form 形式合规门（9 项 → **10 项**）`、`M-Exist 存在性合规门（3 项 → **4 项**）`，并按本仓注解风格补上 `v2.5.2-dsh.17` 来源标注（索引段完整性 / 审计条目闭环）。
- **② ⑥b 收紧（堵住漏检形态）**：中文括注判定放宽为「`项` 后接 `[，、；]` + ≤80 字说明」也计入——`（N 项）` 与 `（N 项，含 …）` 两种写法都必须对得上；并**补上此前完全缺失的 M-Integrity 括注判定**（期望 = **脚本 1 项 + 主控人工门 1 项 = 2 项**，不误报）。
- **③ 新增规则 ⑳「M 门文档自洽」——从文档结构派生，不再靠文本模式扫**：
  - **节头项数 == 节内 `### M-Xxx-k:` 子节数**（节头写 9 而节内 10 个子节 → P1，并报出实际子节清单）；
  - **子节编号必须 1..N 连续**（跳号 / 重号 → P1）；
  - **文档项数 == `m-gate-check.mjs` 的 gate 标签数**（Form / Exist / Integrity 分别比；Integrity 侧 = 标签数 + 1，因 M-Integrity-2 是主控人工门、未脚本化）——「文档加了项、脚本没实现」与反向情形都当场报；
  - 节头漏写「（N 项）」→ P1（项数口径无从派生）。
- **收益**：三层判定把「M 门口径」变成**可自我验证的闭环**——以后再加第 11 个 M-Form 项，只要节头忘了改、或脚本忘了实现，`consistency-check` 立即红灯，无需人工逐份核对。

**验证**：`consistency-check` 0 漂移（**62** 个 .md，新规则 ⑳ 已在真源上跑通）｜`repo-hygiene-check` 通过（**95** 文件 / 随包脚本 10 个）｜`tests` **34/34**（新增 2 例：⑳+⑥b 注入负向四条断言——含「M-Integrity 括注期望 2 项、不得误报」；真源仓库自洽正断言）｜`plugin-surface` 通过。

### 四项机检补齐：M-Form-11 + M-Exist-5/6/7（M 门 16 → 20 项；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：上一批把「M 门文档自洽」补成机检后，按主人指定的三项候补（T5 按需加载的下一层 / T9 期刊匹配 + T8 交付说明 / M-Integrity-2 表单化）依次做完。四项的共同点是同一个老毛病——**文档已经要求了，但没有任何机械证据**：「按需加载」「闸门过了」「期刊匹配 90%」「固定字段」全都是**看起来像事实的自述**。本批把它们逐条变成机检。**M 门 16 → 20 项，脚本机械项 15 → 19 项**（M-Form 11 + M-Exist 7 + M-Integrity-1 佐证）。

- **① T5 素材按需加载闭环 → 新项 M-Form-11**：05 卡要求 T5「先读索引段 → 按映射表**只读相关条目、不读全文**」（T5 cacheRead 占子代理总量 ≈76%，整卡通读就是大头），但「按需加载」与「整卡通读」在产物上**完全同形**，这条优化此前全凭写手自述。现新增留痕 `analysis/素材加载清单.md`（模板 [`素材加载清单-template.md`](skills/lunheng-article-pipeline/references/templates/素材加载清单-template.md)，≤30 行、T5 每轮覆盖写），机检三层：**引用 ⊆ 已加载**（引了没读 = 引用不可信 → P1；>3 条 → P0）、**加载集有卡片支撑**（幽灵编号 = 清单编造 → P1）、**读了不用 / 加载率 >90%**（软 P2）。**边界写清**：本项**不能**证明写手没整卡读（读行为不留痕），它守的是「引用必须来自读过的条目」——所以如实写不会被罚。
- **② M-Integrity-2 表单化 → 新项 M-Exist-5**：两道主控闸门（T2.5 / T7.5）此前**只有伪代码、没有任何落盘表单**——闸门过没过、依据是什么只留在会话里，换会话或事后审计不可追溯，M-Integrity-2 的判定也没有可核对的输入。现新增 [`闸门记录-template.md`](skills/lunheng-article-pipeline/references/templates/闸门记录-template.md)（T2.5 8 项 / T7.5 7 项），并要求抄成 `audits/闸门记录-T2.5.md` / `-T7.5.md`。机检：**必需检查项从模板派生**（不写死在脚本里，改模板即改口径）、**「实据」必须是机械证据**（路径 / exit code / 命令 / sha256——写「已检查」这类自述 → **P1**）、结论词固定且判 ✗ 必须写原因、**T7.5 全判 ✓ 而 `M-Gate-Report.json` exit ≠ 0 → P0**（自相矛盾）。触发条件：项目进入 Phase 4 才硬判，之前记 N/A。
- **③ T9 期刊匹配机检 → 新项 M-Exist-6**：审稿报告的 6 维评分、总评分、建议词、期刊 Top 3、综合匹配度此前**零机械校验**——总分可以是 6 个维度凑不出来的数、推荐刊名可以是数据库里根本不存在的刊、匹配度可以不由公式得出。**这三种都是「看起来很像专业意见」的编造，主人无从分辨**。现机检：**总评分 == 6 维之和**（硬）、建议词与总分区间一致（软）、**综合匹配度可复算**（`0.5×主题 + 0.3×风格 + 0.2×(总分−16)/14`，容差 ±1.5 → 超差 P1）、**刊名须出自 [`期刊数据库.md`](skills/lunheng-article-pipeline/references/_shared/期刊数据库.md)**（查不到 → 软 P2，实测能拦杜撰刊名）、任务简报启用期刊匹配却无匹配表 → P1。**边界**：契合度的**取值**仍是 LLM 判断，本项只保证表内数字能被公式复算。
- **④ T8 交付说明机检 → 新项 M-Exist-7**：`deliverables.md` 早就写明「T8 终检时机械填充」的固定字段，却**既无模板也无机检**——字段名与齐备程度全凭主控临场发挥，主人复核时缺项不可发现（「固定字段」名不副实）。现新增 [`交付说明-template.md`](skills/lunheng-article-pipeline/references/templates/交付说明-template.md) 并把字段**由「11 项」显式化为 12 项**（「证据包指纹」升为第 9 个固定字段——原来只藏在 M-Integrity 步骤里；「终检结论」补两道闸门结论行）。机检逐字段：**存在 + 有内容 + 不含 `<…>` 占位符**（内容阈值 1 字，允许「无」「未启用」这类合法的一句话答复）、指纹占位符或真实 sha256 必有、**主人决策记录覆盖四门**（缺回填的门须显式标「未留痕」，不得省略、不得代填）。
- **⑤ 体系侧同步（本批顺带修的真实漏检）**：
  - **⑥b 三次收紧**：① 中文括注允许「项」后接**同行任意长说明**（原限 ≤80 字，而实测节头括注达 120+ 字 → 又一处静默漏检）；② 新增「**M 门 N 项中 M 项已脚本化**」写法判定；③ 新增「**`**N 项**：M-Form 1-`**」写法判定。②③ 一加上就抓出 2 处真实残留（`AGENTS.md` 写「20 项中 **14** 项已脚本化」、08 卡写「**15 项**：M-Form 1-」）——**这正是「规则只覆盖已知写法」的老毛病，本批把它连根收紧**。
  - **交接契约表（⑲）新增 3 条**：`素材加载清单` / `闸门记录-` / `交付说明`（产出者声明 + 下游引用双向核验）；`build-evidence-bundle` 收录素材加载清单（T7/T8 可见）；派发卡 T5/T7/T9 同步（T5 产出留痕、T7 核闭环、T9 数字可复算）；`docs/troubleshooting.md` 新增 **§16**（逐项报错含义与修法表）。
  - 计数口径全仓同步：16 处文件 / 39 处数字（`M 门 16 项` → 20、`15 项机械化` → 19、`M-Form 10` → 11、`M-Exist 4` → 7）——**由 ⑥b 逐条点名后一次性单遍替换**（不做链式替换，防「改完又被下一条规则再改一遍」，dsh.17 前批的教训）。

**验证**：`consistency-check` 0 漂移（**65** 个 .md）｜`repo-hygiene-check` 通过（**98** 文件 / 随包脚本 10 个）｜`tests` **38/38**（新增 4 例 16 条断言：M-Form-11 五种形态、M-Exist-5 五条判定含 P0 自相矛盾、M-Exist-6 总分/复算/杜撰刊名、M-Exist-7 缺字段/占位符/漏门）｜`plugin-surface` 通过。另用一份「四项齐备」的完整夹具做了正向冒烟：四项全过。

**发版注意**：本批新增 3 个模板，发布包文件数将由 95 → **98**。

### 报告覆盖与承重墙机检：M-Form-8 增补 + M-Exist-8/9（M 门 20 → 22 项；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：继续按主人指定的三项候补（M-Form-8 承重墙的机械加强 / T6 批判报告 C1-C7 覆盖机检 / G0-G14 机检抽样）做完。这三项的共性是**「清单式要求只写在文档里」**——C1-C7 逐条执行、G 项缺一不可、承重墙不得超载，全是审计与批判作业的**最低结构要求**，此前没有任何机械核验；漏项时报告读起来**依然完整**。

- **① M-Form-8 增补「承重墙超载」机检（不新增项号，把该门唯一残留的 LLM 判断拆掉一半）**：承重墙 = 每论点的 top1 证据，论衡的规则是**同一证据被 ≥3 个论点标为承重墙 = 超载**（教训：善行实战祁东案一个案例承重四个论点，**被击穿则整链塌**）——此前只有 T6 专项批判 + T7 的 LLM 复核，**没有任何机械计数**。现机检：在大纲「承重墙清单」区块内按**结构性行**（表格行 / 列表项 / 含「论点N」的行）计数，同一编号 ≥3 次 → **超载 P1**；标注的编号在素材卡中不存在 → **虚标 P1**；「有论点未标 top1」「清单无结构性条目」只记备注（不判失败）。**设计要点**：只认结构性行，防把散文里的编号误算成承重墙标注；**边界**：机检只核计数与存在性，**哪条证据才是真正的 top1、其支撑力够不够仍是 T6/T7 的 LLM 判断**。
- **② 新项 M-Exist-8「批判报告覆盖（C1-C7）」**：06 卡要求 C1-C7 **逐条执行**、每条按五要素结构化清单写（论点定位 / 反方观点 / 你的论据 / 攻击强度 / 建议），并且**自己声明「T7 审计员 + T5 写手可机械消费」**——但没有任何脚本核过它。风险很具体：报告漏掉 C3（理论假设）或 C7（一处两用）时，**从报告表面完全看不出来**，而 T7 的「T6 条目关闭复核」与 T5 的段级 diff 都以这些条目为输入。现机检：七节齐备（认标题 / 加粗 / 列表 / 表格四种写法，缺 1-2 节 → P1、缺 >2 节 → P0）、节体去标点后 ≥40 字（过短 → P2）、段级清单 `[P0-Cn-m]` 编号唯一（重复 → P1）且类别 ∈ C1-C7（自创类别 → P2）、每条至少含 3 项要素（不足 → P2）。**边界**：只核「有没有写、格式对不对」，**攻击是否切中要害仍是 T7 的复核范围**。
- **③ 新项 M-Exist-9「审计报告 G 项覆盖」**：07 卡把「审计报告里的 **G0-G14 检查项是否全覆盖**」直接写成交接报告的**验收标准**，quickref 也要求「必查项逐条执行，缺一不可」——**但没有任何脚本核过覆盖率**。风险同上但更危险：报告只写了 G1-G7，而 **G11（时效）/ G12（信任级别）/ G14（中文 AI 痕迹）整段缺席**时，报告**读起来仍像一次全项检查**。现机检：G0-G14 十五个主项逐项出现，且**本行或下一行有结论词**（通过/不通过/合规/违规/达标/N/A/…）——完全未出现 → P1（缺 >3 项 → P0）；只提不判 → P2；子项 G0.5 / G2.5 / G4-2 未覆盖 → P2。编号匹配用 `(?<![A-Za-z0-9])G12(?![0-9.])` 边界断言，**防「G1」误命中「G14」、「G0」误命中「G0.5」**。
  - **首版被自己的测试抓出假通过**：初版用「提及处 ±200 字内是否有结论词」判定，而**短报告的所有提及都落在同一个窗口里**（含报告头的「结论：通过」）→ 15 项全部误判为「有结论」。改为**逐行判定（本行 + 紧接着的下一行）**，既修掉假通过，又覆盖 `- **G7**：通过` / `| G7 | 通过 |` / `### G7` + 次行结论三种真实写法。
- **④ 体系侧同步**：全仓计数**单遍替换** 16 文件 / 32 处（`M 门 20 项`→22、`19 项机械化`→21、`M-Exist 7 项`→9）；T7 速查表（quickref）逐项补上新项名；06/07 卡写清机检口径与边界；`docs/introduction.md` 列表补两项；`docs/troubleshooting.md §16` 追加**承重墙超载 / C1-C7 漏节 / G 项漏项**三组报错含义与修法；**顺带修掉 `glossary.md`「覆盖范围：13 项检查」**——一处从未被任何规则覆盖的陈旧总数（写成 22 项）。

**验证**：`consistency-check` 0 漂移（**65** 个 .md）｜`repo-hygiene-check` 通过（**98** 文件 / 随包脚本 10 个）｜`tests` **41/41**（新增 3 例 20 条断言：承重墙正常/超载/虚标/无清单、C1-C7 齐备/漏 1 节/漏 4 节/编号重复/要素不足、G 项全覆盖/缺 4 项/只提不判/子项缺）｜`plugin-surface` 通过。

### 抽样执行与精简段机检：M-Exist-9/6 增补 + M-Exist-10（M 门 22 → 23 项；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：按主人指定的三项候补（G 项抽样的实际执行 / T4 大纲 §11 精简段完整性 / T9 审稿建议的落地追踪）做完。前一批解决了「报告有没有写全清单」，这一批解决**「写了之后有没有实据、以及被依赖的输入是否真的可用」**——两处共性是：**机制宣称的收益依赖一个没被核验的输入**。

- **① M-Exist-9 增补「结论必须带实据」（G 项抽样的实际执行）**：上一批只核到「G0-G14 都提到了且邻域有结论词」——但 `- **G11**：通过` 这种**只写通过、不给任何依据**的写法同样能过，而它正是「自称通过」的形态。现要求每个 G 项的结论**同行或次行必须有实据标记**：素材编号 `[Lxx]` / 文件路径（`.md`/`.json`）/ `§` / `exit N` / **带量词的数字**（`5/5`、`12 条`、`80%`）→ 缺失 → P2。**实现要点**：判定前先**剥掉 G 编号本身**（否则 `G11` 里的数字会被当成证据）；裸数字不算（避免「G1」自证）。
- **② 新项 M-Exist-10「大纲 §11 精简段完整性」**：04/05 卡早已定案「T5 **只读**大纲末尾 §11 写手版精简段（≈60 行），完整大纲按需」——这是 **T5 上下文 50K 大头的根治手段**（T5 cacheRead 占子代理总量 76%）。但 §11 是否真含**六要素**（论证主线 / 论点-论据映射表 / 反方规划要点 / 字数预算 / 禁做项 / 承重墙清单）**从来没被核过**。风险最隐蔽：§11 缺要素时 T5 只能**回退整读大纲**，省 token 的机制**静默失效**，而产物上完全看不出来。现机检：缺「写手版精简段」标题 → P2；六要素**缺 ≥3 → P0、缺 1-2 → P1**；实质行数 <5 → P1；映射表要**真表格**（表头含「论点」+ 行内含素材编号）、字数预算要有数字、行数 >120、以及「其后还有 >20 行实质章节」（与「写在文件末尾」口径冲突）→ 各记 P2。
- **③ M-Exist-6 增补「审稿建议可消费性 + 修订回执闭环」**：T9 的「给作者的具体修改建议」是主控据以做**目标期刊适配修订**的唯一输入，但「建议进一步加强论证」这类**无定位、无动作**的句子同样能出现在报告里（而报告表面完全正常）。现核：建议段存在（缺 → P2）、条目**逐条带定位**（`§章节`/段落/行号/素材编号，缺失 → P2）、**若其后发生过修订轮**则 `drafts/修订说明-vN.md` 必须提及审稿意见（否则「建议提了没人接」→ P2）。
- **④ 体系侧同步**：全仓计数单遍替换 16 文件 / 32 处（`M 门 22 项`→23、`21 项机械化`→22、`M-Exist 9 项`→10）；T7 速查表补 M-Exist-10 与「结论须带实据」；04 卡写清 §11 六要素机检、09 卡写清建议定位与闭环要求；`docs/introduction.md` 列表补两项；`docs/troubleshooting.md §16` 追加 §11 精简段 / G 项实据 / 审稿建议三组报错含义与修法；`glossary.md`「覆盖范围」同步为 23 项。

**验证**：`consistency-check` 0 漂移（**65** 个 .md）｜`repo-hygiene-check` 通过（**98** 文件 / 随包脚本 10 个）｜`tests` **44/44**（新增 3 例：M-Exist-10 五形态、M-Exist-9 实据正负例、M-Exist-6 建议定位与回执闭环）｜`plugin-surface` 通过。

### 机检项自省：1 个假阳性阻塞门 + 1 处重复门 + 3 处口径漂移（M 门 23 项不变；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：按主人指定做「机检项自省」——审计机检里有没有**永远 N/A 的僵尸门**。做法：把全部机检项在「空项目 / 最小可交付 / 全流程齐备」三种项目形态上跑**实测矩阵**，再逐项对照「文档声明 vs 脚本行为」。**结果比预期严重：没找到僵尸门，却找到一个假阳性阻塞门**——僵尸门只是放过漏检，**假阳性门会把合规产物判死**。

- **① 假阳性阻塞门：`splitCard` 被索引段行抢先命中 → 合规数据卡判 P0（已修，本批最重的一条）**
  - **现象**：M-Form-6（信任级别）对一张**条目 100% 合规**的 8 条数据卡报「独立段缺失 8 条」→ **P0 → exit 2 → 阻塞交付**。
  - **根因**：`scripts/_lib/cards.mjs` 的切块正则把两种条目形态写在**同一个 alternation** 里（`#{2,4}\s*\[Dxx\]` ｜ `\n\[Dxx\][^\n]*\n`），而「## 📇 索引段」的索引行列形如 `[D01] 甲 ｜ 主题 ｜ 论点1`，**在文档里出现在正文条目前面** → 正则从左到右扫描时**索引行先命中**，切出的 body 是「索引段剩余部分」而非条目正文，于是找不到「信任级别：」行。
  - **影响面**：条目 **≥6 条即必然触发**（>5 → P0）；而数据卡模板**本来就要求索引段**，**每个真实项目都会踩**；`normalize-trust-level.mjs` 共用同一真源，同样被错切（可能正是历史「默认填已发布」污染之外的第二重隐患）。
  - **修复**：`splitCard` 改为**优先标题式、回退行内式**两段匹配，返回值新增 `form` 字段（`'heading' | 'line'`）；`cardPattern` 保留导出但标 deprecated，避免下游 import 断裂。
  - **回归测试**：8 条合规卡 + 索引段必须判**通过**（旧实现下该用例为 P0）。
- **② 重复门：M-Form-3 与 M-Exist-1 算的是同一件事（已重写）**
  - **现象**：M-Form-3「临时编号残留」的脚本实现是 `orphan = 正文编号 − 文末编号`，而 M-Exist-1 的 `leaked` 用的是**同一组变量、同一套阈值档位**（>10 P0 / >3 P1 / >0 P2）→ 两项**恒同判**，同一缺陷报两次，覆盖率不增。
  - **而文档意图并非如此**：`errors.md` 记的原始形态是 **`[L_TBD-xxx]` / `[D_占位]` 这类临时编号** → 脚本实现跑偏；同时 `[待补]` 出现在定稿里**此前无人管**（M-Form-4 的禁止清单不含它，M-Form-5 也不含）。
  - **重写**：「正文 ↔ 文末编号闭环」**只归 M-Exist-1**；M-Form-3 回归名字本身 = **占位符 / 临时标记**（`[待补]` / `[TBD]` / `[L_TBD-1]` / `[D_占位]` / `【待核】` / `___` / `？？`），**任一处 P1、≥3 处 P0**；显式排除合法形态 `[C-主01]`（主人洞察编号），并写明**编号位数不由本项管**（`refs.mjs` 明确允许任意位数，不强制补零）。
- **③ 三处口径漂移（文档承诺 ≠ 脚本行为，均已对齐）**：
  - **M-Form-4**：文档写「**P0 优先级**」，脚本对 1-5 处只给 P1 → 改为**任一处泄露即 P0**（与 M-Form-7「一处违规即 P0」同族）。
  - **M-Form-5**：脚本最高只到 P1，**P0 分支不可达** → 补档：1-5 处 P2 / 6-10 处 P1 / **>10 处 P0**。
  - **M-Integrity-1**：文档承诺「单子项失败 P0（信任级别缺失 / 数据条目不足）」，而脚本只核「任务简报存在且有子问题」且严重度**恒为 `LLM 兜底`** → **永不 P0/P1**，「佐证」形同虚设。现补两次可机械化的对账：**数据条目数（`[Dxx]` 并集 ∪ 表格 `| 1.x |` 行）≥ 任务简报「需找数据点」之和**（不足 → **P0**，对应 T2.5 步骤 4）、**数据卡缺失 → P0**、**M-Form-6 未过 → P0**；差序输入（简报缺失）仍记「LLM 兜底」，最终判定归主控 L4 跨文件判断。
  - 顺带把 07 卡与 `pipeline-readme` 里「M 门预检**任一项失败 → P1**」的旧口径改成与脚本一致的分级表述。
- **④ 自省结论：无僵尸门**。唯一在全部夹具下都 N/A 的是 **M-Form-9 图件闭环**，但那是**按设计 opt-in**（配图默认关闭；启用后 P1/P0 两档由既有测试覆盖）——**保留，不加"强制启用"**。

**验证**：`consistency-check` 0 漂移（**65** 个 .md）｜`repo-hygiene-check` 通过（**98** 文件 / 随包脚本 10 个）｜`tests` **48/48**（新增 4 例：splitCard 索引段假阳性回归、M-Form-3 占位符三形态含 `[C-主01]` 不误报、M-Form-4/5 分级、M-Integrity-1 对账 P0）｜`plugin-surface` 通过。**M 门项数不变（23 项）**——本批是「修门的正确性」，不是「加门」。

### 降成本实测：把「省 token」断言变回可复现数字（新增第 11 个随包脚本 `token-budget.mjs`；同属 v2.5.2-dsh.17 待发，**已随 v2.5.2-dsh.17 发布**）

**背景**：主人指定「降成本实测」。做法：先用本机**真实数据**（47 个会话投影 ≈55MB `tokenUsage` + 12 个真实 `run/` 项目产物），再写一个**可复现脚本**把每条「省 token」断言换算成数字。规则 ⑰ 只保证量化断言**有**算式/出处，不保证它们**还准**——这次就抓到了三处不准，其中一处是方法论层面的。

- **① 新增 `scripts/token-budget.mjs`（第 11 个随包脚本，零依赖，两个模式）**：
  - `--project <项目>`：**读目标对账**（整读 vs 按需读）——大纲→§11 / 三卡→索引段 / 证据包→审计视图 / 定稿+证据包→M 门 JSON；
  - `--roles`：读 `$DSH_HOME/storages/session_projcache/sessions/*.json`，按 `subagent` **角色标签**聚合真实 token（cacheRead / output / 步数 / 占比），非论衡角色的子代理自动排除；
  - **口径写死在输出里**：token 为**估算区间**（汉字 0.6~1.0 token/字、ASCII 1/4 字符），声明「非计费值」；**按需读目标缺失时不给省比（记 `n/a`）**——防出现「省 100%」的假节省；
  - 退出码语义与其它脚本一致（0 成功 / 1 用法 / 2 路径不存在）；`-h` 列全部参数。
- **② 实测结果（已写入 `docs/token-optimization-plan.md` 新增「实测复测」段）**：
  - **真实分布**（本机 34 个可识别论衡会话 / 子代理 cacheRead 67.69M）：**T5 63.6%** / T7 16.2% / T6 4.6% / T4 3.8% / T1 3.6% / T3 2.5% / T2 2.1% / T9 1.9% / G14 1.4%；
  - **读目标对账**（12 个真实项目、45 条样本）：大纲全文 → §11 省**中位 85%**（69~94%）｜三卡全文 → 索引段省 **91%**（n=4）｜证据包全文 → 审计视图省 **98%**（n=2）｜定稿+证据包 → M 门 JSON 省 **98%**（n=8）。
- **③ 三处断言按实测修正**：
  - 「**T5 占子代理 76%**」实为 **test-paper-02 单项目峰值**（3 会话 28.9M / 38.2M = 75.6%）被写成了通用值 → 4 处文档（05 卡 / M-Gate-Algorithm ×2 / 素材加载清单模板）改为**双口径并列**（单项目峰值 76% + 本机聚合 63.6%）并附复现命令；
  - 「机械化脚本化**省 T8 读定稿+证据包约 12K token**」→ 实测中位 **28.4K~41.6K token**（旧值低估 2-3 倍），已按实测改写；
  - 02 卡引用的「T2 单会话 cacheRead 18.9M」**已无法复验**（该会话投影不在本机缓存）→ 改引用可复验的聚合口径（T2 共 4 会话、1.44M）。
- **④ 成本模型的更正（比数字本身更重要的发现）**：旧表述「整卡通读就是 T5 上下文 50K 的大头」**不成立**——整卡全文实测只有 **12~18K token**，约占一步上下文的 10%。真实机制是 **步数 × 每步上下文**：T5 实测 43.09M / 292 步 ≈ **147K cacheRead/步**，而**一次读进上下文的内容会被后续每一步重读**——所以省 16K 初始上下文 ≈ 省 **0.78M cacheRead/会话**（≈该会话的 11%）。**这解释了 T5 为何独占大头，也说明「优化读取位置（§11 / 索引段 / 审计视图）」比「压缩单次输出」更有效。**
- **⑤ 体系侧**：`repo-hygiene-check` 的「随包脚本数」改为**从 SKILL.md 白名单派生**（旧版写死 `10`，加脚本就变成噪音红灯；白名单本身的正确性由 ⑩ 双向核验）；白名单 10 → **11**（SKILL.md / 主控卡 / QUICKSTART 三处同步）；`docs/troubleshooting.md` 新增 **§17**（怎么量「到底省没省」+ 两个口径别混 + 76%/63.6% 的口径说明）。

**验证**：`consistency-check` 0 漂移（**65** 个 .md）｜`repo-hygiene-check` 通过（**99** 文件 / **11** 脚本，数量派生自白名单）｜`tests` **51/51**（新增 3 例：`--project` 对账含「缺失不给假 100%」、`--roles` 聚合数学含非论衡角色排除、参数契约 4 档）｜`plugin-surface` 通过。**发布包 98 → 99 文件。**

**本次未做（如实记录）**：① 「平台-gig 191M → 80-90M 省 50-55%」的**同题 A/B** 仍未做（需旧版复跑同题，成本高），该数字属**预测**；② `token-budget.mjs` 的 token 仍是**估算区间**（未内置 tokenizer）——要计费值请用 `token-cost.mjs` 读真实 `tokenUsage`。

### 发布运维（v2.5.2-dsh.17 发布实测，2026-09-11）

- **已发布**：`2.5.2-dsh.17` —— GitHub Actions **trustedPublisher（OIDC）** 发布、**含 provenance**（SLSA v1 attestation）、`gitHead = 179725d`（与 tag 提交 `v2.5.2-dsh.17` 一致）、**99 个文件**（较 dsh.16 的 89 个**新增 10 个**：`references/_shared/模型路由.md` + 7 个模板（`素材加载清单` / `闸门记录` / `交付说明` / `模型路由表` / `进展-主人版` / `主人投喂清单` / `style-baseline`）+ `scripts/model-routing.mjs` + `scripts/token-budget.mjs`）、`dist-tags.dsh → 2.5.2-dsh.17` ✓。
- **发布后审计窗口经验证有效**：本次 registry 元数据传播用了 **13 次轮询（≈3 分钟）**才取到 `gitHead`，且与 HEAD **完全一致** ✓ —— dsh.16 首跑时 120s 窗口不够导致误报红灯，当时把窗口改为 30×15s（≈7.5 分钟）的判断在本版得到验证。
- **`latest` dist-tag 已同步（2026-09-11，维护者手工执行）**：`npm dist-tag add lunheng-article-pipeline@2.5.2-dsh.17 latest` → 现 `dist-tags = { latest: 2.5.2-dsh.17, dsh: 2.5.2-dsh.17 }` ✓，**裸包名 / `@latest` / `@dsh` 三种写法均解析到 2.5.2-dsh.17**（指向的产物 `gitHead = 179725d` / 99 文件 / provenance SLSA v1 ✓）。
  > **为什么必须手工**：OIDC trustedPublisher 令牌**无权**重写 `latest`。**建议**配置 `NPM_TOKEN` secret 让 publish.yml 的 dist-tag 步骤自动接管，否则每次发版都要手工补这一步（已连续三版如此）。
- **安装面验证**（发布后实拉）：`npm pack lunheng-article-pipeline@2.5.2-dsh.17` → **99 文件**、`scripts/` **11 个入口**（含新增的 `token-budget.mjs`）✓。

## 2.5.2-dsh.16（2026-09-11）— SVG 图件链路：从「有机制无门」到可验证

**背景**：一次图件链路专项审计（问题：「论衡生成 SVG 数据图表的功能是否运行有效？」）的结论是——**能生成，但不「有效」**：机制齐全（模板 5 图型 + 图位 + 主控手写 SVG + 导出路径），但**校验层几乎为零**，唯一触及 SVG 的脚本对多图会产出静默错误，且这条链路**从未在真实运行中被验证过**（仓库内无任何产出记录）。本版把这条链路补成「有机制、有机械门、有实测记录」。

- **① `md2html.mjs` 三处实测缺陷修复（每处都有复现与回归测试）**：
  1. **单 SVG 复用 → 多图静默出错**：旧版只接受一个 SVG 路径，且把它嵌进**每一个** `[图N]`（实测：2 个图位 → 同一份图出现 2 次，caption 分别写「图1」「图2」）。多图文章导出 HTML/PDF 会得到 N 张一样的图。现新增 **`--fig-dir <final/图件>`** 按图号配图（`图N_标题.svg` / `图N-标题.svg` / `图N.svg`），块级图注标明**源文件名**；位置参数单图模式保留向后兼容，但**显式告警**重复复用。
  2. **行内图位被当纯文本**：旧版只认**独占一行**的 `[图N：…]`，写在段落里的图位既不替换也不报错（实测）。现就地内联（`<span class="figure-inline">`）并告警提示改为独占一行（无图注、分页不可控）。
  3. **坏 SVG 原样嵌入**：旧版对 SVG 合法性**零校验**，未闭合标签也 exit 0（浏览器整块不渲染而无提示）。现导出前用 `scripts/_lib/svg.mjs` 校验——结构不合格（未闭合 / 无 `<svg>` 根 / 无 viewBox 且无宽高 / 含 DTD·ENTITY）→ **exit 2 拒绝导出且不产出 HTML**；`<script>`/`on*`/`foreignObject`/`javascript:`/外部引用剥离并逐条告警；`--strict` 让任何告警都失败；缺图输出**显式占位（含期望文件名）**。

- **② 新增 M 门 **M-Form-9 图件闭环**（M 门 13 项 → **14 项**；脚本机械项 12 → **13 项**）**：
  - 落地那条**长期无落地路径**的条文：T5 写作卡宣称「T7 跑 M-Gate 检查 `[图N]` 数量 ≥ 拍板数 → P0 拦截」，但当时 M 门 13 项**没有任何图项**、T7 速查表 **0 处**提及「图」、证据包也不收图件（审计 findings）。
  - 判定：**缺图 → P1；图件全缺或图位全缺 → P0**（退出码 2，打回 Phase 4.5 补图）；图位数 < 任务简报「图位数量」→ 硬问题；**孤儿图件 / 图上数字无出处 / SVG 安全告警 → P2 提示**（数字对账为**启发式**，可能命中刻度·坐标，只提示不当硬失败）；**未启用配图 → 记 N/A 且通过**（配图默认关闭，绝不因「没配图」判 M 门失败）。
  - 结构判定与消毒共用 `scripts/_lib/svg.mjs`（新增共享模块，零依赖：标签栈配平 + 特征扫描，不引入 XML 库）。
  - `m-gate-check.mjs` 新增 `--fig-dir`（缺省自动推 `<定稿目录>/图件`）；`audit-checklist-quickref.md`（T7 速查表）新增「图件核验」小节——此前该文档对「图」**零覆盖**。

- **③ 图件进入证据包与审计视图 + 路径口径唯一**：
  - `build-evidence-bundle.mjs` 现在把 `final/图件/*.svg` 收进 `证据包/图件/`，审计视图新增 **「图件对账」段**（图位数 / 图件数 / 缺图 / 孤儿）——T7/T8 不必逐文件翻图（旧版视图对图件**零可见性**）。
  - 路径口径统一为 **`final/图件/图N_标题.svg`**（旧版 08 卡写 `final/图N-*.svg`，两套口径并存）。新增一致性规则 **⑱**：旧口径即 P1、「宣称的图件机械门必须真实存在」（脚本须含 M-Form-9 与 `_lib/svg.mjs`）、图位规范必须写明「独占一行」。

- **④ 规则 ⑥b 升级为从脚本派生（M 门口径不再会自己过期）+ 全量口径对齐**：
  - 旧 ⑥b 把「12 项机械化 / 总 13 项」写死在规则里——**脚本一改规则就过期**。现改为从 `m-gate-check.mjs` 的 gate 标签**派生**（M-Form 计数 + M-Exist 计数 + M-Integrity → 机械化 = 12+1，总项数 = 机械化 + 1），并覆盖 `docs/**`（此前 docs 的计数声明不在任何规则覆盖内）。
  - 本版据此一次性修正 **19 个文件**的 M 门口径声明（M 门 13→14 项、M-Form 8→9 项、机械化 12→13 项、docs 4 处），并更新 4 处**陈旧表述**（「机械项 = M-Form-1/3/5/7 + M-Exist-2」是 dsh 初版子集，现为 M-Form 1-9 + M-Exist 1-3 + M-Integrity-1）。两处**历史记录**按「不篡改历史」处理改为不含计数的措辞（README 实战表「M 门 exit 0（当时 13 项口径）」、introduction 版本演进表「M 门单文件算法统一」）。
  - `M-Gate-Algorithm.md` 新增 **M-Form-9 完整定义段**（检查对象 / 判定伪代码 / 严重度 / 触发时机 / 人类验证示例 / 实战背景）。

- **端到端演练（本版实测记录）**：夹具项目 `run/proj`（2 图位 + 1 行内图位 + 简报「图位数量：2」）跑 **27 项断言全绿**——
  - `md2html.mjs`：多图**各自嵌对**（图1 独有标记/图2 独有标记各 1 次，旧版会复用）｜行内图位就地内联 + 告警｜缺图显式占位（行内也带期望文件名）｜坏 SVG **exit 2 且不产出 HTML**｜单 SVG 模式 2 图位复用同一份图 + 显式告警（向后兼容）；
  - `m-gate-check.mjs`：`total = 13`（旧版 12）｜图位图件齐 → 通过｜**缺 1 张 → P1**｜**图件全缺 → P0**｜孤儿图件 + 无出处数字（`98765`）→ P2 提示｜图位少于拍板数 → 硬问题｜恢复后通过；
  - `build-evidence-bundle.mjs`：`证据包/图件/` 收到 2 个 SVG｜视图含「图件对账」且缺图时显式标「缺图」。
  - 回归测试新增 **8 个用例**（多图配图 / 行内+缺图 / 坏 SVG exit 2 / 单图告警 / M-Form-9 N/A / M-Form-9 P1→P0 / 孤儿+无出处 P2 / 证据包与视图 / ⑱ 负向注入）→ 测试总数 15 → **24**。

- **文档面**：`README.md` / `README.en.md` 新增「数据图表（SVG，本地零外发）」特性段（门、导出校验、可见性）；`docs/troubleshooting.md` 新增 **§13 图件与图表导出**（路径口径 / 多图导出 / 缺图 / 坏 SVG / M-Form-9 分级 / 证据包可见性）；`operations.md` 配图规范补良构硬要求与命名对账；`_shared/format-export.md` 更新导出命令与前置校验；`05-写作-writer.md` 图位规范补「独占一行」并把 P0 拦截改成有机械落地的表述；`AGENTS.md` / `SKILL.md` 新增「图件链路」条目。

- **承接「未发布」段**：`token-cost.mjs` 的 `--help` 措辞改进（自 dsh.15 遗留）——本版仍**未做**（属随包脚本改动，优先级低于本次图件链路），继续留在「未发布」段。

- **承接 dsh.15 的发布运维记录**：`dist-tags = { latest: 2.5.2-dsh.15, dsh: 2.5.2-dsh.15 }` ✓（2026-09-11 维护者手工执行）——裸包名 `npm i lunheng-article-pipeline` 当时拿到 dsh.15。**本版（dsh.16）发布后**：`dsh` 会由 `npm publish --tag dsh` 自动指向 dsh.16，`latest` 因 OIDC 令牌无权重写仍需维护者手工 `npm dist-tag add lunheng-article-pipeline@2.5.2-dsh.16 latest`（或配置 `NPM_TOKEN` secret 让 publish.yml 的 dist-tag 步骤接管）。

**门**：`consistency-check` 0 漂移（57 个 .md；含新规则 ⑥b 派生版与 ⑱）｜`repo-hygiene-check` 通过（发布包 **89** 文件 / 随包脚本 9 个）｜`tests` **24/24**｜`plugin-surface` 通过。

## 2.5.2-dsh.15（2026-09-11）— 执行效率 / 人在环 / token 可观测修订

**背景**：一次第三方效率审计（执行效率 / 人在环 / token 三个维度）找出 6 处改进空间，其中 **3 处属于「已投入但未兑现」**——文档里写着的优化，在真实执行路径上并不成立。本版落地 5 项，第 6 项（模型分层默认化）如实留待单独一版。

- **① 检索侧补上「成功路径」的收敛规则（T1/T2/T3 卡 + 派发卡）**：
  - 事实：全技能搜 `饱和 / 早停 / 停止条件` 命中 **0 处**——已有规则只管**失败**路径（同一 query 连失 2 次熔断、Phase 1.5 补检索 ≤30 步），**成功路径没有「检够了」的判据**，宽题目可无限扩检；而检索是全流程单步最贵的角色（web_search + web_fetch）。
  - 落地：首轮软预算 **≤40 步**（≥32 步须报「接近预算」，达界即停并交主控决定加派，不得静默续跑）+ **连续 2 轮检索（每轮 ≥3 次 query/URL）新增有效卡片 = 0 → 判饱和即停**；**饱和 ≠ 缺口**（照实记入交接报告「已知问题」，不得补占位条目、不得写成「已穷尽」）；交接报告必报 `检索预算：已用 N 步 ｜ 饱和判定：<子主题>=饱和/未饱和`。
  - 文件：`01-文献检索` / `02-数据检索` / `03-案例检索` 三张角色卡 + `dispatch-cards.md` 对应三卡。

- **② 审计视图真正可用（此前对 T6/T7/T9 是死路）**：
  - 事实（逐字节核对）：生成侧唯一实现是 **T8 在 Phase 5**；消费侧 T7（Phase 4）与 T9（Phase 4.5）被要求「派发时先读」——**都在定稿之前**；T4/T5/T6 的角色卡**根本没提**（全技能仅 07/08/09 命中）；主控两张卡 **0 处**提及，而 `pipeline-readme` 却写「主控在相关闸门先生成/复用」；脚本 `build-evidence-bundle.mjs` 把源**写死 `final/定稿.md`**（不存在即跳过，连视图都不生成）。→ 所谓「省 60%+ cacheRead」只对 T8 自己成立。
  - 落地：
    1. 脚本加 `--source <路径>`，源三级回退 `--source` ＞ `final/定稿.md` ＞ `drafts/` 最高版本正文；三者皆无时**仍生成「素材阶段视图」**（供 T4 分析 / Phase 2 用）；视图头写入**视图源 + 阶段**（草稿快照 / 定稿 / 无正文源），防把草稿字数当定稿字数引用；`--source` 指向不存在文件 **fail fast**（exit 2，不复制证据包）；位置参数解析不再把旗标的值误当项目名。
    2. **视图生成升为闸门动作**：主控在 Phase 2 / 3.6 / 4 / 4.5 / 5 **派发前**刷新（`00-主控-coordinator` 职责 + `00-主控-扩展职责` §八「闸门公共动作」），并要求源版本 = 被审版本。
    3. 消费侧六张角色卡同步：04/05/06 **新增**读取指令（含各自阶段该看什么），07/08/09 **修正时序**（读前先看视图头，源早于被审版本必须重新生成）；`dispatch-cards.md` 各卡「读」清单接上，并加顶部「派发前置」。
    4. 移除无出处的「省 60%+」表述，改为机制说明（**按需跳转而非全文通读**才是省 token 的原因）。
  - 新增测试：草稿源回退、定稿优先于草稿、无正文时的素材阶段视图、`--source` fail fast。

- **③ `token-cost.mjs --top N` 实装（成本可观测）**：
  - 事实：头注释与 CHANGELOG 一直宣传 `--top`，代码里却是**死变量 `const topMode = false;`** → **无法回答「哪一步最贵」**，此前的 token 优化成果与「省 N%」类断言全都无从验证。
  - 落地：输出 `topByCacheRead` 排名（cacheRead / 单会话成本估算 / 占总量百分比）；**不传 `--top` 时输出契约不变**（向后兼容）；非法 `--top`（0 / 负数 / 非整数）与未知参数一律 exit 1（旧版静默忽略，易误以为生效）。`deliverables.md` 要求交付说明写明「本项目最贵的 1-3 个角色」。

- **④ 人在环往返成本（4 个门仍必到，但不必每次全量打字）**：
  - `templates/主人确认-template.md` 新增**「主控建议 + 一句理由」必填段**（主人回「同意」即可放行）；新增**微确认单**（无分歧阶段 ≤5 行；**仍需主人明确回复**——「未获确认不得跳过下一闸门」不变，主控不得替主人勾选）；驳回原因给可勾选项。
  - **Phase 3.5 不得空等**：主控须先给 ≤5 条具体候选追问；确无候选则明示「请回复『无补充』即继续」并在 status.md 记 `[Phase 3.5] 主人无补充`（旧写法只问一句「有洞要补吗」然后干等一轮）。
  - 新增 **Phase 5 驳回 → 最小重入集查表**：字数/格式/交付层 → 仅 T8 外科修复；结构/论证 → T5 **段级**重写 + T6 复核受影响 C 项 + T7 复审 + T8 重终检；事实/引用 → 对应检索员补卡 + 段级修订 + 复审；主题/框架 → 回 Phase 2（**唯一允许整链重跑的情形**）。

- **⑤ 一致性规则 ⑮-⑰ 收口（防再次漂移）**：
  - ⑮ **派发卡 ≤12 行/卡**机械校验（此前只是文档自称的裸约定，无脚本校验）。
  - ⑯ **审计视图三方一致**：`pipeline-readme` 声称默认只读 → 对应 8 张角色卡必须含「审计视图」字样，且生成脚本必须实现 `--source` 与草稿回退。**这正是本轮 ② 的成因，现在由机器守。**
  - ⑰ **定量断言必须有出处**：`省 N%` 类断言同行/邻行须有算式（`=`）、对照（`vs`）、实测/对比/基线，否则 P2。本版据此清扫 **9 处**无出处百分比（T1/T2/T3 索引段、T5 素材加载、三张素材卡模板、08 终检、pipeline-readme 标题）。
  - 规则头注释同步为「**17 类漂移**」（旧注释停在第 ⑨ 类，⑩-⑭ 加进代码时没写进文档）。
  - 测试新增**负向用例**：注入 3 处假漂移（派发卡超长 / 视图断链 / 无出处百分比），断言三条规则都能抓到——**规则必须能真的报错才算数**。

- **史实更正**：`## 2.5.2-dsh.14` 段第 1 条把 **dsh.13** 的发布记录（2026-09-11T01:18Z / gitHead `82e38c9`）写在了 dsh.14 标题下；dsh.14 的权威记录是 **01:34Z / gitHead `020e60a`**。已发布版本的段落不做改写（发布即冻结），故在此更正。

- **承接「未发布」段（CI-only，不随包产物）**：① 发布后审计改为**轮询 ≤120s** 并区分「取不到」与「取到但不一致」（dsh.14 首跑因 registry 传播延迟误判红灯）；② `latest` dist-tag 仍待维护者同步：`npm dist-tag add lunheng-article-pipeline@2.5.2-dsh.15 latest`。

**本次未做（如实记录）**：**模型分层默认化**未纳入本版——让 `cordis.patch.yml` 的三档工具带**默认 `agentOptions`**（而非依赖 `LUNHENG_*_PROVIDER/MODEL` 环境变量），需要 provider 能力探测 + 降级路径（宿主对未声明 `agentOptions` 的 provider 直接 `throw`），风险高于本版其余五项。因此当前环境下 9 个角色**仍静默继承会话模型**（`examples/preset/README.md` 已如实记载）。这是目前**唯一能同时省 token 与提质**的杠杆，建议单独一版做，并在真实 profile 上端到端实测后再发布。

**门**：`consistency-check` 0 漂移（57 个 .md）｜`repo-hygiene-check` 通过（发布包 88 文件 / 随包脚本 9 个）｜`tests` 15/15（含 3 个新增用例与 1 个负向规则用例）｜`plugin-surface` 通过。

## 2.5.2-dsh.14（2026-09-11）

- **发布运维（v2.5.2-dsh.13 发布实测反哺）**：
  1. **`2.5.2-dsh.14` 已发布**（2026-09-11T01:18Z）：`_npmUser = GitHub Actions` + `trustedPublisher`（**OIDC 信任发布自 dsh.7 以来首次恢复**）、**含 provenance attestations**、`gitHead = 82e38c9`（与 tag 提交一致）、`dist-tags.dsh → 2.5.2-dsh.14` ✓。`latest` 仍指 `2.5.2-dsh.12`（OIDC 令牌无权改 dist-tag，需维护者 granular token 或手工 `npm dist-tag add lunheng-article-pipeline@2.5.2-dsh.14 latest`）。
  2. **修正 publish.yml 的 dist-tag 步骤（实测暴露）**：旧写法在无 `NPM_TOKEN` 时仍执行 `npm dist-tag add` → 无鉴权 exit 1 → 整步失败，并因 GitHub 默认 `success()` 语义**连带跳过发布后审计**。现改为「只读打印 + 有 token 才写」，且审计步骤加 `always()` 与 `steps.publish.outcome == 'success'` 条件——缺 token 只出 warning，不再把运行弄红。
  3. 发布前新增**打包产物验证**：解包 `npm pack` 产物后确认 `scripts/_lib/` 四个模块随包、且 7 个脚本从解包副本可运行（防「相对 import 未随包」这类打包缺陷；本次为 `_lib` 重构后的必检项）。
- **`latest` 已同步**（2026-09-11，维护者手工执行）：`dist-tags = {latest: 2.5.2-dsh.13, dsh: 2.5.2-dsh.13}` ✓ —— 裸包名安装现在也拿到 dsh.13。
- **CI 两项收口（不随包变更，故无需 bump）**：
  1. 回归测试矩阵扩到 **macos-latest**（三平台）；
  2. 机械卫生门新增 **⑦ 凭据扫描**：零依赖实现 10 类模式（npm/GitHub/OpenAI/AWS/Slack/GitLab/HuggingFace token、私钥块、`_authToken`），**命中只输出掩码前缀**（不把疑似凭据原文写进 CI 日志——日志本身是泄漏面），并跳过含模式字面量的扫描器自身。
- **本次发布内容（dsh.14）**：
  1. **新增英文门面 `README.en.md`**（与中文 README 同结构：安装/内容/分档/验证/前置要求/卸载/数据流向与免责/发布/文档/许可），并加入 `package.json` 的 `files` 白名单随包分发；中文 README 顶部加语言切换行。
  2. 修正两处**继承下来的史实错误**：`skills/README.md` 的「T1-T9 定案」版本由 dsh.13 更正为 **dsh.8**（AGENTS.md 权威：v2.5.2-dsh.8 语义定案）；「T8 新增独立卡」由 dsh.12 更正为 **dsh.7**（CHANGELOG dsh.7 权威：新增 `08-终检-finalizer.md`）。
  3. 版本头日期由 `2026-09-09` 更正为 `2026-09-11`（31 个文件，继承自早期 bump 的过期日期）。
  4. `SECURITY.md` 加入 `files` 白名单随包——中英文 README 都引用它，不随包会让 npm 包页的链接 404（发布前打包产物验证发现）。
- **发布前必检**：解包 `npm pack` 产物确认 `README.en.md` 与 `skills/.../scripts/_lib/*.mjs` 均随包、脚本可从解包副本运行。

## 2.5.2-dsh.13（2026-09-11）— 第三方深度审计全量修订

- **仓库级打包面检查接入 CI + engines 对齐 DSH 运行时下限**：
  1. `package.json`：`engines.node` `>=20.6` → **`^22.19.0 || >=24.0.0`**（对齐 DSH 官方运行时下限 22.19+/24+；原范围还含不受支持的 21.x/23.x 分支）
  2. CI：`node-version` 20 → `'22.19'`（与 engines 声明一致）；新增 `plugin-surface` job
  3. 新增仓库根 `scripts/plugin-surface-check.mjs`（**CI 专用**：不在 `files` 发布白名单内、不入发布包，也不属于技能「随包脚本白名单」——它会 `npx -y` 拉取 `dsh-plugin-guide` 并执行外部包，不应扩大免授权执行面）：包装 `dsh-plugin-dev check`，把 cordis.patch.yml 合法性 / 行 id 唯一 / `dsh.bundle.patch` 指向 / package.json 元数据（engines、peers、files）/ 工程红线纳入门禁
  4. 对纯 skill bundle 的两条「代码插件」模板假设（无 `main`、无 `lib`/`dist` 产物）声明**精确到子条件**的豁免：patch 文件或入口缺失等真实回归仍拦截（已用注入回归的对抗测试验证——豁免不掩盖回归，退出码 1）
  5. 与 `consistency-check.mjs` 互补、互不重叠：后者覆盖技能内 .md 漂移，前者覆盖打包面与工程红线；CI 两道门并行
  6. **待上游修复（`dsh-plugin-dev` v0.3.7 实测）**：① 复用真实 `DSH_HOME` 的 `compat` profile 并钉住上一轮临时 tarball 绝对路径 → 二次运行必然 ENOENT（与文档「干净临时 DSH_HOME」不符）；② 安装步骤超时中止后 CLI 自身挂起不退出；③ **中止（或外部杀掉 CLI）后其 `dsh` 与 `pnpm` 孙进程会存活为孤儿**（父进程已退出、被重新挂到已死父进程下），继续占用真实 `compat` profile → 目录被锁无法删除（实测需逐个 `Stop-Process` 两个孤儿，才能释放该 profile 的 154.7 MB）。另：新建 profile 的 `allowBuilds` 五项为占位符字符串，需先填 `true` 原生构建才会执行
  7. **修复 dsh.12 遗留**：SKILL.md「随包脚本白名单」8 → 9（补列 `normalize-trust-level`，复核版本标为 dsh.12）——该脚本 dsh.12 已随包却未入白名单，按白名单语义主控本需请示才能调用；`.dsh` 镜像 SKILL.md 同步（17076 B 逐字节一致）
  8. **CI 首跑失败与修复（真实根因：npm 10 的可选 peer 缺陷，与论衡无关）**：`plugin-surface` job 在 Node 22.19 上 5 秒即败（`Process completed with exit code 1`，job 日志下载需 admin 权限，只能靠 annotation 排障）。排查链：干净克隆 + 冷缓存本地通过 → 排除工作区/缓存；本机下载 Node 22.19 复现 → 定位 **npm 10.9.3 无法安装 `dsh-plugin-guide@0.3.7`**：该包声明 optional peerDependency（`@deepseek-ai/dsh`，`optional: true`），npm 10 的 arborist 在 `#loadPeerSet` 读 `edgesOut` 崩溃；同为 npm 10 时装 `lodash` 正常 → 属该包 peer 图特有，npx / `npm install` 全不可用。修复：① 脚本改**多策略获取 CLI**（`DSH_PLUGIN_DEV_CLI` → 本地 node_modules → `pnpm dlx` 优先（pnpm 解析器不受影响）→ `npx -y`），并在失败时打印 GitHub annotation `::error::`（失败原因无需下载日志即可见）；② `plugin-surface` job 改用 Node 24（npm 11/12 正常），运行时下限仍由 `drift-check`（22.19）覆盖。本地实测：Node 24 ✅、Node 22.19 ✅（走 pnpm dlx）、全策略失败 ✅（fail-closed 退出码 1）

### dsh.13 补充：证据链、机械门与校验体系（同日第二批）

> 触发：第三方深度审计（5 个独立切片 + 宿主实现源码核验）。总评「契约 A−｜机制 B+｜验证与发布 D」。

- **证据链污染修复（P0）**：`normalize-trust-level.mjs` 旧版在卡内无任何信任级别 token 时**默认填「已发布」**——等于用最高信任档掩盖未核验数据，且让 M-Form-6 的判定正则机械判过。现改为**拒绝推断**：该条不写、列入未决清单、`exit 1` 交回 T2/人工；并默认 dry-run（`--write` 才落盘 + `.bak` 备份）。
- **机械门可靠性（P1）**：
  1. `m-gate-check.mjs` exit 语义分档 `0/1/2/3/10`（旧版 P2、`severity:LLM 兜底`、`SKIP` 一律 `exit 0`，与「任何一项不过都不得标记完成」矛盾）；新增 `--report <path>` 落盘（报告契约闭环）；参数错误改 `exit 10` 与内容失败区分。
  2. `final-check.mjs`：`dirname()` 替代硬编码反斜杠（POSIX 与正斜杠 `--report` 必崩）、`fileURLToPath` 替代 `URL.pathname`（安装路径含空格/中文时三个子脚本全部找不到 → 误报「M 门未过」）、字数改走**正文区锁定口径**（旧版传 `--full` 却被称为「字数权威值」，与简报目标区间比对会系统性偏大）。
  3. `count-chars.mjs`：缺「## 摘要」时正文口径静默退化 → 现输出 `degraded` 标记 + stderr 告警。
  4. `build-evidence-bundle.mjs`：M 门报告改读**真源** `final/M-Gate-Report.json`（旧版读 `audits/M-Gate-Report-v0.json`，而该路径**无人写入** → 审计视图的 M 门状态恒为空）；`--deep-summary` 蕴含 `--summary`（旧版单独用是静默空操作）；`--project` 参数真正生效；汉字区间与引用编号正则与 m-gate 统一。
  5. `consistency-check.mjs --fix`：旧版未导入 `writeFileSync`（执行即 `ReferenceError`，「一键修复」100% 不可用）；现改 dry-run + 显式 `--write`，并复用检查器豁免集（不再改写 SKILL.md/glossary.md 元文档）。
- **校验盲区补齐（P1）**：`consistency-check.mjs` 新增规则——⑩ 白名单集合==磁盘 ⑪ CHANGELOG 当前版本段存在性 ⑫ 任意前缀版本点位全量扫描 ⑬ docs 安装 pin/当前版本声明 ⑭ `cordis.patch.yml` 执行面红线 ⑥b M 门口径 ⑥c 非 DSH 工具名黑名单。**对抗测试 5/5 通过**（注入漂移均被抓到、还原后绿灯恢复）。此前该门报「0 处漂移」的同时，仓库实际存在 2 处陈旧版本号、3 种白名单口径、1 条永不成立的脚本契约。
- **安全与权限面（P2）**：
  1. `cordis.patch.yml` 技能路径表达式去掉 `getBuiltinModule`（改用 `process.platform` + 全局 `URL`/`decodeURIComponent`，语义等价已在两种 baseUrl 下实测），并新增**执行面披露**（7 处 `!!js` 的信任边界说明）+ CI 红线（禁 `getBuiltinModule`/`child_process`/`require(`/`import(`/`eval(`/`new Function`/`node:`/`fs.`）。
  2. `docs/faq.md` 撤回「不含 JS 代码」表述，如实披露 `!!js` 加载期求值。
  3. 新增**机制文件写保护**条款（SKILL/AGENTS）：`SKILL.md`/`AGENTS.md`/`references/**`/`scripts/**`/`cordis.patch.yml` 任何角色（含子代理）禁写，改进只写 `audits/反哺报告-vN.md` 由主人 apply。
  4. 新增**技能来源自检**条款：启动核对版本头；文档化「同名技能按 rank 就近静默覆盖」风险（项目根 `.dsh/skills/` 会顶替插件副本）。
- **CI 与发布（P0/P2）**：
  1. 新增 `scripts/repo-hygiene-check.mjs`（零依赖）：`*.mjs` 语法 / `*.json` 解析 / YAML 结构（禁制表符 + 关键文件预期键）/ 行尾无 `w/crlf|w/mixed` / 文本文件 UTF-8 / `npm pack --dry-run` 断言关键路径齐备且随包脚本 == 9。
  2. 新增 `tests/scripts.test.mjs`（9 个用例，每个对应本批一个已修缺陷）+ CI `script-tests` job（ubuntu + windows 双平台矩阵——`final-check` 的 POSIX 崩溃类缺陷只在跨平台时暴露）。
  3. `ci.yml`：`permissions: contents: read`、`concurrency` 取消旧运行、Actions **pin commit SHA**。
  4. `publish.yml` 重写：**四道门 fail-closed**（一致性/打包面/机械卫生/回归测试）→ tag 与版本一致 → **幂等守卫**（版本已发布则跳过，支持补打历史 tag）→ OIDC `npm publish --provenance --tag dsh` → **发布后审计**（`npm view <pkg>@<ver> gitHead` 必须等于本次提交）。移除 `--global-style` 与 `npm i -g npm@latest`（发布环境可复现）。
  5. **补 tag** `v2.5.2-dsh.9/.10/.11/.12`（按 npm 已发布产物的 `gitHead`，精确指向真实发布内容）。
- **行尾与编码（P2）**：新增 `.gitattributes`（`* text=auto eol=lf` + 二进制声明）；**35 个工作区 CRLF 文件归一为 LF**（index 本为 LF，内容无变化）；`.gitignore` 从 GBK + 混合行尾重写为 UTF-8/LF 并补凭据类忽略项。npm 打包读工作区而非 git blob，此行尾归一使跨平台内容（含基于 sha256 的证据包指纹）可复现。
- **文档与口径（P1）**：
  1. `read_page` → `web_fetch`（29 处 / 10 文件）：`read_page` 与 `bash` 在 DSH 中**并不存在**，却被 8 个文件声明为 standard 预设工具，并充当 T1/T2 检索熔断后的**唯一降级路径**（调用必失败 → 被误判为「检索能力受限」→ 错误降级并写进产物）。
  2. 随包脚本白名单 **7/8/9 三口径统一为 9**（SKILL/glossary/QUICKSTART/主控卡）。
  3. 删除任务简报模板残留的 v2.1.0 **心跳 / 5 段 ack / session-kill** 段（与全包「无心跳、无 ack」定案正面对撞，且该模板是每个项目都会复制的入口），替换为现行执行约定四要素。
  4. 清理 `gm_search`/`gm_record`/OpenViking/「15 项白名单」等旧生态残留概念；`docs/architecture.md` 与角色定案对齐（T8 独立角色卡 / T9 默认选中）。
  5. 修正 `examples/preset/README.md` 两处**与实现相反**的描述（「未设环境变量抛错」实为静默继承；`customSkillDirs` 的解析机制）；补「只设 MODEL 无效」提示。
  6. `CONTRIBUTING.md` 补发布纪律：bump 与 CHANGELOG 同提交、只推 tag、**一次只推 1 个 tag**（GitHub 对单次 push >3 个 tag 不触发任何 workflow，实测一次推 4 个 tag → 0 个运行）、禁止本地 `npm publish`、**已发布版本不可再改**（dsh.12 的 `engines` 漂移教训）。

### 已知限制（诚实记录，勿当已完成）

- ✅ **bundle 交付链路端到端验证（2026-09-11 完成）**——此前本机真实 profile（desktop/work）的 `dsh.profile.bundles` 均未包含本包，技能由**项目技能根** `E:\HERNESS\.dsh\skills`（rank 100）提供而非 bundle patch（rank 300），故「装一次真能挂上」长期未证。现已用一次性 profile `__lunheng_probe__` 实测三项：
  1. **安装**：`npm pack` → `dsh plugin --profile __lunheng_probe__ add <tgz>`（首跑按 `docs/troubleshooting.md` 第 1 条修 `allowBuilds` 占位符后成功，233 包）→ 副本落位 `<profile>/node_modules/lunheng-article-pipeline/`，`dsh.bundle.patch` 指向正确、`skills/lunheng-article-pipeline/SKILL.md` 随包安装 ✓
  2. **路径解析**：取出**已安装副本**里的真实 `!!js` 表达式，按 loader 语义 `with (ctx) { return eval(expr) }` 以真实 `baseUrl=file:///<profile>/` 求值 → 得到 `<profile>/node_modules/lunheng-article-pipeline/skills/`，**该目录真实存在且内含 SKILL.md（18688 B）** ✓（同时证明 `getBuiltinModule` → `URL.pathname` 的替换端到端等价）
  3. **组合树**：`dsh --profile __lunheng_probe__ --dump-config` 中 `skill-filesystem-lunheng` + `tool-subagent-retrieval/strong/audit` **4 行全部进入** ✓
  验证后已删除该 profile（释放 154.9 MB），无孤儿进程残留。**残余未测**：需要模型凭据的「会话内列出技能」一步（CLI headless 无 `DEEPSEEK_API_KEY`），风险很低（provider 挂载与目录解析均已实证）。
- **已补（第三批：消重与回归）**：抽出 `scripts/_lib/`（`han.mjs` 汉字口径 / `refs.mjs` 引用编号 / `trust.mjs` 信任级别 / `cards.mjs` 卡片切块），4 个脚本改为 import——消除 5 类复制漂移；**并用「git HEAD 版 vs 工作区版跑同一夹具逐字节对比」证明重构零行为变化**（4 项输出全等；唯一的差异是修掉了一个真 bug，见下条）。
  - **对比过程中抓到并修复一个真 bug（回归）**：`m-gate-check.mjs` 的位置参数解析在 `--report` 缺席时 `reportIdx+1=0`，会把**第一个位置参数（定稿路径）也排除**→ 不带 `--report` 的调用必然报用法错误（`exit 10`）；而 `final-check.mjs` 正是不带 `--report` 调用它 → **一键终检会误报「M 门未过」**。已修（仅当 `--report` 真出现时才排除其取值），并让 `final-check.mjs` 顺带把 M 门报告落到真源 `final/M-Gate-Report.json`（审计视图因此开箱可用）；回归用例增至 **11 个**（新增「常规调用不得判参数错误」与「final-check 落盘真源路径」两条）。
- **未做（下次迭代）**：`README.en.md` 英文门面；冒烟矩阵扩到 macOS；`gitleaks`/`trufflehog` 密钥扫描接 CI。
- **本批已补**：`SECURITY.md`（信任边界与漏洞披露）、`docs/troubleshooting.md`（9 类故障症状→原因→处置）、README 的「前置要求 / 卸载 / 数据流向与免责」三节。

## 2.5.2-dsh.12（2026-09-09）

> 本节为**事后补记**：发布时的 bump 提交标题声称含 CHANGELOG，但 `git show --stat 0d2e64c` 显示 41 个文件里并无 CHANGELOG.md——段落实为缺失，现按提交事实补齐。

- **数据卡信任级别规范化工具 + 版本发布**：
  1. 新增 `scripts/normalize-trust-level.mjs`（34 行）：与 M 门 M-Form-6 同款切块（`cardRe`）为每条 `[Dxx]` 追加独立行 `信任级别：<已发布|主人投喂|二手转引>（备注）`；已合规条目跳过，块内无 token 时回退「已发布」
  2. 配套迁移 test-paper-01/02 数据卡信任级别为独立行 → **M-Form-6 清零**（数据卡在工作区侧，未入库；该提交仅含新增脚本 1 个文件）
  3. 版本头/日期措辞统一：41 个文件（README / cordis.patch.yml / docs / examples / QUICKSTART / SKILL / references 等）纯版本发布改动，49 insertions / 49 deletions
- 版本号 **2.5.2-dsh.12**
- **遗留（已在本文件「未发布」段修复）**：SKILL.md「随包脚本白名单」未随新增脚本同步——仍写「8 个」且不含 `normalize-trust-level`

## 2.5.2-dsh.11（2026-09-09）

- **token/终检工具适配新版 DSH 存储 + 读取纪律落地**：
  1. `token-cost.mjs`：兼容目录式投影缓存（`storages/session_projcache/sessions/*.json`，保留旧单文件回退），清理 `topMode` 死代码；
  2. `m-gate-check.mjs`：修复 M-Form-4/5 子串误报（`自主控制`/`板卡级别` 负向前瞻）与 M-Form-8 编号章节标题豁免（结论/展望入豁免）；`final-check` test-paper-02 复跑 exit 0；
  3. 任务简报约定：含 `子问题 A/B/…` 与 `需找数据点 ≥N 条`（M-Integrity-1 机器可读）；
  4. 新增 `references/dispatch-cards.md`（T1-T9/G14 派发开工卡）并写入 pipeline-readme「共享读取纪律」：spawn prompt ≤800 字、禁复制角色卡全文；
  5. SKILL.md 已拆分为入口精简版（33KB→16.9KB，前置于 dsh.10/dsh.11 发布内容）。
- 版本号 **2.5.2-dsh.11**（npm tag `dsh` 与 `latest`）。

## 2.5.2-dsh.10（2026-09-08）

- **独立化为 DSH 原生插件（脱离历史外部生态定位）**：
  1. 全库清除历史外部生态表述（工具名映射 / 净化发布 / 版本线引用 / 历史适配类措辞），覆盖 SKILL/AGENTS/角色卡/glossary/pipeline-readme/docs/README/CHANGELOG/package.json/cordis/示例
  2. SKILL「DSH 环境说明」改写为 DSH 原生（删除旧工具映射表与移植叙述）；AGENTS/CONTRIBUTING/FAQ 独立重写
  3. 版本头措辞统一为「（DSH 原生插件，自动同步 …）」；consistency-check 版本头正则同步放宽
  4. 清理冗余：删除 `references/_shared/archive/`（legacy-docs/legacy-protocols/M-Gate 历史版）、`版本升级自审门-v2.3.0.md`、`执行韧化协议-v2.1.0.md`、仓库内 `.dsh/adapt-backup` 快照；历史演进以 git log 为准
  5. 悬空引用清扫：角色卡韧化协议指引改指 DSH 执行约定；M-Gate/README 归档引用移除
- 版本号 bump 至 **2.5.2-dsh.10**（发布待主人指示）。

## 2.5.2-dsh.9（2026-09-08）

- **test-paper-01 实战轮反哺修订（commit `2cf2ea2` + 版本 bump）**：
  1. 检索角色「发布即核验」硬闸（T1：DOI/arXiv/URL 落卡前必须核验，占位=未核验，禁止占位 DOI 进卡）
  2. 反凑数纪律 + 卡片禁写结论性解读（T2）+ 案例卡来源独立性必标与落盘自检清单（T3）
  3. 卡片必填字段提示同步 4 个模板（信任级别/检索截止日期/来源独立性）
  4. T5/T6 去内部化词表 + 读者视角通读 + T5 数值自洽预检；T7 数值自洽验算专项 + 卡字段必查
  5. M-Form-5 禁词表扩 9 项内部流程词（M-Gate-Algorithm 文档 + m-gate-check.mjs 脚本双同步）
  6. 子代理韧性增强（交接状态四要素 + fail-fast 重派）+ 退化路径版本规则（跳过 Phase 3.5 时 v1→v2 不跳号）
  7. 降级授权强约束：跨档降级必须主控暂停 + 主人请示，禁止子代理自行声明降级后继续

## 2.5.2-dsh.8（2026-09-07）

- **12 个 token 优化 commits 合并发布**（基于 v2.5.2-dsh.8，平台-gig 项目实测 cacheRead 191M → 预计 80-90M，省 50~55%）：
  1. `a31a03c` 角色卡瘦身 + Phase 1.5 拆任务 + 审计视图
  2. `eb53def` T5 段级 diff 模式（修订轮 60-105 步 → ≤25 步）+ T2 失败熔断
  3. `6112c72` 一键终检 final-check.mjs（count-chars + m-gate + build-evidence 串联，5-8 分钟 → 1 分钟）
  4. `6639dce` T1 文献检索失败熔断 + T6 段级攻击清单（单会话 88 步 → ≤30 步）
  5. `01e8482` count-chars.mjs 加 --summary 模式
  6. `1013fd4` build-evidence-bundle.mjs 加 --deep-summary 模式（含 L/D/C 前 30 条素材卡）
  7. `a3c49bc` final-check.mjs 加 --json + --report 模式
  8. `bb251d6` m-gate-check.mjs 加 --summary 模式
  9. `d331f84` 任务简报加 Phase 1.5 触发字段（trigger + 必补关键词 + 拆任务约束 ≤30 步）+ 主控读字段指引
  10. `44e3dd0` 04-分析 + 05-写手 卡加 Phase 1.5 触发字段读取指引
  11. `6d0d886` 06-批判 + 09-审稿 卡加 Phase 1.5 触发字段读取指引
  12. `8435952` 07-审计 + 08-终检 + status-template + consistency-check --fix + token-cost --top
- **9 层 Phase 1.5 trigger 决策一致性**：主控 + 任务简报 + T4/T5/T6/T7/T8/T9 全部读取同一 trigger 字段，避免每次 LLM 副产物判断的不一致性
- **一键修复**：`node scripts/consistency-check.mjs --fix` 自动修复「（检查）」占位符等可逆漂移
- **性能调试**：`node scripts/token-cost.mjs --top N` 按 cacheRead 排序取前 N 会话，秒定位 cache 消耗大头
- **一键终检**：`node scripts/final-check.mjs <项目> [--no-summary] [--json] [--report PATH]` 串联 count-chars + m-gate + build-evidence

## 2.5.2-dsh.7（2026-09-07）

- **角色语义定案（主人指令）**：
  - **9 个独立角色 T1-T9 互不可替代**（文献/数据/案例/分析/写作/批判/审计/终检/审稿）——每个都有独立角色卡 `references/agents/01~09`
  - **主控 = T0 调度 + T8 终检执行双重身份**：T8 终检是独立角色，执行者由主控担任、不 spawn 子代理 → **新增 `references/agents/08-终检-finalizer.md`**（此前 T8 无独立角色卡，语义修正为「独立角色 + 主控执行」不矛盾）
  - **T9 审稿可选但默认选中，学术论文必选**（废止 v2.4.6「公众号默认关闭」口径；行业分析/商业评论/公众号默认选中、主人 Phase 0 可取消）
- **T8 终检自动化新增**：
  - `scripts/build-evidence-bundle.mjs`：一键自动生成 `final/证据包/`（文献卡/数据卡/案例卡/先行者清单/大纲/批判报告/审计报告/复核报告/反哺报告/修订说明*/status/任务简报），取代手工复制
  - AI 使用声明三版本模板（学术/出版/公众）：`references/templates/AI-使用声明-template.md`
  - 主人确认单模板（Phase 2.5/3.5/5 人在环节点标准化）：`references/templates/主人确认-template.md`
- **写作字数约束**：反方段每派 ≤150 字硬上限（防反方喧宾夺主）+ 写完自跑 `count-chars.mjs` 取实值
- **版本号全库同步** v2.5.2-dsh.6 → v2.5.2-dsh.8（33 个 .md 版本头 + package.json + cordis.patch.yml + examples）

## 2.5.2-dsh.6（2026-09-06）

- **稳定性三件套（测试轮复盘）**：
  - **子代理失败三段式处理**：落盘校验 → 产物完整则 `send_message` 续接原子代理 → 缺失才重派；连续失败先查 DSH 环境（教训：测试轮三检索员全失败 + T5 两次结算异常）
  - **配图意向回写**：Phase 2.5 拍板后主控必回写大纲配图段 + 派 T5 显式传图位（教训：拍板要图但大纲写 0 张，T5 删图位）
- **口径统一**：
  - **字数口径单一锁定** = count-chars.mjs 正文区纯汉字（教训：3998/4310/4060 三口径漂移）
  - **证据数量区分**「检索量（数据卡）」vs「引用量（正文）」，大纲/引言只声明引用量（教训：大纲22/数据卡27/正文26 漂移）
- **引用核验强化**：二手转引必须回查原始报告核实「口径是否对应」（教训：D09 高中生抄袭口径被误引为 AI 调查）
- **T9 时序声明**：G14 未产出时以 T7 G5 兜底并显式声明「G14 待补」
- **[EB/OL] 著录扩展**：数据来源/案例来源网络条目同样按 GB/T 7714 [EB/OL] 著录（教训：32 条网络来源缺著录，T9 引文规范 3 分）
- **期刊库扩充**：补教育技术类（中国高教研究/中国电化教育/电化教育研究/开放教育研究），中文 24→28 个
- **G14-C 主题词豁免**：命中词若是标题/关键词/核心论点里的主题词（如「路径」），不计入学术套话命中（教训：测试轮「路径」11 处误报）
- **status.md 维护轻量化**：开始/完成时间可省略，时间戳由 agents-log.md 承担（减轻主控逐字段维护负担）

## 2.5.2-dsh.5（2026-09-06）

- **M 门 13 项全脚本化（M 门 14 项反思落地）**：`m-gate-check.mjs` 从 5 门（M-Form-1/3/5/7 + M-Exist-2）扩到 13 门（M-Form 1-8 + M-Exist 1-3 + M-Integrity-1），引入严重度 P0/P1/P2 分级 + exit code 分级（P0→2 / P1→1 / 仅 P2 或全过→0）
  - M-Form-1 阈值提升 L≥3；M-Form-2/7 白名单统一 5 节；M-Form-4 黑名单转白名单（剥离引用/数字/机构后查内部代码）；M-Form-5 扩弱 AI 痕禁词；M-Form-6 双格式 + 描述字段交叉验证；M-Form-8 每论点强制含 L + coverage≥2
  - **M-Form-8 前置段修复**：排除摘要/关键词/引言/结语（防无引用摘要/引言被误判「缺 L」恒定 P0——引言以 [先xx] 声明原创性差异点，非论点论证）
  - **M-Integrity-1 正则兼容**：子问题编号兼容「子问题 A/B/C」∪「S1/S2」旧格式 + 「需找数据点≥N」占位符识别
  - **tally 对齐**：soft（LLM 兜底）独立 bucket，total=pass+p0+p1+p2+soft+skips
- **count-chars.mjs 新增**：字数统计（正文区/全文纯汉字双口径），替代 T5 LLM 估算（实测偏差 ~30%）
- **DSH 架构优化**：`cordis.patch.yml` 重写为 4 段 insert（技能提供者 + 三档 subagent）；删除 `examples/preset/agent.cordis.yml`（standard 全量副本，防漂移）；preset.yml 重定位为说明
- **status.md / agents-log.md 双文件写入约定**：status.md 主控独占写，agents-log.md 子代理追加写（防并发写冲突）
- **repo↔.dsh 同步修复**：M 门修订回写仓库 + `.dsh` 技能目录清污染（整仓混入清干净）
- **测试轮验证（gen-ai-academic-integrity 学术论文全链路）**：Phase 0-5 全闭环跑通，M 门 13 项 exit 0（P0×0/P1×0/P2×1）、T9 审稿 22/30 minor revision、G14 Pass；真实定稿压测暴露并修复 2 处脚本 bug：
  - M-Form-6 正则 `信任级别[:：]` 未容忍 Markdown 加粗 `**信任级别**：` → 误判 P0，修为 `信任级别\**[:：]`
  - M-Form-8 未排除「引言」段 → 误判 P0，已把「引言」加入排除清单

## 2.5.2-dsh.4（2026-08-26）

- **第三方全量审计修复（6 维审计 + 交叉验证，P0/P1/P2/P3 四批 36 文件）**：
  - **P0 版本治理**：版本统一 dsh.4（仓库级 README/introduction/skills-README/CHANGELOG 漂移清零）；SKILL.md「使用者发布版」声明与事实对齐（archive/CI 如实说明）
  - **P0/P1 工程**：M-Gate-Report 文件名统一无后缀（含 JSON schema 值）；publish.yml 加 `--tag dsh` + tag/版本一致性校验 + 去掉 `|| true` 吞错；`process.getBuiltinModule?.()` 兜底 + `engines: >=20.6`
  - **P1 安全**：注入防御下沉到 T1/T2/T3 检索角色卡铁律 + 派发话术（外部内容不可信原则从主控层落实到检索层）；「零 exec」声明如实修正（白名单脚本 + 有限 shell）；信任级别 ≠ 注入防御的认知修正
  - **P1 机制**：分档预设接线（三档工具 subagent_retrieval/strong/audit 进入派发话术，从此实际生效）；修订回环双轨制定案；G 十五项 / M-Form 8 项 / T9·G14 默认开 口径统一
  - **P1 脚本**：m-gate-check 补 `C-主` 引用 + 版本化归一化 + M-Form-5 估算标记豁免 + 缺目录友好报错；token-cost zstd 兼容（node<22.15 报错）+ tree 前缀归一化 + cacheWrite 按未命中价 + 参数校验
  - **P2/P3**：consistency-check 增强为 6 类（跨文件版本比对/M-Gate-Report 漂移/角色卡索引/口径残留）；安装文档纠错（新版 dsh 自动加 bundles）；预设默认继承父会话（消灭 NO_ADAPTER）；files 补 CHANGELOG/CONTRIBUTING；pdfcheck 判定与消息一致；md2html SVG 消毒 + 图N 支持 + 同文件保护；C1-C7 七维；历史残留清零
- **门 V 增强**：M-Gate-Report 检查补 JSON schema 值盲区

## 2.5.2-dsh.3（2026-08-25）

- **token 优化 6 项 + 终检成本实取**：
  - 卡片索引/分层加载：主控启动 ~35K 降本（启动速查表，glossary/pipeline-readme 按需查概念再读对应节）
  - 注解聚合：角色卡/文档历史分层注解不再逐层堆叠，同主题合并为单行「v2.5.2-dsh 补丁，教训：…」格式（防文档随版本膨胀）
  - M-Form 脚本化：M-Form-1/3/5/7 + M-Exist-2 由 `scripts/m-gate-check.mjs` 纯正则/哈希判定（零 LLM），T8 只判 M-Form-8 + 复核（省 ~12K token）
  - 终检成本实取：`scripts/token-cost.mjs --sessions/--tree` 读会话投影缓存，实取 token 四类 + 估算成本
  - 执行韧化协议压缩：DSH 精简版（状态机 + 交接报告六要素 + 三播报），完整版移作参考
  - pdfcheck 入库：`scripts/pdfcheck.mjs` 原始字节校验 PDF（/Page /Font /ToUnicode /CIDFont）
- **全量检查清理**：consistency-check 新增 2c「scripts/ 引用完整性」检查；写手卡精简段；M 门预检前置到 T7

## 2.5.2-dsh.2（2026-08-22）

- **第三方评审 P0-P2 全修复**：
  - 一致性自检脚本 + CI：`scripts/consistency-check.mjs`（P0-1 四类漂移自动检测）+ `.github/workflows/ci.yml`（push/PR 自动跑，exit 0 才通过）
  - 占位符标记：「（检查）」占位符净化剥离标记，SKILL.md/glossary.md 豁免
  - 门数口径统一：M 门 13 项 / 自审门 21 门（含门 V）口径对齐；QUICKSTART 触发关键词收紧（8→4 核心 + 强制 Phase 0 确认）
  - 启动清单与快速开始分层；M-Form-7 文末白名单 v2.3.5 + M-Form-8 三角验证 v2.3.7 归位

## 2.5.2-dsh.1（2026-08-22）

- **15 项实战反哺改进**：
  - 写盘校验：subagent 完成事件早于写盘落盘 → 完成通知后 wait 30s + 双重 ls 再读（写盘延迟双重校验）；写手写盘后立即 read 验证非空 + 关键标题存在
  - Phase 1.5 定向补检索：T4 大纲标「待复核 [Dxx]」或「缺口论点」→ 主控 spawn T1 补检索（关键二手数据定向回查 + 缺口论点补检索，Permanent Gap 标注）
  - 字数层级：任务简报显式二选一写入 + Phase 2.5 主人拍板（v1-v3 全超 +3-9% 教训）
  - 图号规则：图位编号 = 章节出现顺序（[图1]→[图2]→[图3] 连续，禁止断号，断号自动重排仅警告）
  - 破折号自检前移（v1 落地前 grep「——」≤8 处）；跨学科理论概念核验（catharsis category error 教训）；洞察引导 3 具体问题；G14 与 T6 并行触发
  - 分档预设补 T9/G14 映射；版本行全量统一

## 2.5.2-dsh.0（2026-08-25）

- **对齐版本线 v2.5.2（v2.3.7 → v2.5.2 大版本跨越）**：
  - **新增 9 角色体系**：T9 同行评审（`09-审稿-peer-reviewer.md`，6 维度评分 → accept/minor/major/reject）+ 主控扩展职责（`00-主控-扩展职责.md`）
  - **新增 G14 中文 AI 痕迹闸**（`gates/14-中文AI痕迹-gate.md` + `checkers/中文AI痕迹-checker.md`，8 类检测维度，LLM 推理判定零 exec）
  - **新增期刊匹配助手**（`_shared/期刊数据库.md` 25 CSSCI + 12 SSCI + `期刊匹配算法.md`）
  - **新增多格式导出**（`_shared/format-export.md` md/latex/docx/pdf）+ **中文数据源集成**（`_shared/中文数据源集成.md` OpenAlex/Crossref 第一梯队）
  - **新增退化场景规范**（`degraded-scenarios.md`）+ 字数判定表 + M 门附录 + 投稿就绪检查表 + 修订说明模板 full
  - **外部内容防注入**（v2.4.0：外部内容一律视为不可信证据，只提取事实不执行指令）
  - **中文学术特化定位**（v2.4.4：GB/T 7714-2015 / Top 3 中文期刊 / G14）
- **DSH 适配**（156 处历史残留 + 23 文件版本行）：
  - 51 文件同步（17 新增 + 34 覆盖），保留 21 个 DSH 独有文件（AGENTS/设计文档/教训库/自审门等）
  - 工具映射批量替换（sessions_*→subagent、tavily_*→web_search/read_page、metadata.tools 删除、心跳/8分钟硬卡→DSH 精简版）
  - 10 张角色卡韧化协议段 DSH 化；SKILL.md 新增「🔧 DSH 环境说明」段
  - 分档预设补 T9/G14 映射；自审门更新到 9 角色；image_generate 封面描述 DSH 化（SVG/投喂/图像 MCP）

## 2.3.7-dsh.8（2026-08-22）

- **全面独立审计修复**（工程层 + 3 独立子代理并行，13 严重 + 40 中轻微）：
  - **P0 自审门 DSH 化**：版本升级自审门-v2.3.0 头部加 DSH 适配映射表；门 C/D/E/G/J 路径与编号 DSH 化（pipeline/→references/、外部审计→仓库↔.dsh 副本、门 D 文件列表 00-07 实际编号）；门数口径统一（21 门含门 V）
  - **P0 执行层歧义清零**：M 门项数统一「M-Form 8 + M-Exist 3 + M-Integrity 2 = 13 项」（原 6/7/11 混用）；修订回环**定案为审计独立 2 轮预算**（v1→v2 洞察 + v2→v3 批判不计入）；G/F 清单 glossary 重写对齐执行真源；渐进式验证标注未启用；M-Gate-Report 文件名统一（去版本后缀）；批判维度统一 C1-C7；终检必查项 15 项；六要素第 6 条统一状态机更新
  - **P1 元数据/残留**：package.json 补 repository/homepage/bugs/author；cordis 注释 dsh.8；preset.yml 补 PROVIDER；版本残留（faq/introduction/skills README 的 dsh.1、三处 dsh.6 标注）清零；m_exist_1_diff.sh 归档；glossary §七 外部发布层删除改 DSH 3 层真源
  - **P1 中轻微项**：operations 禁做#3、任务简报 M-Form-4/T3.5、errors 三处旧编号、架构篇 Phase 3.6/6 阶段、数据卡残字符/测算者、侦查→检索、案例封顶矛盾、status 8 分钟硬卡、SKILL 重复行、损坏链接、死锚点等 40 处
  - **P2 门 V 固化**：自审门新增「门 V：DSH 口径一致性」，机械化检查 M 门项数/Report 文件名/C1-C7/修订回环语义/旧编号，防本轮问题复发

## 2.3.7-dsh.7（2026-08-22）

- **角色卡模型设定去硬编码（通用化收尾，v2.3.7-dsh.6 的延续）**：
  - `07-审计-auditor.md`：删「主模型 claude-opus-5（kkaiapi 接口）」+ 历史 fallback 链 → 「审计档定位顶配防漏判，不写死具体模型名；超时换档重派」
  - `pipeline-readme.md`：删「claude-opus-5 → deepseek-v4-pro → minimax-M3 fallback 链」→ 「DSH 无脚本级 fallback 链，换档重派」
  - `operations.md`：模型建议表「如 deepseek-v4-flash/minimax-m3」示例 → 纯能力定位（便宜快/推理强/顶配）；删历史 fallback 链 4 档
  - `status-template-lite.md`：模板写死「当前模型: deepseek-v4-pro」→ 「继承会话模型或分档指定」
  - `00-主控-coordinator.md`：删「自动兑底路径：模型路由顺序（deepseek-v4-pro → minimax-M3 → ...）」→ 「换档重派路径（DSH 版）」；命名隔离示例 `06-v2-attack.deepseek-v4-pro.md` → `<模型名>`
  - `SKILL.md` 核心原则 5：模型分工示例名 → 纯能力描述（不写死具体模型名）
  - **门 U 同步修订**（版本升级自审门）：原检查「claude-opus-5 fallback 链 + 1-token ping 预检」与删除的硬编码冲突会自审 FAIL → 改为 DSH 版（检查「不写死模型名 + 换档重派 + 异常标注」）
  - 设计原则：能力描述（便宜快/推理强/顶配）→ 角色卡/文档；具体模型名 → 只在分档预设默认值（可覆盖）+ settings.yaml

## 2.3.7-dsh.6（2026-08-22）

- **模型配置通用化（通用插件诉求）**：
  - **单模型配置零配置可用**：不装预设，所有角色继承会话模型，任何 dsh 模型配置都能跑（通用性兜底）；
  - **多模型按角色能力分档**：分档预设默认「检索便宜快 / 分析写作批判推理强 / 审计顶配」，各档可经 `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_PROVIDER` + `_MODEL` 覆盖；
  - **预设补 provider 字段**（DSH 架构要求：`agentOptions.provider` 与 `model` 分离，跨 provider 必须同时指定两者，否则 dsh-llm 报 NO_ADAPTER）；
  - **修正无效示例**：`LUNHENG_AUDIT_MODEL=claude-opus-5`（用户环境无此 provider）→ 实际可用模型（minimax/MiniMax-M3 + provider 指定）；
  - 涉及：examples/preset/agent.cordis.yml + README、SKILL.md（模型分配段+分档表）、AGENTS.md、pipeline-readme（调度模型段）、docs/{installation,usage,introduction}.md、skills/README.md；
  - 技术验证：DSH `!!js` 仅求值标量（js-yaml scalar type），条件注入 provider 对象不可行 → 采用「固定默认 + 双环境变量覆盖」方案；新预设经 dsh --dump-config 加载验证 exit 0

## 2.3.7-dsh.5（2026-08-22）

- **定稿文末两处必填规范**（主人终稿评审确立，固化到 deliverables.md 真源 + pipeline-readme 终检项 14/15 + 00 主控卡 ⑭ + 05 写手卡铁律 9/12）：
  - **① 先行者差异声明**：`## 先行者文献` 节后必附 `> **本文与先行者的差异（原创性声明）**` 段——聚焦**主要论点/分析范式差异**（2-3 句），先诚实声明「不宣称首创」，再点差异（证据分级框架/中文语境等）；禁止罗列 4-5 点细节清单
  - **② AI 使用声明一句式**：`## AI 使用声明` 节内容限制 1-2 句（AI 生成 + 引用真实可核验 + 经审计），禁止展开多条 bullet；完整版披露留给交付说明

## 2.3.7-dsh.4（2026-08-22）

- **实战改进 9 项沉淀**（基于《AI 编程助手对开发者效率的影响》实测，教训源自 [L03] 量级两轮纠错 / METR 转述失真 / 引擎额度耗尽 / status 并发写冲突）：
  - **P0-1 跨卡冲突修订铁律**（05-写作卡）：数字冲突先回查一手来源定正确值，禁止「对齐式统一」掩盖基准错误
  - **P0-2 出处层级**（02-数据卡）：样本特征二次转述标「摘要/正文/博客」层级，摘要未出现默认待复核
  - **P0-3 审计核验两档标注**（07-审计卡）：存在性核验 ≠ 数字级核验；PDF/反爬源用 Crossref/DOI 兜底
  - **P1-4 检索引擎容错**（01/02/03 检索卡）：引擎失败即切换备用/read_page，中文源缺口显式上报
  - **P1-5 修订复核关闭/未关闭显式化**（07-审计卡）：未关闭条目一律升级，修订说明「已处理」≠审计「已关闭」
  - **P1-6 status.md 只读约定**（AGENTS.md + 派发话术）：status 主控独占写，子代理只读 + 交接报告回报
  - **P2-7 接受脆弱剩余风险入交付说明**（pipeline-readme 终检必查项 12）
  - **P2-8 启动标记文件**（派发话术）：子代理启动写 `analysis/Tn-启动.txt`，主控快速判断进度
  - **P2-9 反哺 merge 清单**（pipeline-readme 终检必查项 13）：反哺建议列入交付说明 checklist 等主人 review

## 2.3.7-dsh.3（2026-08-22）

- **文档深度清理（第二轮独立审计）**：净 -447 行
  - **历史专属机制归档**：`执行韧化协议-v2.1.0.md` + `通用韧化块-v2.1.0.md` 移入 `references/_shared/archive/legacy-protocols/`（心跳/分阶段 ack/模型预检/8 分钟硬卡/`subagents(action=list)` 伪代码均为历史机制，DSH 用不上）；8 张角色卡 + AGENTS.md 引用改指 DSH 执行约定
  - **DSH 事实矛盾修复**：`image_generate`/OpenAI gpt-image-2→gemini→minimax fallback 链 → SVG 矢量风/主人投喂/图像 MCP；`exec 被 deny` → DSH standard 预设含 `pwsh`/`bash`；Tavily/Ollama fallback → DSH web provider/本地模型；`~/.DSH/agents/*.trajectory.jsonl` 诊断 → `list_agents`
  - **冗余清理**：16 个文件头部 12-13 行自动同步版本行堆叠压缩为 1 行 DSH 版本；SKILL.md 重复 T8 行/重复工具条目；status 模板心跳/ack/降级记录段精简
  - 涉及 SKILL.md / AGENTS.md / QUICKSTART.md / pipeline-readme.md / glossary.md / 8 张角色卡 / 4 个模板 / 3 份设计文档，共 27 文件

## 2.3.7-dsh.2（2026-08-22）

- **工程层编号同步审计修复**：README.md / docs/{introduction,usage,architecture,faq,installation}.md / examples/preset 全量对齐 v2.3.7 编号（T3 案例/T6 批判/T7 审计、T7.5 门、分档表 T1-T3/T4-T6/T7）；package.json description、cordis.patch.yml 注释同步

## 2.3.7-dsh.1（2026-08-22）

- **对齐 v2.3.7 版本线全量升级**（43 提交 / 60 文件 +6996 行）：
  - **角色编号重构（v2.3.0）**：T1 文献 / T2 数据 / T3 案例（原 T6）/ T4 分析（原 T3）/ T5 写作（原 T4）/ T6 批判（原 T8）/ T7 审计（原 T5）/ T8 终检=主控亲完成——编号 = 流水线 Phase 顺序
  - **M-Form-7 定稿文末白名单硬门**（v2.3.5）+ **渐进式 M 门验证**（v2.2.15）+ 阶段闸门 T2.5/T7.5
  - **lite 模板族**（7 类 × full+lite）+ 图表-SVG 模板 + 版本号自动化（scripts/check-version.sh）
  - **新文档**：glossary.md（单一真源词汇表）/ errors.md（错误友好化）/ 设计文档-哲学/架构拆分 / QUICKSTART.md
  - **人在环纠偏**：Phase 3.6 批判非人在环节点（教训 #138）；删 T2.5 主人签字（教训 #136/#137）
- **DSH 适配**：8 张角色卡全部 DSH 化（执行约定精简 + 分档预设 T3 案例→retrieval/T6 批判→strong/T7 审计→audit）；机械替换 + 深度审计修复（workflow 3 组 × 全文件，修复旧编号残留/历史遗留机制/坏引用/矛盾 100+ 处）

## 2.2.8-dsh.3（2026-08-19）

- **实跑反馈的 10 项改进**（试运行《AI 让你写得快，但未必让你更会写》后沉淀）：
  1. **T2.5 门逻辑修正**：数据需求基准从「大纲 D 列数」（T2.5 在大纲前，不存在）改为「任务简报数据需求声明」
  2. **子代理异常兜底协议**：failed 通知 → 验产物/验 status/验口径 3 步，不默认重跑
  3. **简报不预转述数据**：任务简报加「数据需求声明」字段，只写需求不写内容（防 Phase 0→1 漂移）
  4. **文献作者必核**：文献卡模板 + T1 话术禁止「作者待核」占位
  5. **数据卡计数自检强制**：T2 交付前必须核对头部声明条数 vs 实际条目数
  6. **派发话术自读角色卡**：7 段话术统一加「先读 references/agents/0X-xxx.md」
  7. **分档预设推荐**：全量长文优先「论衡分档」预设（检索 flash / 分析写作审计 pro）
  8. **汇报粒度约定**：默认阶段级汇总，异常/打回才即时打断
  9. **M 门引用模式前置**：简报显式记录内联/编号模式，M 门执行前确认
  10. **证据包指纹 SHA256**：M-Exist-2 补 Windows `Get-FileHash -Algorithm SHA256` 命令

## 2.2.8-dsh.2（2026-08-18）

- **深入质量审计修复**（workflow 5 组并行 × 36 文件 × 6 维度，~130 处问题）：
  - **去除 DSH 用不上的历史残留**：删除 `m_exist_1_diff.sh`；fallback 链 / `include_domains` / `session-kill` / 15 项白名单 / `fc-list`/`ls -la`/`sha256sum` 等 bash 命令改 DSH 等价；`/tmp` 路径适配 Windows
  - **修复 8 处 SOUL.md 坏引用**（上游旧档已删）→ `failure-modes.md` / 设计文档；README/scripts/lessons.md/workspace-paperwriter 等无效引用修正
  - **统一口径**：M 门 6+3+2、M-Gate-Report-v2.2.4.json、T6 任何量级必 spawn、T8 可跳过、G0-G13、终检必查 13 项、交接报告六要素（5 卡补齐）
  - **版本升级自审门 DSH 化**（门 C/D/E 改为仓库/活动副本/npm 路径）

## 2.2.8-dsh.1（2026-08-18）

- **对齐 v2.2.8 版本线全量升级**（41 文件重构基线）：
  - **8 角色**：新增 T8 批判伙伴（C1-C5 反方攻击，Phase 3.6，轻量档可跳过）
  - **审计 G0-G13**（新增 G11 时效告警 / G12 信任级别一致性 / G13 AI 使用披露）+ **M 门**（M-Form 6 + M-Exist 3 + M-Integrity 2，LLM 兜底执行，零 exec 依赖）
  - **T2.5 / T5.5 阶段闸门**（主控 checkpoint）+ 修订回环 ≤2 轮硬约束 + Acknowledged Limitations 模式
  - **字数分层**（≥5000 全量 / 3000-5000 标准 / 2000-3000 轻量跳 T8 / <2000 简化）
  - 文档分层：SKILL.md 瘦身，机制详情进 `references/`（设计文档 / deliverables / operations / case-studies / `_shared/`）
  - 模板拆分为 7 个（新增文献卡 / 数据卡 / 先行者清单模板）
- **DSH 适配**：8 张角色卡全部 DSH 化（执行约定精简版：状态机 + 交接报告六要素 + G8 自检 + 超时介入 `list_agents`，移除心跳/ack/预检/8 分钟硬卡）；工具映射 subagent/web_search/todo_write/list_agents/SVG 降级；分档预设新增 T8 归 strong 档
- **删除**：SOUL.md（历史上游 v2.2.8 已移除，内容并入 SKILL.md）

## 2.1.8-dsh.3（2026-08-18）

- npm 包补入 `docs/` 与 `examples/`（分档预设随包发布；2.1.8-dsh.2 漏配 `files` 清单，tarball 未含此二者）

## 2.1.8-dsh.2（2026-08-18）

- 新增「分档预设」`examples/preset/`：三档 subagent 工具按角色分模型（`subagent_retrieval`/`subagent_strong`/`subagent_audit`），模型经 `LUNHENG_*_MODEL` 环境变量覆盖，默认检索档 `deepseek-v4-flash`、分析写作档/审计档 `deepseek-v4-pro`
- 技能内「成本与模型建议」与派发话术同步标注分档工具，未挂载时回退 `subagent`
- 执行韧化协议精简为「执行约定（DSH 精简版）」：保留状态机 + 交接报告六要素 + G8 自检 + 超时介入（`list_agents`），移除心跳/ack/预检/8 分钟硬卡

## 2.1.8-dsh.1（2026-08-17）

- 首个 DSH bundle 发布（npm + GitHub）
- Phase 1 三检索员三方真并行、互不干涉：T1 文献 ∥ T2 数据 ∥ T6 案例（教训 #56 + #58）
- T6 案例检索员「任何量级必 spawn」，含 0 条场景空卡协议（输出 [C-空] 空卡，不阻塞主流程）
- Phase 0 增加「cases 需求（含 0 条场景显式声明）」，取消旧的三档（轻/中/重）分流
- 完整 DSH 工具适配：`sessions_spawn`→`subagent`、`tavily_search`→`web_search`、`update_plan`→`todo_write`、`sessions_history/list`→`list_agents`、`image_generate`→SVG/投喂、`exec`→`pwsh`/`bash`
- 审计统一为 G0-G11 全项检查；交接报告统一为六要素
