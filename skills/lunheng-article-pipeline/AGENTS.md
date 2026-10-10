> 版本：v18.87.0（DSH bundle 插件）

# AGENTS.md — 论文流水线操作手册

> **DSH 说明**：本手册为 DSH 原生手册。所用 DSH 工具：subagent / list_agents / send_message / web_search / web_fetch / todo_write / pwsh / edit / write 等；结构性差异见 `SKILL.md` 的「🔧 DSH 环境说明」章节。

## 启动时必读

> **清单真源 = `SKILL.md` §启动清单 与 §⚡ 启动速查表**——本处**不再复述**（v18.2.2 收敛：旧版此处复述，构成同一事实两处维护，只要还复述就会再漂）。**改启动清单只改 `SKILL.md`**。

> **包形态（v18.0.0 起）**：包根 = `package.json`（`main` → `lib/index.js` 入口；`dsh.bundle.patch` → `cordis.patch.yml`）+ `lib/` + `skills/`。**`cordis.patch.yml` 里那行自注册条目不可删**（loader 靠它按包名 import 入口；删了技能就不注册——v18.0.0 缺陷、v18.0.1 修复）。两种部署均受支持：① `dsh plugin add` 装 bundle；② 把 `skills/lunheng-article-pipeline/` 复制到任一 skill 根（项目级 rank 100 / 用户级 rank 400）。**包面自检**：`dsh-plugin-dev check`（14 项，目标 0 fail / 0 warn）+ `node --test "tests/**/*.test.mjs" "skills/*/tests/**/*.test.mjs"`（**两个 glob 都要**——内嵌子技能 `lunheng-commands` 的 22 个用例只在后一个里）。**逐项清单、打包层序与官方契约见 [`references/maintainers.md`](references/maintainers.md) §八**（v18.79.0 瘦身：细节外移，此处只留判据）。

## 流水线协议

> **单一真源 = [`references/pipeline-readme.md`](references/pipeline-readme.md) 流水线全景段**（Phase 序列、每 Phase 的派发与产物、两道完整性门的位置）。
> **Phase 序列的一行速查在 `SKILL.md` §⚡ 启动速查表**（那里同时是主控排 `todo_write` 的唯一 Phase 真源，并由机检规则 ㉔ 断言一致）。
> **本处不复述**——同一事实两处维护必然再漂（v18.2.2 / v18.81.0 两次收敛同一类问题）。派发话术直接从 `references/pipeline-readme.md` §派发话术 复制。

## 关键规则

