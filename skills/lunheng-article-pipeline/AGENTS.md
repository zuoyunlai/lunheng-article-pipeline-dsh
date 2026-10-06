> 版本：v18.78.2（DSH bundle 插件）

# AGENTS.md — 论文流水线操作手册

> **DSH 说明**：本手册为 DSH 原生手册。所用 DSH 工具：subagent / list_agents / send_message / web_search / web_fetch / todo_write / pwsh / edit / write 等；结构性差异见 `SKILL.md` 的「🔧 DSH 环境说明」章节。

## 启动时必读

> **清单真源 = `SKILL.md` §启动清单 与 §⚡ 启动速查表**——本处**不再复述**（v18.2.2 收敛：旧版此处复述，构成同一事实两处维护，只要还复述就会再漂）。**改启动清单只改 `SKILL.md`**。

> **包形态（v18.0.0 起）**：包根 = `package.json`（`main` → `lib/index.js` 入口；`dsh.bundle.patch` → `cordis.patch.yml`）+ `lib/` + `skills/`。**`cordis.patch.yml` 里那行自注册条目不可删**（loader 靠它按包名 import 入口；删了技能就不注册——v18.0.0 缺陷、v18.0.1 修复）。两种部署均受支持：① `dsh plugin add` 装 bundle；② 把 `skills/lunheng-article-pipeline/` 复制到任一 skill 根（项目级 rank 100 / 用户级 rank 400）。**包面自检**：`dsh-plugin-dev check`（14 项，目标 0 fail / 0 warn）+ `node --test "tests/**/*.test.mjs" "skills/*/tests/**/*.test.mjs"`（**两个 glob 都要**——内嵌子技能 `lunheng-commands` 的 22 个用例只在后一个里）。**逐项清单、打包层序与官方契约见 [`references/maintainers.md`](references/maintainers.md) §八**（v18.79.0 瘦身：细节外移，此处只留判据）。

## 流水线协议（摘要，详见 references/pipeline-readme.md）

```
Phase 0 定题     → 与主人确认主题/类型/篇幅/引用格式 + cases 需求（含 0 条场景显式声明）+ 外部服务 4 选 1 同意 → 写 run/<项目>/01-任务简报.md
Phase 1 并行检索 → spawn T1 文献检索员 ∥ T2 数据检索员 ∥ T3 案例检索员（**任何量级必 spawn**，含 0 条场景空卡协议；subagent 三方真并行互不干涉，等完成通知）
[🔒 T2.5 完整性门] 数据条目≥简报数据需求 + 信任级别完整 → 通过才派 T4
Phase 2 分析     → spawn T4 分析员 → analysis/分析大纲.md
Phase 2.5 大纲确认 → 主人过目 → 三角验证 [L]+[D]+[C] 缺角补检索
Phase 3 写作     → spawn T5 写手 → drafts/初稿-v1.md（**含 G14 v1 自检**：8 类措辞层扫描，结论入 drafts/修订说明-v1.md；v18.2.8）
Phase 3.5 洞察补充 → 主人深度洞察补充（人在环）→ 写手 v2 融入
Phase 3.6 批判   → spawn T6 批判伙伴（C1-C7 反方攻击 v2，轻量档可跳）→ analysis/批判报告-vN.md
Phase 4 审计     → spawn T7 审计员 → audits/审计报告-vN.md（G0-G14 全项检查，v2.4.0 加 G14 中文 AI 痕迹闸）
                 → 打回修订 ≤2 轮（必须 spawn 独立写手）；仍不过 → 升级决策 / Acknowledged Limitations 模式
Phase 4.6 G14终闸 → **G14 中文 AI 痕迹闸**（**唯一一次 spawn**；**v18.75.0 起串行，不再与 T9 并行**；主人 Phase 0 可显式关闭）→ **Pass → 冻结一份正文（尚不是 `final/`）｜ Warning/Fail → 走 G 环修订，改完重跑 G14 至 Pass** → audits/G14-检测报告-vN.md
Phase 4.7 审稿   → spawn T9 同行评审（**v18.75.0：启用与否按 `references/_shared/文类档案.md`——`academic-cn`/`-hum`/`-case` 必选不可关；`lit-review` 可选；其余默认不选**）→ audits/审稿报告-vN.md（6 维度评分 + 期刊匹配助手 Top 3）；**建议的处置走法见该档案「T9 后处置」列**（三视角类可开 B 轨；单视角类**只出建议件**，要改由主控在**交付后**另行修订）
[🔒 T7.5 完整性门] 审计报告最新版 + P0/P1 清单 + M 门全 exit 0 + 隔离 → 通过才终检
Phase 5 终检     → T8 终检（独立角色，主控 T0 以 T8 身份亲完成 M 门：M-Form 11 / M-Exist 11 / M-Integrity 2 / M-Fact 1，LLM 兜底）→ final/定稿.md + 证据包/ + 交付说明.md
                 ↑ **v18.75.0：T8 在 T9 之后**（`final/` 此时才落盘；T9 评的是 Phase 4.6 冻结的那份正文）→ 主人终检验收 → **流水线走完**
```

