# 交接门（handoff-check）规格 v1

> **状态**：**已实现（v18.6.0，commit `c4779af`）**。本文件原为「规格（未实现）」，v18.6.0 已按 §12 三岔口决策落地——退出码 20/21/22、`handoffLevel` 默认 `basic`、回报侧强制进闸门实据列；实现走主人显式授权 + AGENTS.md 安全流程（改前备份 + 四道门 + 镜像同步）。
> **依据**：v18.5.0 工作树实测（含未提交的 v18.5.1 preflight 反注改动）。
> **位置说明**：本文件放在 `docs/审计与修订记录/`（**不在 `package.json#files` 白名单内**），故不进 npm 包、不受 `repo-hygiene-check` 规则⑨ 词预算门约束。

---

## 0. 一句话定位

把主控**收报后的第一动作**（产物落盘校验 + 回报齐备性）从手工 `read`/`ls` 变成一次**只读工具调用**。

它是既有 **派发前 preflight 反注**（v18.5.1，`pipeline-readme.md` §共享读取纪律）的**收报侧对偶**：

| | 派发侧（已有） | 收报侧（本规格） |
|---|---|---|
| 时机 | spawn 之前 | settle 之后 |
| 做什么 | 拿上一版产物跑 M 门，把机检契约**反注进派发话术** | 拿本版产物跑交接门，**验收**契约是否被满足 |
| 解决 | 产出者不知道契约 → 打地鼠 3 轮 | 主控人工读文件判断 → 漏检、返工、空转 |
| 性质 | 契约**下发** | 契约**验收** |

---

## 1. 现状与缺口（实测证据）

| 事实 | 出处 |
|---|---|
| **交接报告 = 回报本身**（六要素，≤10 行，**不单独落文件**） | `references/pipeline-readme.md` L250「两轨各司其职，不存在第三个交接文件」 |
| `agents-log.md` = 落盘的中断续接快照（每角色任务**开始与结束**各追加四要素） | 同上 + `templates/交接报告-template-lite.md` |
| **落盘校验 = 主控手工动作**（产物三要素：路径存在 / 非空 / 结构完整） | `references/agents/00-主控-coordinator.md` L50 |
| 该动作的漏检已造成实战损失 | 同上：某轮 T7 产出了 M 门报告却缺审计报告+反哺报告即结束（写盘前失败），**靠主控顺手 `ls` 才发现** |
| 机械门**只在终点**：M 门 22 项 + `final-check.mjs` | `scripts/m-gate-check.mjs` / `final-check.mjs` |
| 中途边界（每个收报点）**无任何机械门** | 全库无 handoff 校验脚本（`scripts/` 14 个脚本，均不含此项） |

**缺口一句话**：论衡把"可复核"做进了终点（M 门），但**没做进中途的每个交接点**——而错误在中途拦截的成本远低于终点。

---

## 2. 检查对象与两种模式

| 模式 | 输入 | 性质 | 是否必跑 |
|---|---|---|---|
| **A · 产物侧** `--project <dir> --role <Tn>` | 项目目录 | 可离线核（文件系统是唯一真源） | **必跑** |
| **B · 回报侧** `--report <文本>` 或 `--report-file <路径>` | 子代理回报原文 | 只能核"齐不齐"，**不能核"真不真"** | 给了才跑 |

**设计要点**

- `--role` **必填**。禁止"从 agents-log 猜最近一个角色"——猜错即静默降级，正是本包反复记录的缺陷形态。
- B 模式**只核结构**（六要素段齐备、行数、路径自洽）。真伪一律归产物侧 + T7 审计。
- 两者结论**不合流**：A 的硬失败与 B 的缺段分别计数，避免"回报写得漂亮但产物没落盘"被掩盖。

---

## 3. 真源（一事实一处——禁止新建第二份清单）

> 论衡的既有纪律是"模板为真源、检查项从模板派生"（M-Exist-5 的注释原文）。本规格沿用，**不引入新清单**。

