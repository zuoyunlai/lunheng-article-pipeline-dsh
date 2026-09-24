// ⑩ 随包脚本白名单 / ⑩b 脚本计数 / ⑩c 分档映射（含 walkAny / tierTruth）
// v18.3.1（审计 B2 阶段 3）：从 consistency-check.mjs 按规则族抽离，行为逐字等价（回归测试的
//   注入验证用例 + 真源仓库自跑兜底）。共享态（errors / 派生源 / 版本真源等）由主脚本构建 ctx 传入。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

// ⑩ 随包脚本白名单集合一致性（v2.5.2-dsh.13 新增，教训：白名单曾出现 7/8/9 三种口径）
export function runScriptRules(ctx) {
  const { ROOT, REPO_ROOT, files, active, skillText, gateSrc, GATE_DERIVED, gateModMissing, checkGateCounts, SEMVER, normVer, pkgVer, inlineTagTargets, isArchive, UPSTREAM_SPEC_VERSIONS, walk, errors } = ctx;
const diskScripts = readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs')).sort();
const diskNames = diskScripts.map((f) => f.replace(/\.mjs$/, ''));
const wlLine = readFileSync(join(ROOT, 'SKILL.md'), 'utf8').split('\n').find((l) => l.includes('随包脚本白名单')) || '';
// SKILL.md 白名单行的格式：`scripts/*.mjs` = a / b / c + 有限验证命令…
// 只取「纯脚本名」token（`[a-z0-9-]+`）——防止清单里夹带的括注/路径把解析带偏（v2.5.2-dsh.13 加固：
// 曾因注释中出现 `scripts/_lib/*.mjs` 被当成清单分隔符，导致 normalize-trust-level 被误判漏列）
const declaredNames = (wlLine.split('=')[1] || '').split('+')[0].split('/').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s));
const missingInDoc = diskNames.filter((s) => !declaredNames.includes(s));
const extraInDoc = declaredNames.filter((s) => !diskNames.includes(s));
if (missingInDoc.length > 0) errors.push(`[P1 白名单漏列] SKILL.md 未列：${missingInDoc.join(', ')}（磁盘共 ${diskScripts.length} 个）`);
if (extraInDoc.length > 0) errors.push(`[P1 白名单多列] SKILL.md 列了不存在的脚本：${extraInDoc.join(', ')}`);
const declaredCount = wlLine.match(/白名单（[^）]*?(\d+)\s*个/)?.[1];
if (declaredCount && Number(declaredCount) !== diskScripts.length) {
  errors.push(`[P1 白名单数量不符] SKILL.md 声明 ${declaredCount} 个 ≠ 磁盘 ${diskScripts.length} 个`);
}