> **v18.88.0「多宿主收口」**（主人 2026-10-10 裁定）：本条集合中凡与 `SKILL.md` **同事实**者，已收为**指针**——角色编号 / 模型分配 / 阶段闸门 + 闸门留证 / 图件链路 / G14 / T9 / 写保护的授权五步（该五步落 `references/maintainers.md` §十四）。**内容未丢**（真源皆在两个常驻面文件内），代价是读者一跳；本条集合**刻意保留原文**的是「子代理失败三段式」（唯一宿主）、「M 门行」（有机械消费者：`consistency-check` ⑥b + `docs-facts`）、「注解聚合」等策略行，以及各条**一句话判据**。
- **派发话术**：直接从 `references/pipeline-readme.md` 复制，改项目名即可
- **每个项目一个目录**：`run/<项目名>/`，产物路径见任务简报
- **角色编号 / 模型分配**：9 角色 T1-T9 **不可互替**、**T9 启用按文类档案**、四档能力表与兜底链、配置方式——**真源 = [`SKILL.md`](SKILL.md) §⚡ 启动速查表 与 [`references/_shared/模型路由.md`](references/_shared/模型路由.md)**。派生前跑 `node scripts/model-routing.mjs`（只读探测）；**禁止写死厂商默认值**（写错模型 = 该档工具不可用）。
- **子代理产出必须交交接报告**：六要素缺一不可（做了什么/产物在哪/怎么验证/已知问题/下一步 + 状态更新）——**定义真源 = `references/glossary.md` §执行韧化协议，字段形态 = `references/templates/交接报告-template.md`**（本行只给名称，不再展开）；长时间无产出则主控用 `list_agents` 查看并介入
- **子代理失败三段式处理**：① **落盘校验**——子代理 settle 后主控必跑 `read`/`ls` 检查关键产物是否存在+非空+结构完整，区分「写盘前失败」vs「写盘后失败」vs「任务完成」；② **产物完整 → `send_message` 续接原子代理**（DSH continuable，让它读已落盘产物确认后继续，**不是整任务重派**）；③ **产物缺失 → 才 spawn 新子代理重派**。**连续失败**：先查 DSH 环境（`list_agents` 看是否 `[ready]` 可续接；全失败可能 = DSH 进程状态问题，重启 dsh web 再试）。
  > **⚠️ 重派前先做「失败自诊断三步」（v18.79.0 反哺-v18.78.2 §七 T0-3）**：DSH 子代理失败是**零信息失败**（实测两次**同形而不同因**：`429` 配额墙／`402` 额度墙）——不诊断就重派，两次都白跑。**三步细则与判据见 [`references/errors.md`](references/errors.md) §七**（本处只留指针）。
  > **⚠️ 假死判据与平台级熔断（检索审计反哺 R4）**：① `send_message` 不接受 `subagent` 子代理 id（只认 `spawn_teammate` 队友）——「续接失败 / not found」是**结构限制而非死亡证据**，判断存活以**落盘产物**为准（实测：T2 v1 已落盘 28 条仍被误判已死重派）。② 同档连续 ≥2 次、或多档同时零产物失败 = 疑似平台级故障 → **熔断等待 / 查 DSH 环境**，不盲目重派。
- **状态文件分两层**：`status.md` **主控独占写**（纯状态机表，子代理禁 edit）；`agents-log.md`（项目根，**可按 Phase 拆分**）**子代理追加写**（每完成一角色追加一段 `### Tn 执行记录`）。**目的**：避免子代理追加触发主控 `edit status.md` 报「file changed since it was read」。**两轨各司其职的完整口径 + 冲突处置（先 re-read 再 edit）见 [`references/pipeline-readme.md`](references/pipeline-readme.md) §两轨各司其职**。
- **执行约定（DSH 精简版）**：状态机 + 交接报告六要素 + G8 自检 + **进度播报三播报**（派发即播报 / 完成即转播 / 卡住即告警，防主人干等；无需心跳/分阶段 ack/预检/8 分钟硬卡；现行规则即本执行约定）
- **阶段闸门 / 闸门留机械证据**：T2.5（检索→分析）与 T7.5（审计→终检）两道主控 checkpoint，**不得只凭自述**——交接报告须附**脚本 exit code + 产物路径**。**exit 语义真源 = [`SKILL.md`](SKILL.md) §执行能力边界 的「闸门必须留机械证据」行**（本条自 v2.5.2-dsh.13 起即如此声明）；`handoff-check.mjs` 用 `20/21/22`、`model-routing.mjs` 用 `4`，**均与 M 门的 1/2/3 刻意分离**。
  > **判据一句话（保留）：只要脚本不做内容判定，它的 `1` 就一定是撞码。**
