# 反哺报告 v4 — lunheng-commands 斜杠命令体系（借鉴 Ai4Scholar 写作页斜杠命令）

> **状态**：草案，待主人 review
> **版本基线**：论衡 v18.6.2
> **触发调研**：2026-09-22 调研 https://ai4scholar.net/ 第一梯队借鉴 #1（斜杠命令 UX）
> **Ai4Scholar 对照**：v2.9.5「斜杠命令合并重复的引用/搜索为统一入口」+ 「写作页斜杠命令引用免费」
> **作者**：主控 LLM 起草，主人 apply

---

## 一、背景与动机

### 1.1 调研发现（Ai4Scholar 借鉴点）

Ai4Scholar 写作编辑器 v2.9.5 关键改进：

- **斜杠命令统一入口**：「斜杠命令合并重复的引用/搜索为统一入口」——避免 UX 噪声
- **免费斜杠命令引用**：「🆓 斜杠命令引用免费 — 写作页斜杠命令引用文献搜索免费，不再消耗积分」
- **命令集**：`/cite` `/search` `/draw` `/polish` 等

这一 UX 模式对应到论衡场景：**当前论衡是"一次性黑盒触发"，用户写完想改引用 / 换期刊 / 加 PPT 时只能重新走完整流水线**。

### 1.2 论衡现状盘点

| 维度 | 论衡现状 | 借鉴点 |
|------|---------|--------|
| 触发方式 | `@lunheng-article-pipeline` 一次性触发完整流水线 | 不支持中途干预 |
| 中途干预 | 无；用户必须重新触发完整流水线 | **新增 `/lunheng -X` 命令** |
| 论文管理 | `run/<项目>/` 每项目独立，无跨项目视图 | **新增 `-history` 命令** |
| 回滚机制 | 无（修订轮次覆盖旧版） | **新增 `-rollback` 命令** |

### 1.3 改进目标

1. **新建独立技能 `lunheng-commands`**——薄壳 wrapper，处理斜杠命令解析 + 路由
2. **论衡 SKILL.md description 增量**——主人可从 description 看到"斜杠命令也可触发"
3. **11 个斜杠命令**（`-draft / -cite / -audit / -journal / -ppt / -history / -rollback / -resume / -status / -help`）
4. **不影响论衡机制文件**——所有重活仍走论衡子代理；lunheng-commands 仅做命令路由 + 状态查询

---

## 二、改动清单（A 轨 + B 轨混合）

### A 轨：论衡机制文件改动（需主人授权）

#### 改动 1 — 修订论衡 `SKILL.md`

**位置**：第 4 行起的 `---` 之间 frontmatter `description`

**改前**（当前 description，约 100 字）：
```
DSH 原生多 Agent 深度长文流水线（学术论文 / 商业评论 / 行业分析 / 公众号）。9 个独立角色 T1-T9 + 主控（T0 调度 + T8 终检）；三角验证 + M 门 + G 审计 + 修订回环 ≤2 轮 + 期刊匹配。适用：≥2000 字、证据须可追溯的长文（含 4 个人在环节点、1-3 小时流水线时长）。
```

**改后**（追加约 60 字到 description 末尾）：
```
...1-3 小时流水线时长）。进阶用户可用 /lunheng 斜杠命令（详见 lunheng-commands 技能）：-draft/-cite/-audit/-journal/-ppt/-history/-rollback/-resume/-status/-help。命中关键词 = 深度长文 / 学术论文 / 商业评论 / 行业分析。
```

**字数增量**：约 +60 字（DSH frontmatter description 无硬上限，实测 ≤250 字安全）。

---

#### 改动 2 — 修订论衡 `references/pipeline-readme.md` §快速开始

**位置**：行 109 起的 `## 快速开始` 段（"`1. 主控确认主题（Phase 0）...`"）

**改前**：仅描述一次性流水线触发