## 关键规则
- **派发话术**：直接从 `references/pipeline-readme.md` 复制，改项目名即可
- **每个项目一个目录**：`run/<项目名>/`，产物路径见任务简报
- **角色编号（v2.3.0 重构，v2.5.2 延续，v2.5.2-dsh.8 语义定案）**：**9 个独立角色 T1-T9 不可相互替代**——T1 文献 / T2 数据 / T3 案例 / T4 分析 / T5 写作 / T6 批判 / T7 审计 / **T8 终检（独立角色，主控 T0 亲执行）** / **T9 同行评审（**v18.75.0 起按文类档案决定启用与否**；`academic-cn`/`-hum`/`-case` 必选、`lit-review` 可选、其余默认不选）**（编号 = 流水线 Phase 顺序）
- **模型分配**：`subagent` 默认继承会话模型（零配置可用）；要按角色分档时**先跑 `node scripts/model-routing.mjs`**（只读）探测本机 provider×模型给「档位→模型」建议。四档能力表 / 兜底链 / 配置方式（`LUNHENG_*_MODEL` + `_PROVIDER`，不设 = 三档全继承）/ 主控工作流**单一真源 = [`references/_shared/模型路由.md`](references/_shared/模型路由.md)**；**禁止写死厂商默认值**（宿主无模型级回退，写错模型 = 该档工具不可用）。
- **子代理产出必须交交接报告**：六要素缺一不可（做了什么/产物在哪/怎么验证/已知问题/下一步 + 状态更新）——**定义真源 = `references/glossary.md` §执行韧化协议，字段形态 = `references/templates/交接报告-template.md`**（本行只给名称，不再展开）；长时间无产出则主控用 `list_agents` 查看并介入
- **子代理失败三段式处理**：① **落盘校验**——子代理 settle 后主控必跑 `read`/`ls` 检查关键产物是否存在+非空+结构完整，区分「写盘前失败」vs「写盘后失败」vs「任务完成」；② **产物完整 → `send_message` 续接原子代理**（DSH continuable，让它读已落盘产物确认后继续，**不是整任务重派**）；③ **产物缺失 → 才 spawn 新子代理重派**。**连续失败**：先查 DSH 环境（`list_agents` 看是否 `[ready]` 可续接；全失败可能 = DSH 进程状态问题，重启 dsh web 再试）。
  > **⚠️ 重派前先做「失败自诊断三步」（v18.79.0 反哺-v18.78.2 §七 T0-3）**：DSH 子代理失败是**零信息失败**（实测两次**同形而不同因**：`429` 配额墙／`402` 额度墙）——不诊断就重派，两次都白跑。**三步细则与判据见 [`references/errors.md`](references/errors.md) §七**（本处只留指针）。