- **机制文件写保护（v2.5.2-dsh.13；v18.0.0 补授权例外；v18.1.0 部分机械化）**：`SKILL.md` / `AGENTS.md` / `references/**` / `scripts/**` / `cordis.patch.yml` 任何角色（含子代理）**默认禁写**；改进动议只写 `audits/反哺报告-vN.md`，由主人在 host shell 手工 apply（**agent 自主改机制文件 = P0 违规，本次交付作废**）。**v18.1.0**：bundle 部署下入口注册全局 `ctx.tools.guard()`，write/edit 类工具命中机制路径**在分发前即被拒**（官方 `docs/subsystems/tools.md` 的 `guard()` 语义：只收紧、后续监听器无法改回允许；主人授权例外走 `LUNHENG_ALLOW_MECH_EDIT=1`）。**残余缺口如实声明**：guard 只看**工具调用**，`pwsh`/子进程不经此门（官方无 per-path 只读声明），故为「比 prompt 强、比机制强制弱」——机制文件的可信度仍靠 `git` + 四道门 + 主人 review，不靠 guard。
  > **⚠️ 唯一例外：主人显式授权（v18.0.0）**：主人**直接指令**要求修订机制文件时**不构成越权**——主人是机制文件的所有者，该指令即授权；但**仍须走安全流程**（改前备份 / `edit` 精确匹配禁 `sed -i` / 改后验证 / 可回滚 / 如实标注——**五步逐条判据见 [`references/maintainers.md`](references/maintainers.md) §十四**，v18.88.0 多宿主收口）。
  > **判据一句话（保留）**：**agent 自发改进 = 禁写（只出反哺报告）；主人明确下令 = 可写（走安全流程）**。
- **技能来源自检（v2.5.2-dsh.13）**：启动时核对 `SKILL.md` 版本头与期望版本一致，不一致即停机报「技能来源可疑」（同名技能会按 rank 就近静默顶替）
- **M 门**：**M 门 25 项中 24 项已脚本化**（= **M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1**；人工项 = M-Integrity-2 跨文件判断，M-Form-8 承重墙质量同源由主控 LLM 兜底）——**仅 T7/T8 读** `references/_shared/M-Gate-Algorithm.md`（T1-T5/T9 不读），产出 `final/M-Gate-Report.json`，**exit 0 才返回**。**exit 语义真源 = `SKILL.md` §执行能力边界**。
  > ⚠️ **本行有 2 处机检契约字符串**（①「M 门 25 项中 24 项已脚本化」→ `consistency-check` ⑥b；② 项数枚举 → `docs-facts` M 门守卫）：本批瘦身把两句改成**语义等价但不同形**的写法 → 两条机械面**同时失明**，被 `tests/scripts/consistency-check.test.mjs` 与 `tests/docs-facts.test.mjs` 各自抓出。判据：**改文档前先查有没有机械消费者依赖该字符串**——「语义等价」不是机械面的通行证。
- **图件链路 / G14 / T9 三段的运行期判据**：**真源 = [`SKILL.md`](SKILL.md) §⚡ 启动速查表**（图件链路「图位独占一行 → 主控写 SVG → `md2html --fig-dir` → M-Form-9 对账」那行；G14 三层防御与 Phase 4.6 时点那行；T9 按文类档案启用那行）。细则另见 `references/pipeline-readme.md` 与 `references/gates/14-中文AI痕迹-gate.md`。
- **项目进展记入** `memory/YYYY-MM-DD.md` 和 `memory/projects.md`
- **注解聚合（v2.5.2-dsh 补丁，token 优化）**：新机制注解**不再逐层堆叠**（v2.1.8 新增/v2.2.1 新增/v2.3.0 改…），同主题合并为单行「v2.5.2-dsh 补丁，教训：…」格式；历史分层注解聚合到卡头一行，细节见 git log——防角色卡/文档随版本膨胀。

## 文件修改操作约束（v2.1.4 F5 补完，教训 #48）

论衡工作区所有修改走以下安全流程，**任何时候禁止 `sed -i`**（静默清空文件事故教训）：