| 需要什么 | 真源 | 用法 |
|---|---|---|
| 产物**族名 → 产出者角色** | `scripts/_lib/cc-rules/content-rules.mjs` 的 `CONTRACTS`（26 条） | **直接 import 派生**，不复制 |
| 产物**磁盘路径** | `scripts/_lib/mgate-helpers.mjs` 的 `CARD_SPECS`；非卡片类见 `build-evidence-bundle.mjs` 源表 | import 派生 |
| 回报**字段清单** | `references/templates/交接报告-template.md`（段 1–7） | 运行时解析模板取段名 |
| agents-log **段格式** | `references/templates/交接报告-template-lite.md` | 解析取四要素名 |
| 各角色**条目数区间** | `references/dispatch-cards.md` | 见 §4 A3 |

### ⚠️ 前置修正项（**必须先修，否则本门一上线就是新的断链源**）

**已实测到一处路径漂移**：

```
references/deliverables.md:43   →  case-studies/案例卡.md      ❌
scripts/_lib/mgate-helpers.mjs  →  cases/案例卡.md             ✅（CARD_SPECS）
scripts/build-evidence-bundle.mjs:125 / token-budget.mjs:123   →  cases/
```

`references/case-studies.md` 是**另一个东西**（实战案例库文档），不是卡片目录。**判据：以脚本为准**——脚本是机检真源，`case-studies/` 目录根本不存在。

**处理**：修正 `deliverables.md:43` 为 `cases/案例卡.md`，并在 `references/_shared/规范-机械门对照表.md` 补一行（"路径口径"）。**这一步不并入本门实现**，应独立提交（它本身就是一个应被机检覆盖的漂移）。

---

## 4. 检查项清单

### A 组 · 产物侧

| 编号 | 检查 | 判定 | 级别 | 依据 |
|---|---|---|---|---|
| **A1** | 该角色的必需产物**存在**（族名解析；版本化族取**最大 N**） | 缺失 | **硬** | dispatch-cards / CONTRACTS |
| **A2** | 产物**非 0 字节** | 0 字节 = 写盘前失败 | **硬** | `00-主控-coordinator.md` L50 |
| **A3** | **结构**：卡片类走 `_lib/cards.mjs` 的 `splitCard` + 索引段；条目数落区间 | 不达标 | **硬** | dispatch-cards 条目区间 |
| **A4** | **版本一致**：报告类产物 `vN` == 被审正文 `vN`；禁 `v{N-1}` | 错位 | **硬** | `pipeline-readme.md` §退化路径版本规则 |
| **A5** | **成对产物**：T7 的 `审计报告-vN` + `反哺报告-vN` 缺一不可 | 缺一 | **硬** | dispatch-cards T7「两文件缺一不可」 |
| **A6** | `agents-log.md` 中该角色**开始与结束各一条** `### Tn 执行记录`（四要素） | 缺失 | **软** | `pipeline-readme.md` L250 |

**各角色必需产物表**（实现时**从真源派生**，下表仅为规格说明与回归对账用）：

| 角色 | 必需产物 | 条目/结构下限 |
|---|---|---|
| T1 | `literature/文献卡.md` + `literature/先行者清单.md` | 8–12 条 + 索引段 |
| T2 | `data/数据卡.md` | 15–25 条 + 索引段 + 信任级别字段 |
| T3 | `cases/案例卡.md` | 3–5 条 + 索引段；**0 条须有「空卡协议」显式声明**（特例，不判缺失） |
| T4 | `analysis/分析大纲.md` | 11 节 + §11 精简段 |
| T5 | `drafts/初稿-vN.md` + `analysis/素材加载清单.md`（修订轮另加 `drafts/修订说明-vN.md`） | 素材加载清单含「## 已加载」段 |
| T6 | `analysis/批判报告-vN.md` | 报告版本 = 被审正文轮次 |
| T7 | `audits/审计报告-vN.md` + `audits/反哺报告-vN.md`（修订轮另加 `audits/复核报告-vN.md`） | 见 A5 |
| T9 | `audits/审稿报告-vN.md` | 六维评分 + 总分可复算（M-Exist-6 同口径） |
| G14 | `audits/G14-检测报告-vN.md` | 8 类逐类判定 + 总判定 |
| T0/T8 | `final/定稿.md` / `final/证据包/` / `final/交付说明.md` / `final/M-Gate-Report.json` / `audits/闸门记录-T2.5.md` / `audits/闸门记录-T7.5.md` / `status.md` / `agents-log.md` | 终检前复核用 |

