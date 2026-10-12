// ⑪ CHANGELOG / ⑫ 版本点位全量 / ⑬ docs 版本点位 / ⑭ patch 执行面红线
// v18.3.1（审计 B2 阶段 3）：从 consistency-check.mjs 按规则族抽离，行为逐字等价（回归测试的
//   注入验证用例 + 真源仓库自跑兜底）。共享态（errors / 派生源 / 版本真源等）由主脚本构建 ctx 传入。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

// ⑪ CHANGELOG 当前版本段存在性（v2.5.2-dsh.13 新增，教训：dsh.12 的 bump 提交标题声称含 CHANGELOG 实际未写）
export function runDocsVersionRules(ctx) {
  const { ROOT, REPO_ROOT, files, active, skillText, gateSrc, GATE_DERIVED, gateModMissing, checkGateCounts, SEMVER, normVer, pkgVer, inlineTagTargets, isArchive, UPSTREAM_SPEC_VERSIONS, walk, errors } = ctx;
const clPath = join(REPO_ROOT, 'CHANGELOG.md');
if (existsSync(clPath)) {
  const cl = readFileSync(clPath, 'utf8');
  const esc = pkgVer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^##\\s+${esc}(\\s|（|$)`, 'm').test(cl)) {
    errors.push(`[P0 CHANGELOG] 缺当前版本段落「## ${pkgVer}」——版本 bump 必须与 CHANGELOG 段同提交`);
  }
}

// ⑫ 版本点位全量扫描（v2.5.2-dsh.13 新增：旧规则 ⑦ 只认 `> 版本：` 开头，漏检 `- 版本：`/标题内嵌等形态）
// v18.2.4 修订（第三方审计「门必须覆盖它声称覆盖的规范」；主人指令「修」）：补一类**实测漏检**。
//   · 漏点 B —— **加粗版版本头 `> **版本**：vX.Y.Z`**：旧正则 `[-*>#]*\s*版本：` 在标记与 `版本：`
//     之间**不允许夹 `**`**，故 `DSH-集成方案.md` / `规范-机械门对照表.md` 两处实际一直是人工刷的、
//     门判不到（人工一疏忽即静默停在旧版本）。修法：把 `**` 纳入可选标记（`\*{0,2}`）。
//   （漏点 A「内联 git tag」在**仓库级文件**里，不在本规则的扫描面内——已补在规则①/⑦ 同址，
//     见上方 `inlineTagTargets`。本注释保留此交叉指引，防后来者以为它在此处。）
for (const f of files) {
  if (isArchive(f)) continue;
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    const m = l.match(new RegExp('^\\s*[-*>#]*\\s*\\*{0,2}版本\\*{0,2}：v?(' + SEMVER + ')'));
    if (m && normVer(m[1]) !== normVer(pkgVer)) {
      errors.push(`[P0 版本点位漂移] ${rel}:${i + 1} 写 ${m[1]} ≠ package.json=${pkgVer}`);
    }
    const t2 = l.match(new RegExp('^#\\s+\\S.*（v?(' + SEMVER + ')）'));
    if (t2 && !UPSTREAM_SPEC_VERSIONS.has(t2[1]) && normVer(t2[1]) !== normVer(pkgVer)) {
      errors.push(`[P1 标题内嵌版本漂移] ${rel}:${i + 1} 写 ${t2[1]} ≠ package.json=${pkgVer}`);
    }
  });
}

