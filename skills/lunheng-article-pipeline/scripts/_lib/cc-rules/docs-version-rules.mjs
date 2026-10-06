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

// ⑬ docs/ 版本点位（v2.5.2-dsh.13 新增）：只查**可执行口径**——
//    ① 安装 pin（`@x.y.z`，含历史 `@x.y.z-dsh.N`）；② 「当前版本」声明行。历史章节（版本历史/演进/里程碑等）整体跳过。
const docsDir = join(REPO_ROOT, 'docs');
if (existsSync(docsDir)) {
  for (const f of walk(docsDir)) {
    const rel = 'docs/' + relative(docsDir, f).replaceAll('\\', '/');
    if (/^docs\/(审计与修订记录|验证记录)\//.test(rel)) continue;   // 历史归档目录整体豁免（与规则 ⑩b 同一口径）
    let inHistory = false;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const h = l.match(/^#{1,4}\s*(.+)/);
      if (h) inHistory = /版本历史|历史|演进|里程碑|升级记录/.test(h[1]);
      if (inHistory) return;
      const pin = l.match(new RegExp('@(' + SEMVER + ')'));
      if (pin && normVer(pin[1]) !== normVer(pkgVer)) {
        errors.push(`[P1 docs 安装 pin 漂移] ${rel}:${i + 1} 写 @${pin[1]} ≠ package.json=${pkgVer}`);
      }
      const cur = l.match(new RegExp('当前版本\\s*\\*{0,2}v?(' + SEMVER + ')'));
      if (cur && normVer(cur[1]) !== normVer(pkgVer)) {
        errors.push(`[P1 docs 当前版本声明漂移] ${rel}:${i + 1} 写 ${cur[1]} ≠ package.json=${pkgVer}`);
      }
    });
    // M 门口径同样覆盖 docs（v2.5.2-dsh.16：docs 的计数声明此前不在任何规则覆盖内）
    checkGateCounts(readFileSync(f, 'utf8'), rel);
  }
}

// ⑭ cordis.patch.yml 执行面红线（v2.5.2-dsh.13 新增）：
//    `!!js` 在宿主进程加载期以完整 Node 权限求值，且发生在 agent 沙箱/审批之前 —— 安装即执行。
//    因此补丁内只允许 env / baseUrl / 全局 URL 级取值，禁止模块加载、子进程与任意代码求值。
const redlinePatchPath = join(REPO_ROOT, 'cordis.patch.yml');
if (existsSync(redlinePatchPath)) {
  const pt = readFileSync(redlinePatchPath, 'utf8');
  const FORBIDDEN = ['getBuiltinModule', 'child_process', 'require(', 'import(', 'eval(', 'new Function', 'node:', 'fs.'];
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

}