### B 组 · 回报侧

| 编号 | 检查 | 级别 | 说明 |
|---|---|---|---|
| **B1** | 段 1–6（做了什么 / 产物在哪 / 怎么验证 / 已知问题 / 下一步 / 状态机更新）齐备 | **硬** | 段名归一后**包含**匹配，不要求逐字 |
| **B2** | 段 7（AI 使用披露）齐备 | **软**（T5/T8 时为硬） | 模板：T5 + T8 必填 |
| **B3** | 回报 ≤ 10 行 | **软** | dispatch-cards 各卡「回报 ≤10 行」 |
| **B4** | 「产物在哪」段的路径 == A1 实际解析到的路径 | **硬** | 防"回报写 A、实际落 B"（这类错在 M-Exist 只到终点才暴露） |
| **B5** | 空段 ≠ 缺失：模板要求"写不下就写「无」"→ 空白段判 **软** | 软 | `交接报告-template.md` 抬头 |

### C 组 · **明确不做**（写进工具描述，防误用）

1. **不判内容质量**（论证强度、证据真伪、引用是否编造）→ 归 T6 / T7
2. **不判 G 体系** → 归 T7
3. **不写任何文件**（只读；不落报告、不改 status）
4. **不自动重派** —— 对策由主控按"子代理失败三段式"决定
5. **不覆盖 `pwsh` 直写的产物** —— 与 `ctx.tools.guard()` 同一边界：只看文件系统结果，不管谁写的

---

## 5. 退出码（关键设计决策）

### 决策：**不复用 M 门的 1/2/3，改用 20/21/22**

| 码 | 含义 | 主控对策 | 归属 |
|---|---|---|---|
| `0` | 交接合格 | 进入下一阶段 / 闸门判定 | 通用 |
| `20` | **产物缺失或 0 字节** | **重派**（或按快照续作） | 交接专有 |
| `21` | **结构 / 版本 / 成对性不合** | **续接补交**（`send_message` 或新 spawn + 快照） | 交接专有 |
| `22` | **仅软性提示**（agents-log 缺段 / 回报超长 / 空段） | 人工复核后放行 | 交接专有 |
| `10` | 参数或路径错误 | 修正调用方式，**不得当交接失败** | 通用（`_lib/exit-guard.mjs`） |
| `70` | 脚本内部错误（EX_SOFTWARE） | 脚本缺陷，与判定无关 | 通用（同上） |

### 为什么不用 1/2/3（唯一被否掉的方案，理由必须留档）

M 门的 `1/2/3` 与**内容严重度 P1/P0/P2 强绑定**，主控对它们的既定反应是"**触发 T5 修订一轮**"。而交接失败的对策是"**重派 / 续接**"——**语义不同，且对策不同**。

撞码会**重演 `exit 10` 曾被执行成 P1 的那类事故**：`_lib/exit-guard.mjs` 头注释记录的正是这件事（路径错被读成"正文有 P1 残留"→ 触发本不该发生的修订轮）。

**同时，报告内的级别词也避开 P0/P1/P2**，统一用 **硬失败 / 软提示**（`hard` / `soft`）——概念不撞，主控不会有第二种读法。

**码段占用现状**（确认无冲突）：M 门 `0/1/2/3` · `model-routing.mjs` `4`（需人工决定，不与 M 门共用）· 通用 `10` / `70` · **交接门 `20/21/22`（新增，全库未占用）**。