// ⑫ 补硬判据（v18.78.2 · 全量审计-v18.78.1 **A1**）：**版本头必须存在**。
//   病灶：上面的循环是 **match-on-drift**——「有版本行则对账，无版本行则无视」。审计的反事实实验（副本内）：
//     ① 删掉 `references/agents/01-文献检索-literature-scout.md` 的 `> 版本：` 行 → **exit 0 /「0 处漂移」**；
//     ② 把同一行的版本号改成 `v18.11.0` → **exit 2 / `[P0 版本点位漂移]`**。
//     即：**写错会被抓，整行删掉反而无任何信号**——这是本仓「单向门」家族的典型。
//   影响面（审计实测 + 本次复核一致）：随包 84 个 `.md` 里 **27 个无版本头行**，其中 **12 个是常驻/机制文档**
//     （`AGENTS.md`、`README.md`、`references/operations.md`、`checkers/`、`gates/`、3 个 `_shared/`、…）。
//     `AGENTS.md` 是**自动生效的常驻指令文件**，其版本此前无从自检。
//   判据：**随包 `.md` 必须含一行版本头**（形态与上面的对账正则同族：`[-*>#] 版本：vX.Y.Z`）。
//   豁免（**有意选择**，理由必须写在代码里，不许静默）：
//     · `references/templates/**`——模板会被**逐字复制进 `run/<项目>/`**（主控按模板产任务简报/报告），
//       版本头会跟着进**产物**，而产物不是本包的版本化文档；且模板族 35 份里本就有 20 份带、15 份不带，
//       统一补 = 一次性改 15 份模板并让它们与产物形态分叉，收益不抵 churn。
//     · 历史归档（`isArchive`，沿用既有口径）。
//   边界（如实声明）：本判据只查**存在性**，不查位置（`> 版本：` 在文件首行是本仓惯例、由 review 看）；
//     版本号本身对不对由上面的对账循环管。
const VER_HEADER_PRESENT_RE = new RegExp('^\\s*[-*>#]*\\s*\\*{0,2}版本\\*{0,2}：v?' + SEMVER);
for (const f of files) {
  if (!f.endsWith('.md') || isArchive(f)) continue;
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  if (rel.startsWith('references/templates/')) continue;
  if (!readFileSync(f, 'utf8').split('\n').some((l) => VER_HEADER_PRESENT_RE.test(l))) {
    errors.push(`[P1 版本头缺失] ${rel} 无版本头行（形如 \`> 版本：vX.Y.Z\`）——规则 ⑫ 是 match-on-drift，整行删掉即无信号；随包 .md 必须带版本头（` + '`references/templates/` 豁免，理由见本规则注释）');
  }
}