**改后**（在 §快速开始 末尾追加）：
```markdown
## 进阶用法：/lunheng 斜杠命令

论衡还提供 11 个斜杠命令供中途干预使用（详见独立技能 `lunheng-commands`）：

```
/lunheng -draft [task]      # 启动完整流水线（轻量别名）
/lunheng -resume <id>        # 续跑已有项目
/lunheng -cite <text>        # 对指定段落跑 auto_cite
/lunheng -cite -auto # 对当前定稿全文跑 auto_cite
/lunheng -audit              # 仅跑 T7 G 审计 + M 门（不改稿）
/lunheng -journal <name>     # 改目标期刊 + 重跑 T9
/llunheng -ppt                # 把当前定稿 → PPT 大纲
/lunheng -history            # 列 run/* 历史
/lunheng -rollback<id>      # 回滚到历史版本
/lunheng -status [id]        # 显示当前进度
/lunheng -help               # 列可用命令
```

注意：
- 斜杠命令是「中途干预」机制——主控仍按论衡原机制运行；lunheng-commands 仅做命令路由
- 默认 `/lunheng -cite` 命令免费（借鉴 Ai4Scholar v2.9.5 "斜杠命令引用免费"），不消耗 auto_cite 积分
- `-rollback` 必须 `--confirm` 二次确认，防误操作
```

---

#### 改动 3 — 修订论衡 `references/templates/任务简报-template.md`

**位置**：§v2.5.0 可选项 段

**改前**：无斜杠命令选项

**改后**（追加）：
```markdown
  - **启用 /lunheng 斜杠命令（v18.7+ 借鉴 Ai4Scholar v2.9.5）**：默认开启；勾选后：
    - 主人可在本项目周期内用 /lunheng -X 命令中途干预
    - 关闭后：仅支持 @lunheng-article-pipeline 一次性触发
```

---

### B 轨：新建独立技能 `lunheng-commands`（无需授权，直接创建）

#### 改动 4 — 新建技能目录 `lunheng-commands/`

**完整目录结构**：
```
lunheng-commands/
├── SKILL.md                      # name=lunheng-commands, user-invocable: true
├── package.json                  # 独立 npm 包，可选发布
├── references/
│   └── command-routing.md        # 命令 → 论衡阶段的映射表（单一真源）
├── scripts/
│   ├── route-command.mjs         # 解析 /lunheng <cmd> [args]
│   └── history-cli.mjs           # 读 run/<id>/history.jsonl + 输出 --diff
└── tests/
    └── route.test.mjs            # 命令解析单测
```

#### 改动 5 — 新建 `lunheng-commands/SKILL.md`

**完整内容草案**：