**登记义务**（实现时必做，否则等于裸码）：
- `docs/troubleshooting.md`（§8 退出码表 + §16 逐项报错修法表）
- `AGENTS.md`「闸门留机械证据」段
- `references/_shared/规范-机械门对照表.md` 新增一行

---

## 6. 接口规格 A：脚本 `scripts/handoff-check.mjs`

### 6.1 用法

```bash
# 产物侧（必跑）
node scripts/handoff-check.mjs --project run/<项目> --role T1

# 产物侧 + 回报侧（回报以文件或 stdin 传入）
node scripts/handoff-check.mjs --project run/<项目> --role T5 --report-file <交接回报.md>
node scripts/handoff-check.mjs --project run/<项目> --role T5 --report -        # stdin

# 省 token（只回聚合 + 硬失败项，与 m-gate-check 同款）
node scripts/handoff-check.mjs --project run/<项目> --role T7 --summary

# 帮助
node scripts/handoff-check.mjs -h
```

### 6.2 顶部必须做的两件事（顺序不可换）

```js
import { installExitGuard, requireExistingDir } from './_lib/exit-guard.mjs'
installExitGuard()                          // 必须在任何 readFileSync 之前
const project = requireExistingDir(projectArg, '项目目录')   // 不存在 → exit 10
```

**理由**：`requireExistingDir` 把"传了目录当文件 / 路径不存在"收敛到 `10`，避免 Node 默认 `exit 1` 被主控误读（`_lib/exit-guard.mjs` 头注释的实测教训）。

### 6.3 输出 JSON 契约（stdout **只有** JSON）

```jsonc
{
  "role": "T1",
  "project": "run/<项目>",
  "exit": 20,                  // 见 §5；= hard 非空 ? (任一产物缺失/0字节 ? 20 : 21) : (soft 非空 ? 22 : 0)
  "total": 3,                  // 检查项总数
  "pass": 1,
  "hard": [                    // 硬失败（决定 20/21）
    { "check": "A1", "subject": "literature/文献卡.md", "severity": "hard",
      "detail": "产物不存在（族名 literature/文献卡.md → 解析路径 …/literature/文献卡.md）" }
  ],
  "soft": [                    // 软提示（决定 22）
    { "check": "A6", "subject": "agents-log.md", "severity": "soft",
      "detail": "缺「### T1 执行记录」的开始记录" }
  ],
  "artifacts": [               // 逐产物机械事实（无论通过与否都给，便于主控写闸门实据）
    { "name": "文献卡.md", "path": "literature/文献卡.md", "exists": true,
      "bytes": 18422, "entries": 10, "structure": "ok", "version": null }
  ],
  "report": {                  // 仅在给了 --report / --report-file 时出现
    "sectionsFound": ["1. 做了什么", "2. 产物在哪", "…"],
    "sectionsMissing": ["4. 已知问题"],
    "lines": 12,
    "pathMismatch": []         // B4：回报路径 vs artifacts[].path 的不一致项
  },
  "checkedAt": "2026-09-22T…"  // 供闸门记录表「实据」列直接引用
}
```

**约定**：`--summary` 时 `artifacts` 只保留 `structure != "ok"` 与失败项；`hard`/`soft` **永不省略**（假阴性比冗长更贵）。

### 6.4 复用与禁令

| 复用 | 用途 |
|---|---|
| `_lib/cards.mjs` `splitCard` / `cardHeadingPattern` | 卡片条目切块（**唯一真源**，勿另写正则——该文件头注释记录过"两份逐字相同的正则漏同步"的事故） |
| `_lib/mgate-helpers.mjs` `CARD_SPECS` / `entryIds` / `indexSection` | 卡路径与条目编号 |
| `_lib/sections.mjs` `allHeadings` | 标题解析（与 m-gate-check / count-chars 同源） |
| `_lib/han.mjs` | 若需字数（本门默不需要） |

**禁令**：不联网、不写盘、不 spawn 子进程、不 import 宿主包（`@deepseek-ai/*`）——与其余 14 个随包脚本同一条约束。

### 6.5 段落切块纪律