// ⑬ docs/ 版本点位（v2.5.2-dsh.13 新增；v18.85.0-feat 升级形态+豁免）：
//   · 安装 pin（`@x.y.z`，含历史 `@x.y.z-dsh.N`）；· 「当前版本」声明行。历史章节（版本历史/演进/里程碑等）整体跳过。
//
// ⚠️ **归属声明（v18.86.0-prep · 防重复加形态）**：`docs/quick-facts.md` 的**表格形态**
//   「`| 当前版本 | **vX.Y.Z** |`」由规则 **㊲ 速查卡硬数字派生**（`repo-surface-rules.mjs`）负责，
//   ⑬ **不重复报**——**同一事实不设两道门**（㊲ 从 `package.json` 派生、口径更严）。
//   实测依据：`docs/**` 中该表格形态**只此一处**（其余为行内散文形态，由 ⑬ 覆盖）。
//   故 ⑬ 的正则**刻意不扩**到「`当前版本 | vX`」——不是缺口，是**归属划分**（v18.85.0 曾登记为「已知缺口」，本行更正定性）。
//
// v18.85.0-feat 升级（主人 2026-10-09 17:22 指令）：
//   旧实现 ⑬ 在 `docs/token-optimization-plan.md` 和 `docs/验证记录/dsh-*.md` 等地**会误报**（实测）：
//     · `lunheng-article-pipeline@2.5.2-dsh.15` 命中 `@(SEMVER)` → 报 drift（**旧规约版本线**，与 DSH 包版本不同线）
//     · `@0.1.5-rc.2` 命中 `@(SEMVER)` → 报 drift（**宿主包版本**，与 DSH 包版本不同线）
//     · `当前版本 v18.0.0 起` 命中 `当前版本\s*\*{0,2}v?(SEMVER)` → 报 drift（**叙述起始时点**，改 = 改写历史）
//   旧实现**有豁免面但太粗**：仅「历史归档目录」+「段级历史关键词」。**未豁免**：
//     · `-dsh\.\d+` 旧规约形态（虽 SEMVER regex 容忍，但 drift 判断不区分）；
//     · `@scope/pkg@version` 宿主包（命中 `@(SEMVER)` 就报）；
//     · 叙述语境（`v18.0.0 起` / `实测装到 18.15.0` / `升至 X.Y.Z`）。
//   本批在 v18.85.0-feat 把这些豁免**显式写进代码**（不靠「今天没命中」）：
const DOCS_13_INSTALL_PIN_EXEMPT_RE = /(?:实测[^。\n]{0,12}?\d+\.\d+|装到[^。\n]{0,12}?\d+\.\d+|升至[^。\n]{0,12}?\d+\.\d+|registry[^。\n]{0,4}?(?:latest|已)|装了[^。\n]{0,8}?\d+\.\d+|差了[^。\n]{0,8}?\d+\.\d+)/;
// ⑬ 叙述语境豁免（v18.85.0-feat 扩）：「当前版本 vX.Y.Z」在描述性语境时**不算声明**——历史注记/对比/旧版引述/条款出处都要豁免
const DOCS_13_CURRENT_VER_EXEMPT_RE = /(?:起|后|以来|开始|的版本|的迭代|的发布|的旧版注记|注记|引述|出处|当时|更正|之前|之后|对应|历史|沿革)/;
// docs/ 段级豁免：标题含 历史/沿革/演进/里程碑/版本历史/升级记录/Changelog → 该段整体跳过
const DOCS_13_HISTORICAL_HEADING = /#{1,6}\s*.*(?:历史|沿革|演进|里程碑|版本历史|升级记录|Changelog)/i;
const docsDir = join(REPO_ROOT, 'docs');
if (existsSync(docsDir)) {
  for (const f of walk(docsDir)) {
    const rel = 'docs/' + relative(docsDir, f).replaceAll('\\', '/');
    if (/^docs\/(审计与修订记录|验证记录)\//.test(rel)) continue;   // 历史归档目录整体豁免（与规则 ⑩b 同一口径）
    // 切段：以 `^#{1,6}` 标题分块；标题含历史关键词 → 该段整段豁免
    const lines = readFileSync(f, 'utf8').split('\n');
    const blocks = [];
    let cur = { isHistorical: false, start: 0, lines: [] };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^#{1,6}\s/.test(l)) {
        if (cur.lines.length) blocks.push(cur);
        cur = { isHistorical: DOCS_13_HISTORICAL_HEADING.test(l), start: i, lines: [l] };
      } else {
        cur.lines.push(l);
      }
    }
    if (cur.lines.length) blocks.push(cur);
    // 形态扫描：仅在非历史段
    for (const b of blocks) {
      if (b.isHistorical) continue;
      b.lines.forEach((l, i) => {
        const lineNo = b.start + i + 1;
        // 安装 pin：要求 `lunheng-article-pipeline@X.Y.Z`（**不**含 dist-tag 形态）
        const pin = l.match(new RegExp('lunheng-article-pipeline@(?!dsh\\b|latest\\b|next\\b|beta\\b|nightly\\b|canary\\b)(' + SEMVER + ')'));
        if (pin) {
          const ver = pin[1];
          // 豁免：-dsh.N 旧规约形态
          if (/-dsh\.\d+$/.test(ver)) return;
          // 豁免：叙述语境（实测装到 / registry 已是 / 差了 / 装了）
          if (DOCS_13_INSTALL_PIN_EXEMPT_RE.test(l)) return;
          // 豁免：宿主包（行内含 `@scope/pkg@version` 形态）
          if (/@[\w./-]+@v?\d/.test(l)) return;
          if (normVer(ver) !== normVer(pkgVer)) {
            errors.push(`[P1 docs 安装 pin 漂移] ${rel}:${lineNo} 写 lunheng-article-pipeline@${ver} ≠ package.json=${pkgVer}`);
          }
          return; // 同一行不再扫「当前版本」（避免同行的 `npm i ...@X.Y.Z` 误报 2 次）
        }
        // 当前版本声明：`当前版本 vX.Y.Z` / `当前版本 **vX.Y.Z**` / 表头 `| 当前版本 | **vX.Y.Z** |`
        const cur = l.match(new RegExp('当前版本\\s*\\*{0,2}v?(' + SEMVER + ')'));
        if (cur) {
          const ver = cur[1];
          // 豁免：叙述起始时点（vX.Y.Z 起 / 后 / 以来 / 开始 / 的版本）
          if (DOCS_13_CURRENT_VER_EXEMPT_RE.test(l)) return;
          // 豁免：宿主包
          if (/@[\w./-]+@v?\d/.test(l)) return;
          if (normVer(ver) !== normVer(pkgVer)) {
            errors.push(`[P1 docs 当前版本声明漂移] ${rel}:${lineNo} 写 ${ver} ≠ package.json=${pkgVer}`);
          }
        }
      });
    }
    // M 门口径同样覆盖 docs（v2.5.2-dsh.16：docs 的计数声明此前不在任何规则覆盖内）
    checkGateCounts(readFileSync(f, 'utf8'), rel);
  }
}