// ⑩b 脚本计数全库对账（v18.0.2 新增；**v18.2.6 审计修复：识别方式改为结构派生**）
//   教训（v18.0.2）：白名单行写 11 个（当时正确），而 glossary 写「随包 9 个」、SKILL.md 另一处写「共 10 个」
//     ——规则 ⑩ 只核白名单那一行，另两处长期失真且无门可拦（「多宿主事实」的典型代价）。
//   **教训（v18.2.6，本轮审计 B 实测）**：旧实现那 5 条正则，对仓库内 **26 条真实含计数的句子命中 0 条**
//     ——连 SKILL.md 白名单行自身那行都不匹配。根因 = 它靠「随包 / 共 N 个…脚本 / N 个门禁脚本」等**措辞**识别，
//     而真实句子的措辞是「v2.5.2-dsh.17 **复核为 11 个脚本**」「白名单（v18.2.5 **复核为 12 个**）」
//     「，**共 11 个**」「12 个 `.mjs`」——一个都不在词表里。后果：v18.2.5 新增 `apply-diff.mjs` 后
//     **真实存在 11-vs-12 漂移（QUICKSTART 与 00-主控-coordinator 逐条列 11 个、漏 apply-diff）而门判绿**。
//   现改为**结构派生**（不依赖措辞）：
//     ① 句子里**列出 ≥3 个 `*.mjs` 文件名** → 该句的「N 个」计数必须 == 磁盘真值；
//     ② 或句子出现「脚本 / 白名单 / 门禁」且数字**紧邻**这些词（±12 字符）→ 同样对账。
//   磁盘真值 = `scripts/*.mjs` **顶层**计数（`_lib/` 是共享库、非入口，不计）。
//   豁免三处（各自理由）：CHANGELOG（历史段记录当时事实，不追溯改写）；含「串联」的行
//     （`自动串联 3 脚本` 说的是 final-check 串联的子集，不是白名单断言）；含「旧版/历史/当时/修理」的行
//     （**清仓类注解必须能引用旧数字**，否则修一处就得删掉教训本身）。
//   负向用例（自测用，勿留在仓里）：把 SKILL.md 白名单行的「12 个」改成「11 个」
//     → 本规则应报 `[P1 脚本计数漂移]` 并使脚本 exit 1（实测见交付报告的反事实验证）。
const SCRIPT_COUNT_RE = /(\d+)\s*个|(\d+)\s*(?:zero-dependency|零依赖)?\s*\.mjs/gi;
// 「N 个」之后**定向**判是不是脚本计数（v18.2.6：靠「附近有脚本字样」判必然误伤——
//   实测 4 处反例同行都出现过「脚本」：`2 个只读工具` / `8 个假 P0` / `图件 0 个` / `11 个真实项目，token-budget.mjs`）。
//   两问：① 「N 个」紧跟的**计数量词**是不是脚本语义词（≤5 字符过渡，容纳 `）**：\`scripts/`、`，含 \`apply-diff.mjs\``）；
//        ② 紧跟「个」的**被计数名词**是不是已知非脚本名词（命中即跳过）。
const SCRIPT_AFTER = /^[^\d\n]{0,5}(?:脚本|门禁|scripts?\/|[a-z0-9-]+\.mjs)/;
const NON_SCRIPT_NOUN = /^\s*(?:真实项目|项目|只读工具|工具|假\s?P[01]|阶段|轮|文件|汉字|条目)/;
const seenClaim = new Set();   // 去重：`active` 与 `walk(REPO_ROOT)` 会重复覆盖技能目录（旧实现同一漂移报两遍）
const claimTargets = [...active, ...(existsSync(REPO_ROOT) ? walk(REPO_ROOT) : [])];
for (const f of claimTargets) {
  if (f.endsWith('CHANGELOG.md')) continue;
  if (seenClaim.has(f)) continue;
  seenClaim.add(f);
  const rel = relative(REPO_ROOT, f).replaceAll('\\', '/');
  if (/^docs\/(审计与修订记录|验证记录)\//.test(rel)) continue;   // 历史归档目录：审计/修订/验证记录记成文时旧口径，整体豁免（发版前审计 §二）
  if (/^audits\/反哺报告-/.test(rel)) continue;                    // v18.9.0 反哺：反哺报告与审计/修订记录同为历史快照，正文引用当时脚本数（如「14 个脚本」）不得被回溯改写
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    if (/串联/.test(l)) return;                                          // 「自动串联 3 脚本」= 子集断言
    if (/旧版|历史|当时|曾经|教训|漂移|更正|修复|不再/.test(l)) return;   // 清仓注解须能引用旧数字
    const mjsNames = new Set([...l.matchAll(/[a-z0-9][a-z0-9-]*\.mjs/g)].map((x) => x[0]));
    const structural = mjsNames.size >= 3;                               // ① 结构派生：列了 ≥3 个脚本名
    if (!structural && !/脚本|白名单|门禁/.test(l)) return;               // ② 措辞派生需要「脚本/白名单/门禁」上下文
    for (const m of l.matchAll(SCRIPT_COUNT_RE)) {
      const n = Number(m[1] ?? m[2]);
      const after = l.slice(m.index + m[0].length);
      if (NON_SCRIPT_NOUN.test(after)) continue;                          // ② 被计数名词非脚本
      if (!structural && !SCRIPT_AFTER.test(after)) continue;             // ① 计数量词非脚本语义
      if (n !== diskScripts.length) {
        errors.push(
          `[P1 脚本计数漂移] ${rel}:${i + 1} 写 ${n} 个 ≠ 磁盘 ${diskScripts.length} 个（` +
            `唯一真源 = SKILL.md「随包脚本白名单」行；其余处请改指针或同步数字）`,
        );
      }
    }
  });
}