```markdown
> 版本：v18.7.0（独立技能包）

# lunheng-commands — 论衡斜杠命令外壳

> **定位**：薄壳 wrapper，处理 `/lunheng -X` 斜杠命令的解析与路由。
> **不替代论衡**：所有重活（生成 / 审计 / 修订）仍走 `lunheng-article-pipeline` 的子代理；
> 本技能仅做"用户意图 → 论衡阶段调用"的翻译层。
> **包形态**：独立 skill（不入论衡 bundle），rank 走 user-dsh（400）或 custom（300）。
> **触发**：DSH 会话中输入 `/lunheng <cmd> [args]`。

## 命令集

| 命令 | 论衡阶段 | 文档 |
|------|---------|------|
| `-draft [task]` | 启动完整流水线（等效 @lunheng-article-pipeline） | [command-routing.md#draft] |
| `-resume <id>` | 续跑 `run/<id>/` 已存在的项目 | [command-routing.md#resume] |
| `-cite <text>` | 调用 auto_cite（DSH 原生）补强段落 | [command-routing.md#cite] |
| `-cite -auto` | 对当前 `final/定稿.md` 全文跑 auto_cite | [command-routing.md#cite-auto] |
| `-cite -manual <marker>` | 手动模式（用户已标 [CITE]） | [command-routing.md#cite-manual] |
| `-audit` | 仅跑 T7 G 审计 + M 门 | [command-routing.md#audit] |
| `-journal <name>` | 改目标期刊 + 重跑 T9 | [command-routing.md#journal] |
| `-ppt` | 把当前定稿 → PPT 大纲（生成 Markdown） | [command-routing.md#ppt] |
| `-history` | 列 `run/*/` 历史 + 支持 `--diff <id1> <id2>` | [command-routing.md#history] |
| `-rollback <id> --confirm` | 回滚到 checkpoint | [command-routing.md#rollback] |
| `-status [id]` | 显示当前进度（status.md 内容，≤15 行） | [command-routing.md#status] |
| `-help` | 列可用命令 | [command-routing.md#help] |

## 不适用场景

- 短文（<2000 字）：直接用 LLM 答，不走命令
- 实时聊天 / 朋友圈 / 邮件：不适用
- 一次性脚本：直接调论衡子代理，不走本 wrapper

## 工具边界

- ✅ 可调用：DSH 当前会话预设的所有工具
- ✅ 白名单：论衡随包脚本（清单见论衡 SKILL.md §执行能力边界）
- ❌ 不做：自动 commit / 自动 publish / 自动 apply 机制文件改动

## 安装

两种方式（二选一）：

1. **本地技能根**：`cp -r lunheng-commands/ <DSH_HOME>/skills/lunheng-commands/`（rank 400）
2. **项目技能根**：`cp -r lunheng-commands/ <workspace>/.dsh/skills/lunheng-commands/`（rank 100，会顶替用户级）

## 与论衡的关系

- lunheng-commands 是 **薄壳**：不引入新角色、新阶段、新 M 门
- 论衡的所有 M 门 / G 门 / F 模式不变
- history.jsonl 等新增文件**写在项目目录 `run/<id>/`**（项目级，不污染论衡机制）
```

---

#### 改动 6 — 新建 `lunheng-commands/references/command-routing.md`

**完整内容草案**：

```markdown
> 版本：v18.7.0

# /lunheng 命令路由表（单一真源）

> 本文档是 11 个命令如何路由到论衡阶段的**唯一真源**。
> 修改命令行为只改本文档 + `route-command.mjs`；
> SKILL.md 只列命令清单与文档锚点。

<a id="draft"></a>

## `-draft [task]`

**行为**：等效 `@lunheng-article-pipeline`，启动完整流水线。
**参数**：`[task]` 可选；省略时主控走 Phase 0 同意关卡（4 选 1）。
**论衡阶段**：Phase 0 → 1 → 2 → 2.5（人）→ 3 → 3.5（人）→ 3.6 → 4 → 4.5 → 5

<a id="resume"></a>

## `-resume <id>`

**行为**：载入 `run/<id>/01-任务简报.md` + `status.md` + `agents-log.md`，恢复到上次中断点。
**参数**：`<id>` 必填，项目目录名（`run/<id>/`）。
**论衡阶段**：从 status.md 的当前阶段继续。

<a id="cite"></a>

## `-cite <text>`

**行为**：调用 DSH 原生 `auto_cite` 对 `<text>` 段落补强引用。
**默认免费**（借鉴 Ai4Scholar v2.9.5"斜杠命令引用免费"）——不消耗积分。
**参数**：`<text>` 必填。
**论衡阶段**：T5 写手后辅助工具，不影响流水线。

<a id="cite-auto"></a>

## `-cite -auto`

**行为**：对当前 `final/定稿.md` 全文跑 auto_cite 全量校验。
**默认免费**。
**论衡阶段**：Phase 4.5 终稿前辅助工具。

<a id="cite-manual"></a>

## `-cite -manual <marker>`

**行为**：手动模式（用户已在文本中标记 `[CITE]`）。
**参数**：`<marker>` 必填，标记文本（如 "[CITE]"）。
**论衡阶段**：同 `-cite`。

<a id="audit"></a>

## `-audit`

**行为**：仅跑 T7 G 审计 + M 门，不修改稿件。
**论衡阶段**：Phase 4 审计（不改稿）。
**输出**：`audits/审计报告-vN.md` + `final/M-Gate-Report.json`。

<a id="journal"></a>

## `-journal <name>`

**行为**：修改任务简报 §目标期刊 + 重跑 T9 + 期刊匹配。
**参数**：`<name>` 必填，期刊名。
**论衡阶段**：Phase 4.5 审稿（重跑）。

<a id="ppt"></a>

## `-ppt`

**行为**：把当前定稿 → PPT 大纲（生成 Markdown 表格，可导入 Gamma / Ai4Scholar PPT）。
**论衡阶段**：Phase 5 终检后辅助输出。
**输出**：`run/<id>/exports/ppt-outline.md`。

<a id="history"></a>

## `-history` / `-history --diff <id1> <id2>`

**行为**：
- 默认：列 `run/*/` 所有项目（项目名 + 最后修改时间 + 当前阶段）。
- `--diff`：对比两个项目（基于 sha256 + 文件级 read）。

**数据源**：`run/<id>/history.jsonl`（论衡反哺报告 v5 项目化新增，见 P2 实施路线）。

<a id="rollback"></a>

## `-rollback <id> --confirm`

**行为**：从 `run/<id>/checkpoints/phase-XX/` 恢复到指定 checkpoint。
**二次确认**：`--confirm` 必填；缺则提示「将自动确认回滚，请重试并加 --confirm」。
**论衡阶段**：影响 status.md + 重置 agents-log.md。

<a id="status"></a>

## `-status [id]`

**行为**：显示当前项目进度（≤15 行人类可读版）。
**参数**：`[id]` 可选；省略时取最新项目。
**数据源**：`run/<id>/status.md` + Dashboard 头部。

<a id="help"></a>

## `-help`

**行为**：列可用命令 + 简述。
```