1. **改前**：`wc -l <file>` 记录行数 + `cp <file> <备份目录>/<file>.bak` 备份（Windows 用 `$env:TEMP` 或工作区内备份目录）
2. **改中**：用 `edit` 工具（精确 oldText 匹配），**不用 sed/awk/perl 直接写回原文件**
3. **改后**：`wc -l` 对比 + `diff <file> <备份目录>/<file>.bak` 验证（不一致立即从 .bak 恢复）
4. **跨文件 sync**：用 `cp` 不带任何转换，直接覆盖（skill 副本同步是 `references/` 路径映射）
5. **改动位置（v18.0.1 新增，教训 #153）**：机制 / 角色卡 / 脚本 / 模板的改动**一律在真源仓库里做**（`<repo>/skills/lunheng-article-pipeline/`——那里才有 `tests/` 与两道仓库门），四道门全绿、提交之后**再同步到部署镜像**（项目技能根 `.dsh/skills/<name>/` 或用户技能根）。**不要反过来**：镜像不含 `tests/`，在镜像上改完再回流 = 跳过契约验证（实例：一处 `exit 10` 中止在镜像上自测通过、官方门全绿，合入仓库后 18 个用例红）。**判据：实现与测试同居的目录才是真源**。镜像里不得出现 `package.json` / `cordis.patch.yml` / `docs` / `examples` / `.git` / `lib` / 包级 README / `*.tgz`（`consistency-check` 规则⑨ 判 P1 污染）。
6. **验证**：本修改走完后必 `grep` 关键词 + 结构性 grep（如本手册的「## 交接报告」所有角色卡齐整性）；改论衡机制/文档后额外跑两条门（v18.0.0 起为双门）：
   - `node scripts/consistency-check.mjs` —— 文档一致性（**规则表见脚本头注释**——v18.0.3 起此处不再抄数字，防「加规则忘改数字」；**exit 0 才提交**）
   - `dsh-plugin-dev check` —— 包面静态门（14 项，清单见 `references/maintainers.md` §八；**目标 0 fail / 0 warn**）
   - `node --test "tests/**/*.test.mjs" "skills/*/tests/**/*.test.mjs"` —— 随包脚本 + **组合包契约** + 入口回归 + 内嵌子技能（改脚本输出契约、`cordis.patch.yml`、`package.json` 时**必跑**）
   > **维护期固定动作**（布局探测 / 改规范时登记对照表 / 收口批 `closeout-verify` / 发版前 `no-write-check` / 词预算门 / 跑门前清 staging / 仓库级打包面 CI）——**逐条判据与原理见 [`references/maintainers.md`](references/maintainers.md) §十四**（v18.86.0 常驻集真外移：本节七条长说明逐字迁入该节，原位只留本条指针）。

7. **读中文文件一律显式 `-Encoding UTF8`（v18.2.5 新增）**：`Get-Content` 等文本读取必带该参数。
   > **判据：看到中文乱码，先怀疑读取端编码，不要先怀疑文件**（实测：合法 UTF-8 文案在 pwsh 默认解码下显示乱码，曾被误判为「子代理产物编码坏了」，险些错误重派）。

## 开发参考资料（维护者向，v18.22.1 CTX-2 已整体外移）

> **单一真源 = [`references/maintainers.md`](references/maintainers.md) §八**——**官方资料入口表**（契约速查 / 开发路径 / 官方文档全文 / skill 子系统契约 / 打包层序 / 文档写作规范 / 服务签名 / 能力接缝）+ **机械层**（`dsh-plugin-dev check` 14 项 / `verify` / `new`）+ **冲突裁决顺序**（官方 > 本包 > 其他）+ **何时必须查官方资料** + **本包与官方的刻意偏离指针** + **仓库级打包面检查清单**，全在该节。
>
> **判据（主人 2026-09-11 指示）**：凡涉及**包形态、插件契约、服务/事件、工具注册、打包发布、官方文档规范**的改动，**先查官方资料再动手**——不得凭记忆、也不得凭本包既有写法推断。
>
> **为什么外移**：本节是**维护者决策时才查**的参考，而 `AGENTS.md` 是**技能目录内自动生效的指令**（每次加载都进上下文）——运行期角色与主控都不需要它。按「维护者向 → `maintainers.md`」这一条判据整体迁出，此处只留指针。

## 记忆文件（运行时由主控在项目目录创建，非技能包内置）
- `memory/YYYY-MM-DD.md` — 每日日志（记结论不记过程）
- `memory/projects.md` — 各论文项目状态
- `MEMORY.md` — 长期约定（保持精简）