// ⑭ cordis.patch.yml 执行面红线（v2.5.2-dsh.13 新增）：
//    `!!js` 在宿主进程加载期以完整 Node 权限求值，且发生在 agent 沙箱/审批之前 —— 安装即执行。
//    因此补丁内只允许 env / baseUrl / 全局 URL 级取值，禁止模块加载、子进程与任意代码求值。
const redlinePatchPath = join(REPO_ROOT, 'cordis.patch.yml');
// v18.99.0（反哺报告-2026-10-11 §3.2 R3）：黑名单从 ⑭ 的块内**提到模块作用域**——它同时是
//   ⑭（禁）与 ㊴（允许面三方对账）的**唯一真源**；两处各写一份就是下一个漂移源（本批修的正是它）。
const FORBIDDEN = ['getBuiltinModule', 'child_process', 'require(', 'import(', 'eval(', 'new Function', 'node:', 'fs.'];
if (existsSync(redlinePatchPath)) {
  const pt = readFileSync(redlinePatchPath, 'utf8');
  // 只检查**非注释行**（注释里会正当地列出这些被禁标识符作为说明）
  const codeLines = pt.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const bad of FORBIDDEN) {
    if (codeLines.includes(bad)) {
      errors.push(`[P0 patch 执行面红线] cordis.patch.yml 含被禁标识符「${bad}」——!!js 只允许 process.env / baseUrl / 全局 URL 级取值`);
    }
  }
  const jsCount = (pt.match(/!!js/g) || []).length;
  if (jsCount > 0 && !pt.includes('执行面披露')) {
    errors.push(`[P2 执行面披露] cordis.patch.yml 用了 ${jsCount} 处 !!js，但文件头未做「执行面披露」说明`);
  }
}