脚本输出**只有 JSON**；人类可读文本由工具侧 `output.render` 负责（`tools.js` 既有约定）。**不要**在脚本里打印表格。

---

## 7. 接口规格 B：原生工具 `lunheng_handoff_check`

### 7.1 注册位置与方式

追加到 `lib/tools.js` 的 `installLunhengTools(...)` 内，与既有两个工具同形：

```js
disposers.push(tools.register(defineTool({
  name: 'lunheng_handoff_check',
  // …
})))
```

**不开新的注入面**：`tools` 服务仍走 `ctx.get('tools')` 可选依赖（不写进 `inject`）——`tools.js` 头注释的教训 #154：静态依赖会让"缺服务 → 入口 import 失败 → 技能也不注册"。

### 7.2 `parameters`（**允许** `required`，仅参数层）

```js
parameters: {
  project: { type: 'string', required: true,
             description: '项目目录，如 run/<项目名>' },
  role:    { type: 'string', required: true, enum: ['T1','T2','T3','T4','T5','T6','T7','T8','T9','G14'],
             description: '被验收的角色（G14 = 中文 AI 痕迹检测器；T8/T0 无收报，一般不用）' },
  report:  { type: 'string',
             description: '可选：子代理回报原文（≤10 行）。给了才做回报侧校验（B 组）' },
  reportFile: { type: 'string',
             description: '可选：回报文件路径（与 report 二选一；report 优先）' },
  summary: { type: 'boolean',
             description: 'true = 只回聚合与硬失败项（省 token）；省略 = 含逐产物机械事实' },
}
```

### 7.3 `output.schema`（⚠️ **全程不得出现 `required`**）

```js
output: {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      exit:   { type: 'number', description: '0 合格 / 20 产物缺失或0字节 / 21 结构·版本·成对性不合 / 22 仅软提示 / 10 参数路径错 / 70 内部错误' },
      role:   { type: 'string' },
      total:  { type: 'number' },
      pass:   { type: 'number' },
      hard:   { type: 'array', items: { type: 'object', additionalProperties: false,
                properties: { check: {type:'string'}, subject: {type:'string'},
                              severity: {type:'string'}, detail: {type:'string'} } } },
      soft:   { type: 'array', items: { /* 同上结构 */ } },
      artifacts: { type: 'json', description: '逐产物机械事实（原样透传；summary=true 时仅失败项）' },
      report:    { type: 'json', description: '回报侧结果（仅传了 report/reportFile 时出现）' },
      stderr:    { type: 'string', description: '脚本 stderr 尾部' },
      truncated: { type: 'boolean', description: '输出触到采集上限（结果可能不完整）' },
    },
  },
  render: (args, v) => [ /* 人类可读：结论一行 + 硬失败清单 + 下一步提示 */ ],
}
```

**为什么 `artifacts` 用 `json` 而不是逐字段展开**：宿主 value schema DSL **不支持 `required`**，嵌套对象写多了就是给未来埋坑；`lunheng_char_count` 的 `sections` 已有 `type: 'json'` 先例（v18.2.6 起改为规范 JSON 值）。

**红线**：`output.schema` 里写 `required` → `defineTool()` **定义期抛错** → 工具永不注册且被入口降级 catch 吞成一行提示。**`tests/entry.test.mjs` 已有断言防这条**，实现后必跑。

### 7.4 `execute`

```js
async execute(args, exec) {
  const argv = ['--project', args.project, '--role', args.role]
  if (args.report) argv.push('--report', args.report)
  else if (args.reportFile) argv.push('--report-file', args.reportFile)
  if (args.summary) argv.push('--summary')

  const r = await runScript(join(skillRoot, 'scripts', 'handoff-check.mjs'), argv, exec.signal, {
    timeoutMs: scriptTimeoutMs, maxBytes: scriptMaxOutputBytes,
  })
  const j = parseJson(r.out)
  if (!j) throw new Error(`${describeScriptFailure('handoff-check', r, …)}（exit=${r.code}）：${clip(r.err || r.out, 300)}`)
  return { /* 规范化字段；hard/soft 截前 12 条，detail clip 800 */ }
}
```