---

#### 改动 7 — 新建 `lunheng-commands/scripts/route-command.mjs`

**完整内容草案**（节选关键段）：

```javascript
#!/usr/bin/env node
// route-command.mjs — /lunheng <cmd> [args] 路由到论衡阶段
// 版本：v18.7.0

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 命令路由表（单一真源 = command-routing.md）
const COMMANDS = {
  '-draft': { phase: 'full', desc: '启动完整流水线' },
  '-resume': { phase: 'resume', desc: '续跑已有项目' },
  '-cite': { phase: 'cite', desc: '对段落跑 auto_cite（默认免费）' },
  '-audit': { phase: 'audit', desc: '仅跑 T7 G 审计 + M 门' },
  '-journal': { phase: 'journal', desc: '改目标期刊 + 重跑 T9' },
  '-ppt': { phase: 'ppt', desc: '把定稿 → PPT 大纲' },
  '-history': { phase: 'history', desc: '列 run/* 历史 + --diff' },
  '-rollback': { phase: 'rollback', desc: '回滚到 checkpoint（需 --confirm）' },
  '-status': { phase: 'status', desc: '显示当前进度' },
  '-help': { phase: 'help', desc: '列可用命令' },
};

export function routeCommand(argv) {
  if (argv.length < 2 || argv[1] !== '-lunheng') {
    return { error: '用法：/lunheng <cmd> [args]' };
  }
  const cmd = argv[2];
  const args = argv.slice(3);

  if (!cmd) return { error: '缺命令。/lunheng -help 查看可用命令' };
  if (cmd === '-help' || cmd === '-h') return { ok: true, action: 'help' };
  if (!COMMANDS[cmd]) return { error: `未知命令：${cmd}` };

  // 二次确认检查（-rollback 必填 --confirm）
  if (cmd === '-rollback' && !args.includes('--confirm')) {
    return { error: '⚠ -rollback 需要 --confirm 二次确认' };
  }

  return { ok: true, action: COMMANDS[cmd].phase, args };
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = routeCommand(process.argv);
  console.log(JSON.stringify(result, null, 2));
}
```

---

#### 改动 8 — 新建 `lunheng-commands/scripts/history-cli.mjs`

**完整内容草案**（节选）：

```javascript
#!/usr/bin/env node
// history-cli.mjs — 读 run/<id>/history.jsonl + 输出 --diff
// 版本：v18.7.0

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const RUN_DIR = resolve(process.cwd(), 'run');

function listProjects() {
  if (!existsSync(RUN_DIR)) return [];
  return readdirSync(RUN_DIR)
    .filter(name => existsSync(join(RUN_DIR, name, '01-任务简报.md')))
    .map(name => {
      const stat = readFileSync(join(RUN_DIR, name, '01-任务简报.md')).mtime;
      return { name, lastModified: stat };
    });
}

function readHistory(projectId) {
  const historyPath = join(RUN_DIR, projectId, 'history.jsonl');
  if (!existsSync(historyPath)) return [];
  return readFileSync(historyPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function diffProjects(id1, id2) {
  // 基于 sha256 + 文件级 read
  const dir1 = join(RUN_DIR, id1);
  const dir2 = join(RUN_DIR, id2);
  // ... 简化实现 ...
}

export { listProjects, readHistory, diffProjects };

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'list') {
    console.log(JSON.stringify(listProjects(), null, 2));
  } else if (cmd === 'read') {
    console.log(JSON.stringify(readHistory(process.argv[3]), null, 2));
  } else if (cmd === 'diff') {
    console.log(JSON.stringify(diffProjects(process.argv[3], process.argv[4]), null, 2));
  }
}
```