- **status.md / agents-log.md 分文件写入约定（v2.5.2-dsh.5 修订，教训：T1/T2 与主控并发写冲突）**：**状态文件分两层**——① `status.md` 由**主控独占写**（纯状态机表，不允许子代理直接 edit）；② `agents-log.md`（v2.5.2-dsh.5 新增，项目根目录）由**子代理追加写**（每完成一个角色任务追加一段 `### Tn 执行记录` 节）。子代理的进度/完成状态通过「交接报告 + 产物落盘」回报，主控在收到交接报告后统一更新 status.md。**两文件分离目的**：避免子代理追加触发主控 edit status.md 报「file changed since it was read」。冲突已发生时：主控先 re-read 再 edit。
- **执行约定（DSH 精简版）**：状态机 + 交接报告六要素 + G8 自检 + **进度播报三播报**（派发即播报 / 完成即转播 / 卡住即告警，防主人干等；无需心跳/分阶段 ack/预检/8 分钟硬卡；现行规则即本执行约定）
- **阶段闸门（v2.2.1，v2.3.0 改 T5.5→T7.5）**：T2.5（检索→分析）与 T7.5（审计→终检）两道主控 checkpoint，用 `todo_write` + `read` 实现，**不绕过交接直接派发**
- **闸门留机械证据（v2.5.2-dsh.13；v18.0.2 统一退出码）**：两道闸门与 M 门**不得只凭自述**——交接报告须附**脚本 exit code + 产物路径**（`m-gate-check.mjs … --report <项目>/final/M-Gate-Report.json`）；exit 语义 `0` 通过 / `1` P1 / `2` P0 / `3` 仅 P2·soft·SKIP（需 LLM 复核，不得当通过）/ **`10` 参数或路径错误**（v18.0.2 起闸门脚本的路径错一律 10）/ **`70` 内部错误（EX_SOFTWARE，脚本缺陷，与内容判定无关）**（v18.2.6 审计修复：漏此码会把内部错误误判成内容失败、误触发 T5 修订轮）；`model-routing.mjs` 另有 **`4`**＝需人工决定（不与 M 门语义共用；其**用法/配置错**在 v18.12.0 起同样改 **`10`**，不再借用 `1`）；**`handoff-check.mjs`（v18.6.0 交接门）用 `20`/`21`/`22`**——`20` 产物缺失或 0 字节（重派）/ `21` 结构·版本·成对·回报段不合（续接补交）/ `22` 仅软提示（人工复核放行），**与 M 门 1/2/3 刻意分离**（复用会重演「exit 10 被读成 P1」事故）。**判据一句话**：**只要脚本不做内容判定，它的 `1` 就一定是撞码**（v18.12.0 已把全部「用法/参数错」收口到 `10`）。
- **机制文件写保护（v2.5.2-dsh.13；v18.0.0 补授权例外；v18.1.0 部分机械化）**：`SKILL.md` / `AGENTS.md` / `references/**` / `scripts/**` / `cordis.patch.yml` 任何角色（含子代理）**默认禁写**；改进动议只写 `audits/反哺报告-vN.md`，由主人在 host shell 手工 apply（**agent 自主改机制文件 = P0 违规，本次交付作废**）。**v18.1.0**：bundle 部署下入口注册全局 `ctx.tools.guard()`，write/edit 类工具命中机制路径**在分发前即被拒**（官方 `docs/subsystems/tools.md` 的 `guard()` 语义：只收紧、后续监听器无法改回允许；主人授权例外走 `LUNHENG_ALLOW_MECH_EDIT=1`）。**残余缺口如实声明**：guard 只看**工具调用**，`pwsh`/子进程不经此门（官方无 per-path 只读声明），故为「比 prompt 强、比机制强制弱」——机制文件的可信度仍靠 `git` + 四道门 + 主人 review，不靠 guard。
  > **⚠️ 唯一例外：主人显式授权（v18.0.0）**：当**主人直接指令**要求修订机制文件时（如「你依次全部修订吧」），**不构成越权**——主人是机制文件的所有者，该指令即授权。此时仍须遵守：
  > ① **改前备份**（工作区外 `<DSH_HOME>/_backup/lunheng-<日期>/`，含 `scripts/` + `references/` + `SKILL.md` + `AGENTS.md` 全量）+ 记录行数基线；
  > ② **改中用 `edit` 精确匹配**（禁 `sed -i`）；
  > ③ **改后验证**（逐文件语法检查 `node --check`、重跑受影响脚本、必要时 `diff` 对比备份）；
  > ④ **全程可回滚**（备份保留；改动清单与回滚命令写入交付说明）；
  > ⑤ **如实标注**（在改动记录中写明「本次机制文件改动依据主人显式授权」，不掩盖默认约束的突破）。
  > **判据一句话**：**agent 自发改进 = 禁写（只出反哺报告）；主人明确下令 = 可写（走安全流程）**。