**三点必须照抄既有工具的做法**

1. **拿不到 JSON → `throw`**（基础设施失败）；**内容不理想 → 正常返回**（`exit` 在值里）。
2. `describeScriptFailure` 目前把 `tool` 名硬映射到 `m-gate-check` / `count-chars` 两个脚本名（三元表达式）→ 需**改成按脚本名传参**，否则新工具的 EPERM 提示会指错脚本。
3. `spawn` 在受限策略下**同步抛 EPERM** → 已有降级路径照用：提示"改用 `pwsh` 直调同一脚本，**退出码与 JSON 契约完全一致**"，并保留"不得用 LLM 断言替代机检"的那句。

### 7.5 Config 复用（不新增键）

复用既有 `scriptTimeoutMs`（默认 120000）与 `scriptMaxOutputBytes`（默认 4 MiB）。**不新增 Tunable**——`redline-no-hardcoded-tunables` 的判据是"`cordis.yml` 能否改它"。

> 若采纳 §10 的"灰度"建议（`handoffLevel: basic|strict`），那是**唯一**新增键，须同步 `lib/index.js` 的 `CONFIG_SPEC` / `CONFIG_DEFAULTS` 与相关测试断言；新增键属可调参数，放在 Config 是**合规**的，不是硬编码。

---

## 8. 接入点（最小改动清单）

| # | 文件 | 改动 | 为什么 |
|---|---|---|---|
| 1 | `references/agents/00-主控-coordinator.md` L50 | 「子系统巡检：产物落盘校验」段的**第一动作**改为：调 `lunheng_handoff_check`（无工具环境则 `pwsh` 直调脚本），保留人工兜底 | 把手工动作换成机械动作 |
| 2 | `references/pipeline-readme.md`（子代理中断三段式第①步） | 同上措辞同步 | 一事实一处（L250 与 L50 已是两处同源表述） |
| 3 | `references/templates/闸门记录-template.md` + 主控扩展职责 | T2.5 / T7.5 的「实据」列**引用该 exit code** | M-Exist-5 已要求实据是路径/exit code/命令，天然兼容 |
| 4 | `references/dispatch-cards.md`（10 张卡） | 「回报 ≤10 行」行补一句"**回报须含六要素**（收报侧会机检）" | **把契约随任务下发**——与 v18.5.1 preflight 反注同一理念 |
| 5 | `docs/troubleshooting.md` §8 / §16 | 登记 `20/21/22` | 裸码不可用 |
| 6 | `references/_shared/规范-机械门对照表.md` | 新增一行（规范 ↔ 门 ↔ 覆盖要件） | 该表的维护义务（改规范时必查） |
| 7 | `AGENTS.md` | 退出码段补 `20/21/22`；启动清单提及收报动作 | 操作手册真源 |

**第 4 项是成败关键**：`pipeline-readme.md` 已经记着一条同类教训——"审计视图刷新义务**只写在说明文字里**（软约束）→ 实测四次派发一次都没刷新，本条优化**基本空转**"。所以**不许**只在主控卡写一句"记得调用"。

---

## 9. 验收判据（可证伪）