---

#### 改动 9 — 新建 `lunheng-commands/tests/route.test.mjs`

**完整内容草案**：

```javascript
// route.test.mjs — 路由解析单测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeCommand } from '../scripts/route-command.mjs';

test('valid command -draft', () => {
  const result = routeCommand(['node', '-lunheng', '-draft', '写一篇 5000 字论文']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'full');
});

test('valid command -cite', () => {
  const result = routeCommand(['node', '-lunheng', '-cite', '段落文本']);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'cite');
});

test('-rollback without --confirm fails', () => {
  const result = routeCommand(['node', '-lunheng', '-rollback', 'phase-25-outline']);
  assert.equal(result.error.includes('--confirm'), true);
});

test('-rollback with --confirm succeeds', () => {
  const result = routeCommand(['node', '-lunheng', '-rollback', 'phase-25-outline', '--confirm']);
  assert.equal(result.ok, true);
});

test('unknown command fails', () => {
  const result = routeCommand(['node', '-lunheng', '-unknown']);
  assert.equal(result.error.includes('未知命令'), true);
});

test('missing command fails', () => {
  const result = routeCommand(['node', '-lunheng']);
  assert.equal(result.error.includes('缺命令'), true);
});
```

---

## 三、验证清单（apply 后必走）

### 3.1 自动化验证

```bash
# 1. 论衡三门（确认机制文件改动不破坏）
node scripts/consistency-check.mjs
# 预期：exit 0

dsh-plugin-dev check
# 预期：0 fail / 0 warn

node --test "tests/**/*.test.mjs"
# 预期：全绿

# 2. lunheng-commands 独立测试
cd <lunheng-commands 路径>
node --test tests/route.test.mjs
# 预期：6 条用例全绿

# 3. 实战命令解析
node scripts/route-command.mjs -lunheng -draft "写一篇 5000 字论文"
# 预期：{"ok": true, "action": "full", "args": ["写一篇 5000 字论文"]}

node scripts/route-command.mjs -lunheng -rollback phase-25
# 预期：{"error": "⚠ -rollback 需要 --confirm 二次确认"}

node scripts/route-command.mjs -lunheng -help
# 预期：{"ok": true, "action": "help"}
```

### 3.2 实战验证

1. 在 DSH 会话中输入 `/lunheng -draft 写一篇 5000 字中国新能源车出口分析`
   - 期望主控走 Phase 0 同意关卡
2. 输入 `/lunheng -status`
   - 期望输出 ≤15 行进度
3. 输入 `/lunheng -history`
   - 期望列出所有 `run/*/` 项目
4. 输入 `/lunheng -rollback phase-25-outline --confirm`
   - 期望恢复到 Phase 2.5 checkpoint

---

## 四、风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 论衡 SKILL.md description 增量导致 DSH frontmatter 解析异常 | 增量控制在 ≤60 字；保留原 description 主体 | 删除追加段，恢复原 description |
| `/lunheng -rollback` 误操作丢稿 | `--confirm` 二次确认；checkpoint 机制由论衡 v5 项目化保障 | 禁用 -rollback 命令 |
| lunheng-commands 与论衡 M 门冲突 | lunheng-commands 是薄壳，不引入新 M 门；所有重活走论衡 | 禁用 lunheng-commands |
| auto_cite 默认免费导致积分超支 | "斜杠命令引用免费" 是借鉴 Ai4Scholar 设计；主控可显式禁用 | 关闭"启用 /lunheng"勾选 |
| history.jsonl 写入路径冲突 | 路径由论衡 v5 项目化新增；本反哺报告暂不依赖 | 等待 v5 落地后启用 -history |

### 回滚一行命令

```bash
# 论衡机制文件回滚
git revert <commit-hash-of-v18.7.0-commands>

# lunheng-commands 独立包回滚
rm -rf <DSH_HOME>/skills/lunheng-commands/
```

---

## 五、测试用例

### 用例 1：-draft 命令

输入：`/lunheng -draft 写一篇 5000 字中国新能源车出口分析`
期望：主控走 Phase 0 同意关卡，载入论衡完整流水线

### 用例 2：-resume 命令