- **技能来源自检（v2.5.2-dsh.13）**：启动时核对 `SKILL.md` 版本头与期望版本一致，不一致即停机报「技能来源可疑」（同名技能会按 rank 就近静默顶替）
- **M 门（v2.2.0+）**：终检前必读 `references/_shared/M-Gate-Algorithm.md`（**仅 T7/T8 读**——T1-T5/T9 不读，因 M 门 25 项中 24 项已脚本化为 `scripts/m-gate-check.mjs`（M-Form 1-11 + M-Exist 1-11 + M-Integrity-1 + M-Fact-1 佐证），LLM 只复核 M-Form-8 的承重墙质量与 M-Integrity-2 跨文件判断），按伪代码执行 M-Form/M-Exist/M-Integrity/M-Fact（M-Form 11 项含 M-Form-7 文末白名单 v2.3.5 + M-Form-8 三角验证 v2.3.7 + M-Form-9 图件闭环 v2.5.2-dsh.16 + M-Form-10 索引段完整性 / M-Form-11 素材按需加载闭环 v2.5.2-dsh.17；**M-Fact-1 跨节事实一致性 v18.25.0**），产出 `final/M-Gate-Report.json`，exit 0 才返回
- **图件链路（v2.5.2-dsh.16）**：写手只标 `[图N：标题]`（**独占一行**）→ 主控 Phase 4.5 用 `write` 手写 SVG 到 `final/图件/图N_标题.svg`（**唯一口径**）→ 导出 `md2html.mjs --fig-dir final/图件`（按图号配图，缺图显式标注）→ **M-Form-9** 对账（缺图/图位不足 → P0·P1；孤儿图件/图上数字无出处 → P2 提示）
- **G14 中文 AI 痕迹闸（v2.4.0+；v18.2.8 删早闸，三层防御、仅一次 spawn）**：**① T5 v1 自检**（写作时，零 spawn，结论入 `drafts/修订说明-v1.md`）→ **② 修订轮收尾自查**（每轮修订后主控执行，零 spawn）→ **③ 终闸 = Phase 4.6**（**唯一一次 spawn**；报告 = 最终版本真源）。LLM 推理判定、零 exec，8 类检测维度，**0-2 类 Pass / 3-4 类 Warning → G 环 1 轮 / 5+ 类 Fail → G 环 2 轮**；主人在 Phase 0 可显式关闭。**v18.75.0：终闸串行（不再与 T9 并行），且其修订走 G 环、不占 B 轨额度**（见 `references/pipeline-readme.md` §6.6.1）。闸门定义 `references/gates/14-中文AI痕迹-gate.md`，检测器 `references/checkers/中文AI痕迹-checker.md`
- **T9 同行评审 + 期刊匹配（v2.4.0+/v2.5.0；**v18.75.0 起按文类档案决定启用与否**）**：**Phase 4.7（G14 通过并冻结正文之后）**触发，6 维度评分 → accept/minor/major/reject；学术模式输出 Top 3 推荐期刊（`references/_shared/期刊数据库.md` + `期刊匹配算法.md`）。**启用**：`academic-cn`/`-hum`/`-case` 必选不可关 / `lit-review` 可选 / 其余默认不选（v18.77.0 P-3 由通配 `academic-*` 收口为特指；与 `_shared/文类档案.md` §决策树同源）。**建议处置**：见 `_shared/文类档案.md`「`T9 后处置`」列（三视角类可开 B 轨；单视角类只出建议件，要改由主控在交付后另行修订）
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
   > **布局提示（v18.0.0）**：`consistency-check.mjs` 的 `REPO_ROOT` 自动探测两种布局（仓库布局 / 技能即包根）；旧版硬编码「向上两级」，在本机 `.dsh/skills/` 布局下会指向 `~/.dsh` 而 ENOENT。
   > **改「规范」时另查**（v18.0.5，冗余审计 §二.7）：`references/_shared/规范-机械门对照表.md`——**维护者文档**，逐条勾稽「规范写了什么 ↔ 机械门是否覆盖」（两问：有无门 / 是否覆盖全要件）。新增或修改任何规范/机检门时在该表加一行；它刻意不进运行期读清单（角色不读）。
   > **收口批必跑「差集 + 反向核验」**：仓库级脚本 **closeout-verify**（**不随包**）——宣布「修订已全部完成」**之前**必跑。两步：① **差集**（审计报告每个 `L-NN` 必须被某处修订记录/CHANGELOG 提及）；② **反向核验**（登记为「未做/延后」的项，其后梯队必须回标）。判据：**差集查漏，反向核验查「记录陈旧」**。⚠️ **边界**：只报「需人工回核」的项，**不判「已完成」**——语义那半必须逐条回代码/产物实测。原理与两次自证见 `references/maintainers.md` §七。
   > **发版前必跑「工具链不得改写仓库」**（v18.45.0）：仓库级脚本 **no-write-check**（**不随包**）——`node scripts/no-write-check.mjs` 跑发布序列（全量套 + 四道具）并**逐步快照比对**，报告哪一步改写了仓库的哪些文件（exit `1` = 有改写或**有步骤没跑起来**）。判据：`git status` 只说最终状态，**说不出是谁在哪一步改的**；而「跑完套件与四门」本就是必经动作，顺手核对成本 ≈ 0。立此动作的直接原因是一次**未定位成因**的改写事故（v18.44.0：一个模板标题少了段被登记的豁免括注），故它兼作**下次复现时抓改写者的网**。原理与边界见 `references/maintainers.md` §十。
   > **文档涨了先看词预算门**（v18.1.0）：`repo-hygiene-check` 规则⑨ 对技能目录内 ≥12 KB 的 .md 逐文件设**棘轮上限**（上限按「当前字节向上取整到整 KB」）。**任何文档增长必须在同一次提交里抬升上限并写明理由**；`skills/lunheng-article-pipeline/scripts/` 外的仓库脚本改动不受此门约束。规则① 同时扩面到 `.js` 与**未跟踪文件**（`npm pack` 会打包未 `git add` 的新脚本）。
   **仓库级打包面检查**由 CI 的 `plugin-surface` job 承担（**v18.0.0 起无豁免**）；**清单**与「**两条静态门抓不到、必须由测试兜的**」（包入口执行路径 / patch 自注册行，教训 #152 / #154）见 `references/maintainers.md` §八。

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