| # | 判据 | 通过线 |
|---|---|---|
| V1 | **回归一致率**：对 `run/` 下 ≥5 个既有项目（含 `test-paper-01` / `test-paper-02` / `ai-content-farm-retractions`）逐角色跑，工具判定 vs 当时主控人工判定（可从 `agents-log.md` / 闸门记录表 / 交接留痕还原） | 差异**逐条给出理由**；无理由的差异 = 缺陷 |
| V2 | **证伪用例**（4 个反例，工具必须命中） | ①产物 0 字节 → `20`；②T7 缺 `反哺报告-vN` → `20`；③报告 `vN` ≠ 被审正文 `vN` → `21`；④回报缺「已知问题」段 → `21`（或 `20`，按 B1=B4 的硬软归属定） |
| V3 | **不误伤**：对**合格**项目跑 | **必须 `exit 0`**。假阳性 = 阻塞交付（参照 `_lib/cards.mjs` 头注释记录的"索引段假阳性 → P0 阻塞交付"事故） |
| V4 | **六门全绿** | `dsh-plugin-dev check` 0 fail / 0 warn · `node scripts/consistency-check.mjs` exit 0 · `node --test`（新增 `tests/handoff-check.test.mjs`）· `repo-hygiene-check`（词预算门：新增 md ≥12KB 需抬上限并写明理由）· `pack-smoke` · `baseline` 对账（若有 stdout 契约变更） |
| V5 | **成本** | 单次调用 < 200 ms（纯本地读，无网络无 spawn） |
| V6 | **降级可用** | 无 `tools` 服务 / 无 `defineTool` / EPERM 三种环境下，技能与流水线照常（与既有两工具同一条提示） |

---

## 10. 风险与自我限制（如实声明）

| 风险 | 严重度 | 缓解 |
|---|---|---|
| **假阳性阻塞交付** | 高 | **灰度**：先只开 `A1/A2 + B1`（存在 / 非空 / 段齐），结构类 `A3/A4/A5` 待回归通过后再开；可加 `handoffLevel: basic\|strict`（默认 `basic`） |
| **B 模式空转**（主控不把回报原文传进来 → 回报侧形同不存在） | 高 | 与"审计视图刷新义务"同款失效路径。缓解：**把 B 模式结果写进 T2.5/T7.5 闸门记录的实据列**——不传 = 闸门记录缺实据 = **M-Exist-5 判 P1**（软约束变可核对），并同步写入 dispatch-cards（§8 第 4 项） |
| 不覆盖 `pwsh` | 中 | 与 `guard` 同一边界：本门只看文件系统结果，防不了"绕过工具伪造产物"——**那是内容问题，归 T7**。不得宣称本门提供了内容可信度 |
| 与 `preflight` 重复 | 低 | 不重复：preflight **下发**契约，本门**验收**契约。但实现时须避免两者对"契约"各持一份表述——统一从 §3 真源派生 |
| 新增码段被误用 | 低 | `20/21/22` 只在 `handoff-check` 与工具描述中出现；`troubleshooting` 明写"**不得**与 M 门 `1/2/3` 混用" |

---

## 11. 交付物清单（实现时）

**新增**
- `scripts/handoff-check.mjs`
- `tests/handoff-check.test.mjs`

**修改**
- `lib/tools.js`（+1 工具；`describeScriptFailure` 改为按脚本名传参）
- `lib/index.js`（仅当采纳 `handoffLevel`）
- §8 表中的 7 处文档
- `CHANGELOG.md`（新能力 = **minor**）+ `package.json` 版本；**镜像同步**（项目技能根 / 用户技能根）

**独立前置提交（不并入本门）**
- `references/deliverables.md:43` 路径漂移修正（`case-studies/` → `cases/`）

**版本与工作树纪律**
- `18.5.0` **已发布**（commit `2403ed8`）→ **不可再改**；工作树中已有 v18.5.1 的 preflight 反注改动**未提交** → **实现前先收口**，避免混提交。
- 本项属新能力，建议起 **v18.6.0**（或并入 v18.5.1，若该版本尚未发布且主人同意扩范围）。

---

## 12. 需主人拍板的三个岔口

| # | 岔口 | 我的建议 | 理由 |
|---|---|---|---|
| 1 | 退出码：**20/21/22** 还是复用 M 门的 1/2/3 | **20/21/22** | 语义与对策都不同；复用必然重演 `exit 10` 被读成 P1 的事故 |
| 2 | 是否加 `handoffLevel` 灰度开关 | **加**，默认 `basic` | 假阳性会阻塞交付，而本门的价值可在 basic 档先验证 |
| 3 | B 模式（回报原文）是否**强制** | **强制**，且结果进闸门记录实据列 | 否则重演"软约束基本空转"的既有教训 |

**三个岔口未定之前，不建议进入实现。**