输入：`/lunheng -resume phase-25-outline`
期望：从 Phase 2.5 checkpoint 恢复流水线

### 用例 3：-cite 默认免费

输入：`/lunheng -cite "AlphaFold 是蛋白质结构预测的里程碑"`
期望：
- 调用 DSH 原生 auto_cite
- 不消耗积分（默认免费）
- 输出"⚠ 该段落推荐引用：Jumper et al., 2021..."

### 用例 4：-rollback 二次确认

输入：`/lunheng -rollback phase-25-outline`（无 --confirm）
期望：错误提示「需要 --confirm」

输入：`/lunheng -rollback phase-25-outline --confirm`
期望：恢复到 phase-25-outline checkpoint

### 用例 5：-status 输出 ≤15 行

输入：`/lunheng -status`
期望：≤15 行人类可读版本

---

## 六、与已有机制的关系（避免冲突声明）

| 已有机制 | 关系 |
|---------|------|
| 论衡 v18.6.2 流水线 | **不破坏**——lunheng-commands 是薄壳，所有重活走论衡 |
| DSH frontmatter description | **增量 ≤60 字**——DSH 无硬上限，实测 ≤250 字安全 |
| 论衡 SKILL.md frontmatter | **唯一改动**——仅 description 字段，不动 name/version |
| 论衡 v18.7.0 M 门（反哺 v1/v2/v3） | **不冲突**——lunheng-commands 不引入新 M 门 |
| 论衡 v18.7.0 history.jsonl（项目化） | **联动**——`-history` 命令依赖 history.jsonl；v18.7.0 同步落地 |

---

## 七、apply 前的最终确认清单

- [ ] 主人已 review 本反哺报告全文
- [ ] 主控已跑 baseline `node scripts/consistency-check.mjs`（apply 前 exit 0）
- [ ] 备份已做：`cp -r .dsh/skills/lunheng-article-pipeline/ $DSH_HOME/_backup/lunheng-v18.6.2-pre-v4/`
- [ ] 行数基线已记录（3 个论衡机制文件）
- [ ] lunheng-commands 技能目录已规划（独立包）

**apply 后必走**：
- [ ] 3 个论衡文件改动各跑一次 `node --check`（如适用）
- [ ] lunheng-commands 6 个新文件全部就位
- [ ] 论衡三门全绿（apply 论衡侧后）
- [ ] lunheng-commands 独立测试全绿（apply lunheng-commands 后）
- [ ] 实战首单验证（5000 字测试论文 + `/lunheng -draft` 触发完整流水线 + `/lunheng -status` 查看进度）

---

## 八、发布建议

本反哺报告对应 2 个独立发布：

1. **论衡 v18.7.0**（机制文件改动 3 处）—— `dsh-plugin-dev release --version v18.7.0`
2. **lunheng-commands v1.0.0**（独立技能包发布）—— `dsh plugin add lunheng-commands@1.0.0` 或本地技能根

两个发布**互不依赖**：
- 论衡 v18.7.0 可独立发布（仅 description 增量）
- lunheng-commands 可独立发布（不依赖论衡版本）

---

**反哺报告 v4 结束**

---

## 附录：4 份反哺报告整合发布检查清单

| 反哺 | 论衡版本 | 关联机制文件 | 新增文件 | 验证 |
|------|---------|------------|---------|------|
| **v1** APA+卷期页码 | v18.7.0 | 任务简报模板、pipeline-readme、M-Gate-Algorithm | auto_cite-integration.md | 三门 + 实战 |
| **v2** T3.5 auto_cite | v18.7.0 | 任务简报模板、pipeline-readme、M-Gate-Algorithm、glossary | auto_cite-补充-template.md | 三门 + 实战 |
| **v3** 引用数量+期刊 | v18.7.0 | 任务简报模板、09-审稿卡、audit-checklist、M-Gate-Algorithm、glossary | (无) | 三门 + 实战 |
| **v4** 斜杠命令 | v18.7.0 + 独立 | 论衡 SKILL.md、pipeline-readme、任务简报模板 | lunheng-commands/ 6 个文件 | 三门 + 独立测试 + 实战 |

**整合发布节奏**：4 份反哺报告可作为 4 个独立 commit / 4 个独立 PR / 1 个整合 v18.7.0 版本发布——主人决定。