// ㊴ 执行面允许面三方对账（v18.99.0 · 反哺报告-2026-10-11 **N1/N2** 落地）
//   病灶（报告 §3.1 N1；本批在 v18.98.0 上复跑，原样存在）：
//     `!!js`「能用什么」有三处表述，其中**两处与规则 ⑭ 的实现相反**——
//     · 真源 = 上面的 `FORBIDDEN`（**黑名单**：不在集合内即允许，含 `baseUrl` / `URL` / `process.platform`）；
//     · `cordis.patch.yml` 执行面披露段：「**只允许** `process.env.*`、全局 `Object.assign` 级取值（v18.0.0 起不再需要 `baseUrl`/`URL`）」；
//     · `SECURITY.md` 允许面行：「仅 `process.env.*` 与全局 `Object.assign`」＋「`process.platform` 已不再需要」。
//   两处把**本包当前用到的子集**升格成**全局规则**、比实现窄。后果具体而可指认：
//     ① 维护者会据此把**官方支持**的 `baseUrl` 写法误判为违规（报告 §4.1 的采纳路径正卡在这句上）；
//     ② 官方自带 preset 正在用的 `process.platform` 被描述成过时。
//   根因与 `AGENTS.md`「M 门行」条同型：**局部事实被写成全局断言**。
//   为什么此前是假绿：登记表里**没有一条**把「执行面注释 ↔ SECURITY 允许面行 ↔ ⑭ 的 `FORBIDDEN`」对账
//     ——本规则落地前实跑 exit 0 /「0 处漂移」（报告 §3.1 末段实测，本批复跑一致）。
//   两条判据（方向固定：**文档让位于实现**，不是反过来改 `FORBIDDEN` 去迁就文案）：
//     A1 允许面**不得在文档侧下无指针的排他断言**——披露面中含「允许」且含「只/仅」的行，必须**同一行**带真源指针
//        （`规则 ⑭` 或 `docs-version-rules`）。带指针 = 已把断言交还真源，放行（这正是 R1/R2 的修法）。
//     A2 允许面行内出现 `FORBIDDEN` 标识符时，**必须**同处带否定/排除措辞（未命中/禁止/不得/不含/排除/黑名单）
//        ——防「把被禁项直接写进允许列表」这类反向漂移。
//   边界（如实声明，不许当万能门）：
//     · A1 只认「同一行」这一种载体——若将来允许面被拆成多行散文，本规则会**漏**（届时须同步改判据，不是删规则）；
//     · 本规则只判「文案 ↔ 实现是否同向」，不判「本包该不该用 `baseUrl`」（那是架构决策，不是门的事）。
const ALLOW_FACE_SRC_RE = /规则\s*⑭|docs-version-rules/;
const ALLOW_FACE_NEG_RE = /未命中|禁止|不得|不含|排除|黑名单/;
(function checkAllowFaceThreeWay() {
  const faces = [];
  // 面 ①：`cordis.patch.yml` 的「执行面披露」注释块（自含该词的行起，到第一个非注释行止）
  if (existsSync(redlinePatchPath)) {
    const lines = readFileSync(redlinePatchPath, 'utf8').split('\n');
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!inBlock && l.includes('执行面披露')) inBlock = true;
      if (!inBlock) continue;
      if (!/^\s*#/.test(l)) break;
      faces.push({ src: 'cordis.patch.yml', no: i + 1, line: l });
    }
  }
  // 面 ②：`SECURITY.md` 的执行面表行（只取「允许的表达式内容」/「禁止的表达式内容」两行）
  const secPath = join(REPO_ROOT, 'SECURITY.md');
  if (existsSync(secPath)) {
    readFileSync(secPath, 'utf8').split('\n').forEach((l, i) => {
      if (/^\|\s*(?:允许|禁止)的表达式内容/.test(l)) faces.push({ src: 'SECURITY.md', no: i + 1, line: l });
    });
  }
  for (const { src, no, line } of faces) {
    // 禁止行本就该列被禁标识符——两条判据都不适用（否则规则自己制造假阳性）
    if (line.includes('禁止') || !line.includes('允许')) continue;
    if (/(只|仅)/.test(line) && !ALLOW_FACE_SRC_RE.test(line)) {
      errors.push(
        `[P1 执行面允许面三方对账] ${src}:${no} 对 \`!!js\` 的允许面下了**无真源指针**的排他断言（「只/仅…允许」）——` +
        `允许面的唯一真源是规则 ⑭ 的 \`FORBIDDEN\` 补集，文档只许引用、不许自行收窄（反哺报告 N1）：${line.trim().slice(0, 70)}…`,
      );
    }
    const bad = FORBIDDEN.find((b) => line.includes(b));
    if (bad && !ALLOW_FACE_NEG_RE.test(line)) {
      errors.push(
        `[P1 执行面允许面三方对账] ${src}:${no} 在「允许」语境里出现被禁标识符「${bad}」却无否定/排除措辞——` +
        `被禁项不得出现在允许列表里：${line.trim().slice(0, 70)}…`,
      );
    }
  }
})();

}