// ⑩c 分档工具 ↔ 角色映射全库对账（v18.0.3 新增）
//   教训：`subagent_strong` / `subagent_audit` 的角色归属在**11 处副本**里长期分成两种口径——
//   五语 README + docs/installation + docs/usage + 技能 README + `examples/preset/README.md` 把
//   T6 批判 / T9 审稿 列在「强推理档」，而真源 `scripts/model-routing.mjs` 的 `roles` 与
//   `references/_shared/模型路由.md` §二 早已定案 T6/T7/T9/G14 → `subagent_audit`（顶配防漏判档）；
//   规则 ⑩ 只管脚本白名单那一行，分档映射**无门可拦**——多宿主各写一份表，谁也没对账。
//   本规则把真源派生的 `tool → roles` 与每一处断言对账：行内出现**恰好一个**独立工具名
//   （其后不接 `/`，故 `subagent_retrieval/strong/audit` 这类复合写法不算断言）即视为断言，
//   行内其余 `T\d` / `G14` 编号集合必须与真源集合相等。
//   扫描范围（v18.0.5 扩）：markdown **表格行**、`#   - subagent_x: …` 注释行，以及
//   **`.yml` / `.yaml` / `.json` 里任意含单个工具名的行**（第三方审计 P2-1：`examples/preset/preset.yml`
//   就是漏网的那一处——旧版只 walk `.md`）。CHANGELOG 豁免（历史段记录当时事实）。
//   **边界（如实）**：纯散文式表述（只写角色不写工具名，如「分析写作批判审稿 T4-T6+T9」）无法机械判定，
//   不在本规则内——那类只能靠人读；已修的那处已加真源指针防复发。
const TIER_TOOL_RE = /subagent_(retrieval|strong|audit)(?![a-z/])/;
const walkAny = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '.git' || name === 'node_modules') continue;
      walkAny(p, acc);
    } else if (/\.(md|ya?ml|json)$/.test(name)) acc.push(p);
  }
  return acc;
};
const tierTruth = new Map();
{
  const routingSrc = readFileSync(join(ROOT, 'scripts', 'model-routing.mjs'), 'utf8');
  for (const m of routingSrc.matchAll(/tool:\s*'(subagent_(?:retrieval|strong|audit))',\s*roles:\s*\[([^\]]*)\]/g)) {
    tierTruth.set(m[1], [...new Set([...m[2].matchAll(/T\d+|G14/g)].map((x) => x[0]))].sort());
  }
  if (tierTruth.size !== 3) {
    errors.push(
      `[P0 分档真源] 无法从 scripts/model-routing.mjs 派生 3 档 tool→roles（实得 ${tierTruth.size} 档）` +
        '——规则 ⑩c 失效即静默放行，故按 P0 报（真源改了写法就同步本规则的正则）',
    );
  }
}
if (tierTruth.size === 3) {
  const scanned = new Set();
  for (const f of [...active, ...(existsSync(REPO_ROOT) ? walkAny(REPO_ROOT) : [])]) {
    if (scanned.has(f) || f.includes('CHANGELOG')) continue;
    scanned.add(f);
    const rel = relative(REPO_ROOT, f).replaceAll('\\', '/');
    const isYaml = /\.(ya?ml|json)$/.test(f);
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      // markdown：只认表格行与 `#   - subagent_x:` 注释行（避免散文误判）
      // yaml/json：任意行只要含工具名即视为断言；**一行多档**时按分隔符切段逐段判定
      //   （v18.0.5：`examples/preset/preset.yml` 的档位描述常把三档写在一行）
      const parts = isYaml
        ? l.split(/[｜|、；;]|\s\/\s/)
        : [l];
      if (!isYaml && !l.trimStart().startsWith('|') && !/^\s*#\s*-\s*subagent_/.test(l)) return;
      if (l.trimStart().startsWith('#')) return;   // yaml 里的注释行不判（说明性文字）
      for (const part of parts) {
        const tools = [...part.matchAll(new RegExp(TIER_TOOL_RE.source, 'g'))].map((m) => m[0]);
        if (tools.length !== 1) continue;
        const tool = tools[0];
        const got = [...new Set([...part.matchAll(/T\d+|G14/g)].map((m) => m[0]))].sort();
        // yaml/json：只有**同时**出现角色编号才视为「映射断言」（`toolName: subagent_retrieval` 这类
        // 单纯引用工具名不算断言——那正是 patch 的行配置，不是角色归属表）
        if (isYaml && got.length === 0) continue;
        const want = tierTruth.get(tool);
        if (got.join('/') !== want.join('/')) {
          errors.push(
            `[P1 分档映射漂移] ${rel}:${i + 1} 「${tool}」行写 ${got.join('/') || '（无角色）'}，` +
              `真源 roles = ${want.join('/')}（真源：scripts/model-routing.mjs + references/_shared/模型路由.md §二）`,
          );
        }
      }
    });
  }
}

}
