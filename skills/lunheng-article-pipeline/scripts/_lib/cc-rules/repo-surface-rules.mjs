// ⑧ patch+examples 版本引用 / ⑨ .dsh 双写同步 / ㉑ 五语 README 镜像 / ㉒ 锚点存在 / ㉓ 阈值总表 + 门模块目录 / ㉝ 脚本数外泄 / ㉞ .md BOM 检测 / ㉟ 规则登记表自洽
// v18.3.1（审计 B2 阶段 3）：从 consistency-check.mjs 按规则族抽离，行为逐字等价（回归测试的
//   注入验证用例 + 真源仓库自跑兜底）。共享态（errors / 派生源 / 版本真源等）由主脚本构建 ctx 传入。
// v18.78.2（全量审计 A2）：**本模块两条规则此前用了别处已占用的编号**（㉕ 与 `content-rules.mjs` 的
//   「㉕ 命令数口径」撞号、㉖ 与「㉖ 子技能版本一致性」撞号）——而后者才是 `consistency-check.mjs`
//   头清单登记的那两条（本模块这两条**从未进头清单**，正是「清单漏项 → 编号重号」的成因）。
//   现改为 ㉝/㉞，并由新增的 ㉟ 机械保证「登记表 ↔ 模块标签」双向覆盖 + 编号唯一。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join, relative, dirname, basename } from 'node:path'
import { pathKey } from '../destructive-write.mjs'   // v18.12.0（L-53）：镜像自比护栏的路径归一真源
import { RULE_REGISTRY, RULE_MAIN, RULE_COUNTS } from './rule-registry.mjs'   // v18.78.2（A2）：规则登记表 = 主规则清单唯一真源

// ⑧ cordis.patch.yml + examples/ 版本引用（v2.5.2-dsh.5 审计新增：防安装文档指向未发布版本）
export function runRepoSurfaceRules(ctx) {
  const { ROOT, REPO_ROOT, files, active, skillText, gateSrc, GATE_DERIVED, gateModMissing, checkGateCounts, SEMVER, normVer, pkgVer, inlineTagTargets, isArchive, UPSTREAM_SPEC_VERSIONS, walk, errors } = ctx;
const patchPath = join(REPO_ROOT, 'cordis.patch.yml');
if (existsSync(patchPath)) {
  const pt = readFileSync(patchPath, 'utf8');
  const pm = pt.match(new RegExp('(v?' + SEMVER + ')'));
  if (pm && normVer(pm[1]) !== normVer(pkgVer)) {
    errors.push(`[P0 版本引用] cordis.patch.yml 头写 ${pm[1]} ≠ package.json=${pkgVer}`);
  }
}
// examples/ 只查**安装 pin**（`@x.y.z`，含历史 `@x.y.z-dsh.N`）——版本注解行（「… 起」「更正」「修订」「历史」等）豁免，
// 因为注解天然会提到相邻版本（v2.5.2-dsh.13 起）
const exDir = join(REPO_ROOT, 'examples');
if (existsSync(exDir)) {
  for (const f of walk(exDir)) {
    const rel = 'examples/' + relative(exDir, f).replaceAll('\\', '/');
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/起|之前|新增|修订|教训|历史|更正|及以后/.test(l)) return;
      const pin = l.match(new RegExp('@(v?' + SEMVER + ')'));
      if (pin && normVer(pin[1]) !== normVer(pkgVer)) {
        errors.push(`[P0 版本引用] ${rel}:${i + 1} 安装 pin 写 @${pin[1]} ≠ package.json=${pkgVer}`);
      }
    });
  }
}

// ⑨ .dsh 双写同步 + 污染校验（v2.5.2-dsh.5 审计新增：仅当兄弟 .dsh 技能目录存在时生效，CI 无此目录自动跳过）
// v18.2.3 修订（主人授权；依据「版本抬升 18.2.2 → 18.2.3」后的实测复核）：
//   旧实现有**两处盲区**——① 只核 **4 个文件**（SKILL.md / m-gate-check / count-chars / M-Gate-Algorithm），
//   其余 80 个文件从未被核；② 比对**只比字节大小**（`statSync().size`）。
//   ⚠️ 而**版本头替换天生是等长的**（`v18.2.2` → `v18.2.3` 同长度）→ size 完全不变 → **看不见**。
//   实测后果：镜像里 **44 个文件**内容与真源不同（连 `SKILL.md` 的版本头都还是 v18.2.2），
//   本门却输出「0 处漂移」= **假绿**——而镜像正是**运行时真正被加载**的那一份，
//   于是「版本自检」会拿旧版本放行。**门比被它守的东西更不可靠**。
//   现改为：**全树逐文件内容比对**（Buffer.equals，不用 size 作代理），并补「镜像多出文件」检查。
//   代价：84 个小文件各读两次（合计 <1 MB），运行时开销可忽略。
const dshSkillDir = join(REPO_ROOT, '..', '.dsh', 'skills', 'lunheng-article-pipeline');
// v18.12.0（全量审计 L-53）：**镜像自比护栏**。在部署镜像内运行时，旧版 `REPO_ROOT` 会解析成
//   `…/.dsh`，于是 `dshSkillDir` 与 `ROOT` **是同一个目录** → 下面整段「真源 ↔ 镜像」对账变成
//   「自己跟自己比」→ **恒真、永远 0 处漂移**（假绿），而镜像恰恰是运行时真正被加载的那一份。
//   `REPO_ROOT` 侧已收紧（须含 skills/lunheng-article-pipeline/SKILL.md），此处再加一道独立护栏：
//   两者同目录即报 P0，不依赖上游修得对不对。
if (existsSync(dshSkillDir) && pathKey(dshSkillDir) === pathKey(ROOT)) {
  errors.push(
    '[P0 镜像自比] 真源 ROOT 与 `.dsh` 镜像指向同一目录 —— 规则⑨「真源 ↔ 镜像」对账退化为自比（恒真/假绿）。'
    + '请到**真源仓库**（含 `skills/lunheng-article-pipeline/SKILL.md`）运行本门；镜像内运行无对账价值。',
  );
}
const allFilesOf = (dir, base = dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) allFilesOf(p, base, acc);
    else if (e.isFile()) acc.push(String(p).slice(base.length + 1).replaceAll('\\', '/'));
  }
  return acc;
};
if (existsSync(dshSkillDir)) {
  const repoFiles = allFilesOf(ROOT).slice().sort();
  for (const kf of repoFiles) {
    const repoF = join(ROOT, kf), dshF = join(dshSkillDir, kf);
    if (!existsSync(dshF)) {
      errors.push(`[P1 .dsh 同步] 镜像缺文件 ${kf}（真源有、镜像无 → 运行时少这一份）`);
    } else if (!readFileSync(repoF).equals(readFileSync(dshF))) {
      errors.push(`[P1 .dsh 同步] ${kf} 内容漂移 repo=${statSync(repoF).size}B .dsh=${statSync(dshF).size}B（v18.2.3 起按内容比对：size 相同亦照报）`);
    }
  }
  for (const kf of allFilesOf(dshSkillDir).slice().sort()) {
    if (!repoFiles.includes(kf)) {
      errors.push(`[P1 .dsh 同步] 镜像多出文件 ${kf}（真源无 → 残留或误加）`);
    }
  }
  for (const poll of ['package.json', 'cordis.patch.yml', 'docs', 'examples', '.git']) {
    if (existsSync(join(dshSkillDir, poll))) {
      errors.push(`[P1 .dsh 污染] 技能目录含仓库级条目 ${poll}（应只含技能包本体）`);
    }
  }
}

// ㉑ 五语 README 结构镜像（v18.0.5 新增，第三方审计 P2-7）
//   背景：官方 `readme-consistency` 只比对 `##` 标题字符串——反事实实测：整份 es 换成英文副本仍 PASS；
//   删整节正文、把「11 scripts」改成 99、把版本改成 v9.9.9 也全 PASS。实测过的真实后果是
//   es/pt/hi 三份**掉了语言切换器**、`### Documentation` 的 9 行表被压成一行散文（表行 33 vs 44）。
//   本规则把「结构镜像」的**可机械判定部分**纳入：
//     ① 五份都必须含 `🌐` 语言切换器行；
//     ② 五份的**表格行数**必须相等（官方 i18n 文档：结构须镜像——表行列数 / 列表项数）；
//     ③ 五份的 `##` 标题数必须相等（官方门已覆盖字符串层面，这里再钉数量，防「删掉一节还 PASS」）。
//   边界（如实）：无法判定**译文语义**是否与中文版一致（那需要人读或 LLM 复核），故只钉结构。
const fiveLangs = ['README.md', 'README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md'];
const langStats = [];
for (const f of fiveLangs) {
  const p = join(REPO_ROOT, f);
  if (!existsSync(p)) { errors.push(`[P1 五语 README] 缺 ${f}`); continue; }
  const t = readFileSync(p, 'utf8');
  const lines = t.split('\n');
  langStats.push({
    f,
    switcher: /🌐/.test(t),
    rows: lines.filter((l) => l.startsWith('|')).length,
    h2: lines.filter((l) => /^## /.test(l)).length,
  });
}
if (langStats.length > 1) {
  for (const s of langStats) {
    if (!s.switcher) errors.push(`[P1 五语 README] ${s.f} 缺语言切换器行（\`> 🌐 …\`）——非中文用户找不到其它语言版本`);
  }
  const rowSet = new Set(langStats.map((s) => s.rows));
  if (rowSet.size > 1) {
    errors.push(
      `[P1 五语 README] 表格行数不一致：${langStats.map((s) => `${s.f}=${s.rows}`).join(' / ')}` +
        '——官方 i18n 规范要求结构镜像（表行列数一致），行数差异说明某语言漏了整张表',
    );
  }
  const h2Set = new Set(langStats.map((s) => s.h2));
  if (h2Set.size > 1) {
    errors.push(`[P1 五语 README] \`##\` 标题数不一致：${langStats.map((s) => `${s.f}=${s.h2}`).join(' / ')}——某语言可能整节缺失`);
  }
}

// ㉒ 按需查节锚点存在性（v18.2.6 审计修复 · 追加 B）
//   教训：SKILL.md 启动清单要求「只需三节 / 按需查节 / 不必逐张通读」，但定位手段是**手写中文标题**
//     （如 `M-Gate-Algorithm.md` 里的 `#1-m-gate-report-v224-输出格式4-版本合并最终版`）
//     → 模型实际只能 grep 或整读，「按需查节」缺**机械可定位性**；且中文锚点随标题一改即失效、无人知晓。
//   现规则：被点名章节的标题前加**稳定英文锚点** `<a id="…"></a>`，本规则断言其真实存在。
//     **断言目标从 SKILL.md §启动清单 现场派生**——清单改了断言自动跟着改，不另写硬编码清单。
//   写法取舍（为什么用 `<a id="…"></a>` 独立成行，而不是 GitHub 自动锚点）：
//     ① 英文 slug 与标题文字**解耦**——改标题（含加版本注记）不会让锚点失效；
//     ② 独立成行时任何渲染器都不显示，且**不进标题文本**，故不影响任何「标题级」断言（如 M 门节头项数、五语 README 标题数）；
//     ③ 比 HTML 注释更直接：注释不会产生锚点，`<a id>` 才是真正可跳转/可 grep 的定位点。
//   负向用例（自测用，勿留在仓里）：删掉 pipeline-readme.md 的 `<a id="overview"></a>`
//     → 本规则应报 `[P1 锚点缺失]` 并使脚本 exit 1。
{
  const lines = skillText.split('\n');
  const start = lines.findIndex((l) => /^##\s*启动清单/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (start < 0 || end < 0) {
    errors.push('[P0 锚点断言失效] SKILL.md 未找到 §启动清单 区块——规则 ㉒ 失效即静默放行，真源结构改了请同步本规则');
  } else {
    const resolve = (relPath) => [join(ROOT, relPath), join(ROOT, 'references', relPath)].find((p) => existsSync(p));
    let checked = 0;
    for (const l of lines.slice(start, end)) {
      const mdFiles = [...new Set([...l.matchAll(/[A-Za-z0-9_\-./]+\.md/g)].map((m) => m[0]))];
      const targets = [...l.matchAll(/([A-Za-z0-9_\-./]+\.md)#([a-z][a-z0-9-]*)/g)].map((m) => [m[1], m[2]]);
      // 简写 `#anchor`：仅当该行只引用**一个** .md 文件时才能归属（多文件行必须写全 file.md#anchor）
      for (const m of l.matchAll(/`#([a-z][a-z0-9-]*)`/g)) {
        if (mdFiles.length === 1) targets.push([mdFiles[0], m[1]]);
        else errors.push(`[P1 锚点写法歧义] SKILL.md 启动清单用简写 \`#${m[1]}\`，但该行引用了 ${mdFiles.length} 个 .md ——请写全「file.md#anchor」`);
      }
      for (const [relPath, anchor] of targets) {
        const p = resolve(relPath);
        if (!p) { errors.push(`[P1 锚点目标缺失] SKILL.md 启动清单指向 ${relPath}，该文件不存在`); continue; }
        checked++;
        if (!readFileSync(p, 'utf8').includes(`<a id="${anchor}"></a>`)) {
          errors.push(
            `[P1 锚点缺失] ${relPath} 缺锚点 <a id="${anchor}"></a>（SKILL.md 启动清单指向它）` +
              '——「按需查节」将退化为 grep / 整读',
          );
        }
      }
    }
    if (checked === 0) {
      errors.push('[P0 锚点断言失效] SKILL.md 启动清单里没有任何 `文件.md#锚点` 引用——规则形同虚设，请恢复锚点引用');
    }
  }
}

// ㉓ 阈值总表自洽（v18.3.1 审计 B3）：THRESHOLDS 是唯一真源；M-Gate-Algorithm.md 的「阈值总表」必须与其
//   逐键逐值一致（由 `node scripts/m-gate-check.mjs --dump-thresholds` 单向生成、勿手改）。旧版阈值数字散落在
//   正文伪代码里，与脚本双维护、必漂。这里**结构派生**：从 m-gate-check.mjs 源码解析 THRESHOLDS（与 ⑩c 的
//   GATE_DERIVED 同法），再与文档总表逐行比对——改 THRESHOLDS 而不重新生成总表 → 本规则报 P1。
{
  const TH = (() => {
    const m = gateSrc.match(/const THRESHOLDS = Object\.freeze\(\{([\s\S]*?)\n\}\)/);
    return m ? [...m[1].matchAll(/(\w+):\s*([0-9.]+),/g)].map((x) => [x[1], x[2]]) : null;
  })();
  const gaPath = join(ROOT, 'references', '_shared', 'M-Gate-Algorithm.md');
  const gaText = readFileSync(gaPath, 'utf8');
  const block = gaText.match(/<!-- THRESHOLDS-AUTO-START[^]*?<!-- THRESHOLDS-AUTO-END -->/);
  if (!TH) {
    errors.push('[P0 阈值总表] 无法从 m-gate-check.mjs 解析 THRESHOLDS——规则失效即静默放行，请检查 Object.freeze 结构');
  } else if (!block) {
    errors.push('[P1 阈值总表] M-Gate-Algorithm.md 缺 THRESHOLDS-AUTO 生成块（用 `node scripts/m-gate-check.mjs --dump-thresholds` 重新生成）');
  } else {
    const rows = [...block[0].matchAll(/^\|\s*`(\w+)`\s*\|\s*([0-9.]+)\s*\|/gm)].map((x) => [x[1], x[2]]);
    if (rows.length !== TH.length) {
      errors.push(`[P1 阈值总表] 键数不一致：脚本 ${TH.length} 项 vs 文档 ${rows.length} 项——改 THRESHOLDS 后须用 --dump-thresholds 重新生成总表`);
    } else {
      for (let i = 0; i < TH.length; i++) {
        if (rows[i][0] !== TH[i][0] || rows[i][1] !== TH[i][1]) {
          errors.push(`[P1 阈值总表] 第 ${i + 1} 项漂移：脚本 ${TH[i][0]}=${TH[i][1]} vs 文档 ${rows[i][0]}=${rows[i][1]}——改 THRESHOLDS 后须用 --dump-thresholds 重新生成总表`);
        }
      }
    }
  }
}

// v18.3.1（审计 B2 阶段 1）配套：门模块目录存在性——缺目录说明拆分被回退/误删，
//   GATE_DERIVED 将数错门数（errors 定义在 gateSrc 之后，故检测延迟到这里报）。
if (gateModMissing) {
  errors.push('[P0 派生源失效] scripts/_lib/mgate-gates/ 门模块目录不存在——B2 阶段 1 拆分被回退或目录被误删，M 门项数派生将失真，请恢复');
}

// ㉝ 脚本数次级数字外泄扫描（v18.9.0 实战反哺补丁 / 2026-09-23）
//   **v18.78.2（全量审计 A2）：编号由 ㉕ 改为 ㉝**——原编号与 `content-rules.mjs` 的「㉕ 命令数口径」撞号，
//   而后者才是 `consistency-check.mjs` 头清单登记的那一条（本规则从未进头清单 = 「清单漏项」的同族）。
//   背景：v18.8.x 实战改 SKILL.md 白名单「15 → 16」时，consistency-check 只查 SKILL.md 那一行
//   （白名单字段），**SECURITY.md / DSH-集成方案.md / AGENTS.md / docs/审计与修订记录/* 等次级文档里
//   散落的脚本数字不查**——如 SECURITY.md line 29「15 个 .mjs」、DSH-集成方案.md line 4「15 个门禁脚本」、
//   AGENTS.md line 551/575/619 等「15 个真实项目」/ CHANGELOG.md line 551「handoff-check.mjs 第 15 个」。
//   本规则把白名单数字 = 真源数，**与外泄到次级文档的硬编码数一并对账**。
//   实现：抓 SKILL.md「随包脚本白名单」行（单行字面提取脚本清单）作真源集合 + 数字，
//   再扫 SKILL.md 全文 / SECURITY.md / AGENTS.md / references/_shared/*.md / docs/审计与修订记录/*.md
//   所有含 `\d+ 个 (?:脚本|\.mjs|门禁脚本|真实项目|随包脚本)` 等的字面数字，**必须 = 真源数字**。
//   边界：含「数量真源 = ...」的指针行（SKILL.md 白名单字段本身）豁免；注解行（… 起 / 更正 / 修订 / 历史 等）豁免，
//   防止「历史版本提到旧数字」误报。
{
  // 1) 真源：从 SKILL.md 抓「随包脚本白名单」行的脚本清单与数字
  const skillPath = join(REPO_ROOT, 'SKILL.md');
  const skillContent = skillText || readFileSync(skillPath, 'utf8');
  const wlLine = skillContent.split('\n').find((l) => /随包脚本白名单/.test(l));
  if (!wlLine) {
    errors.push('[P0 白名单失效] SKILL.md 未找到「随包脚本白名单」行 — 规则 ㉝ 失效即静默放行');
  } else {
    // 数字：行内第一个 N 个
    const numMatch = wlLine.match(/(\d+)\s*个/);
    const truthNum = numMatch ? Number(numMatch[1]) : null;
    // 脚本清单：从「`scripts/*.mjs` = 」开始到「+ 有限验证」之前的所有 `name` 单词
    const eqIdx = wlLine.indexOf(' = ');
    const head = eqIdx >= 0 ? wlLine.slice(eqIdx + 3) : '';
    const tailIdx = head.indexOf(' + ');
    const scriptSeg = tailIdx >= 0 ? head.slice(0, tailIdx) : head;
    const truthSet = new Set([...scriptSeg.matchAll(/([A-Za-z][A-Za-z0-9_-]*)\s*\//g)].map((m) => m[1].replace(/\/$/, '')).filter(Boolean));
    if (!truthNum || truthSet.size === 0) {
      errors.push('[P0 白名单失效] SKILL.md 白名单行未抓到数字或脚本清单 — 规则 ㉝ 失效');
    } else {
      // 2) 扫描次级文档：SKILL.md 全文（豁免白名单行）/ SECURITY.md / AGENTS.md / references/_shared/*.md / docs/审计与修订记录/*.md
      // docs/ 下临时扫描令牌豁免历史审计报告目录（一次性快照，按当时版本数字写定）——
      //   docs/审计与修订记录/* = v18.2.x / v18.3.x 全量审计报告副本（一次性历史快照）
      //   docs/token-optimization-plan.md = v18.2.5 token 优化方案（一次性历史快照）
      //   docs/CHANGELOG.md 历史条目亦豁免（CHANGELOG 行内 reAnno 已覆盖）
      //   ——只对 docs/顶层新增的**当前生效**文档做扫描（如 docs/install.md / docs/usage.md 等）
      const HIST_DOC_BLACKLIST = /token-optimization-plan\.md$|docs[\/\\]审计与修订记录[\/\\]|audits[\/\\]反哺报告-/;
      const wlIdx = skillContent.split('\n').indexOf(wlLine);
      const scanRoots = [
        { path: skillPath, skipLineIdx: wlIdx },
        { path: join(REPO_ROOT, 'SECURITY.md'), skipLineIdx: -1 },
        { path: join(REPO_ROOT, 'AGENTS.md'), skipLineIdx: -1 },
        { path: join(REPO_ROOT, 'references', '_shared'), skipLineIdx: -1, isDir: true },
        { path: join(REPO_ROOT, 'docs'), skipLineIdx: -1, isDir: true },
      ];
      const reDigit = /(\d+)\s*个(?:\s*脚本|\s*\.mjs|\s*门禁脚本|\s*真实项目|\s*随包脚本)/g;
      const reAnno = /起|之前|新增|修订|教训|历史|更正|及以后|变化数|命中|无新|判定|实测|评测|反例|含角色|含.*不剥离/;
      for (const r of scanRoots) {
        if (!existsSync(r.path)) continue;
        const files = r.isDir ? walk(r.path).filter((f) => f.endsWith('.md')) : [r.path];
        for (const f of files) {
          // 历史快照豁免（docs/token-optimization-plan.md + docs/审计与修订记录/*）
          const relForHistCheck = f.replaceAll('\\', '/');
          if (HIST_DOC_BLACKLIST.test(relForHistCheck)) continue;
          const lines = readFileSync(f, 'utf8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i === r.skipLineIdx) continue;  // 豁免 SKILL.md 白名单行本身
            const l = lines[i];
            if (reAnno.test(l)) continue;       // 豁免注解行
            const matches = [...l.matchAll(reDigit)];
            for (const m of matches) {
              const num = Number(m[1]);
              if (num !== truthNum) {
                errors.push(`[P1 脚本数外泄] ${f.replaceAll('\\', '/').replace(REPO_ROOT + '/', '')}:${i + 1} 含 ${m[0]} ≠ 白名单真源 ${truthNum} — 次级文档硬编码脚本数必须与 SKILL.md 白名单同步`);
              }
            }
          }
        }
      }
    }
  }
}

// ㉞ 全仓库 .md BOM 检测（v18.9.0 反哺 / 审计 B+1 增补 / 教训 #2026-09-24）
//   **v18.78.2（全量审计 A2）：编号由 ㉖ 改为 ㉞**——原编号与 `content-rules.mjs` 的「㉖ 子技能版本一致性」撞号。
//   · 背景：`edit` 工具在含 UTF-8 BOM（EF BB BF）的 .md 文件上做行 1 字符串替换时，
//     会静默注入 `\ufeff` 到新行首；v18.9.0 apply 时波及 95 个文件（仓库 50 + 镜像 45）。
//   · 教训：纯靠人眼 `read` 看不到 BOM（首字节被 read 工具吞掉），必须字节级扫描；
//     一致性门静默漏检 = 真实的 silent failure。
//   · 规则：扫描仓库根 + 镜像（`.dsh/skills/<name>`）中所有 .md 文件，
//     发现首 3 字节 = EF BB BF 即报 P1（BOM 本身不破坏 UTF-8 解析，但会引起
//     「首行内容匹配」类机检假阴性——如规则⑫ 的 `> 版本：` 首行匹配）。
//   · 豁免：仓库根 `.git` / `node_modules` / `_backup` 下的所有文件不扫。
// v18.62.4（全量审计-v18.62.3 §8.3 #33）：**镜像路径必须复用 ⑨ 那一份**（`dshSkillDir`）。
//   病灶：本处旧版**自己另写了一条路径** `join(REPO_ROOT, '.dsh', 'skills', …)` —— 而 ⑨（`:45`）用的是
//   `join(REPO_ROOT, '..', '.dsh', 'skills', …)`。**两条口径指向不同目录**：
//     本机实测 `<仓库根>/.dsh/...` → 指向**仓库内的** .dsh（**不存在**）
//     而 ⑨ 的 `<仓库根>/../.dsh/...` → 指向**工作区级**的 .dsh（**存在，就是真镜像**）
//   → 于是**规则 ㉞ 的镜像半在这一布局下被 `continue` 静默跳过**：仓库侧 BOM 扫得到、镜像侧从不扫。
//   而按本规则自己的背景（`:286`），v18.9.0 那次 BOM 事故**波及 95 个文件 = 仓库 50 + 镜像 45**
//   —— **镜像恰是重灾区**，却正是被静默跳过的半边。这与「门比被它守的东西更不可靠」是同一种病。
//   修法：**不再另写路径**，复用 ⑨ 已带自比护栏的 `dshSkillDir`（单一真源）。
for (const baseDir of [REPO_ROOT, dshSkillDir]) {
  if (!existsSync(baseDir)) continue;
  const stack = [baseDir];
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try { ents = readdirSync(cur); } catch { continue; }
    for (const e of ents) {
      const p = join(cur, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        // 豁免目录
        if (/\.git$|node_modules|_backup/.test(p)) continue;
        stack.push(p);
      } else if (st.isFile() && p.endsWith('.md')) {
        const fd = openSync(p, 'r');
        try {
          const buf = Buffer.alloc(3);
          const n = readSync(fd, buf, 0, 3, 0);
          if (n === 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
            const rel = relative(REPO_ROOT, p).replaceAll('\\', '/');
            errors.push(`[P1 BOM 污染] ${rel} 首 3 字节为 UTF-8 BOM（EF BB BF）——edit 工具静默注入残留，须二进制剔除前 3 字节`);
          }
        } finally { closeSync(fd); }
      }
    }
  }
}

// ㊲ 速查卡硬数字派生（v18.80.0 · 全量审计-v18.79.1 **P3-9**）
//   病灶：`docs/quick-facts.md` 自称「新人第一眼硬数字的**单一真源**」「改这里 = 改主文档真源」，
//   但只有三条派生门（规则数 ㉟ / 命令数 ㉕ / M 门项数 ⑥b），其余硬数字全是**手写无门**。本批实测后果：
//   本卡**标题**与「当前版本」行停在 v18.78.1 而真源已 v18.80.0——**连漏两版无人发现**，因为标题那处
//   **不在 bump 脚本的替换面内**（该脚本只认「当前版本 **vX.Y.Z**」与「@X.Y.Z」两种字面形态）。
//   本条把「有唯一可派生真源」的三项钉住：版本（↔ `package.json#version`）/ 角色数（↔ `references/agents/`
//   的 01–09 编号卡个数）/ 随包脚本数（↔ `scripts/*.mjs` 顶层实测个数）。**为什么只这三项**：其余各项
//   （Phase 数 / G 清单 / 退出码族）的真源是散文或表格，派生不出机检值——本卡头注释自己也承认这一边界。
//   ⚠️ 实现陷阱（本批首版即踩，两条都留档）：① 注释里的**内层枚举**若写成行首 `// ① …`，会被本规则族
//   自己的 ㉟ 当成**规则级标签**而报「① 重号」——内层枚举必须写成 `// · ① …`；② 角色卡正则若用
//   `/^0(\d)-/`，`00-主控-coordinator.md` 与 `00-主控-扩展职责.md` 会各贡献编号，**去重后仍多算 1**
//   （实测派生值 10 ≠ 卡上 9），故必须用 `/^0([1-9])-/` 只认 01–09。实装见下方「（五）quick-facts」段之后。
//
// ㉟ 一致性规则登记表自洽（v18.78.2 · 全量审计-v18.78.1 **A2**）
//   为什么立它：A2 的注入实证——把 `glossary.md` 的「31 类主规则」改成「99 类主规则」，本脚本仍 **exit 0**；
//     而「规则数」这一事实在 v18.2.6 / v18.18.0 / v18.22.1 / v18.78.0 **四次**被审计抓到不一致（加规则忘改数字）。
//   修法：主规则清单的**唯一真源 = `_lib/cc-rules/rule-registry.mjs`（登记表）**，计数由其派生；
//     文档（脚本头注释 / glossary / quick-facts）**只许指向它、不再写数字**——不写就不会漂。
//   本规则把两件事机械化：
//     ① **编号唯一**：同一编号不得被两个模块占用（v18.78.2 实测 ㉕/㉖ 各被两个模块占用 → 已改 ㉝/㉞）；
//     ② **双向覆盖**：登记表每个 id 必须在其 `module` 声明的模块里有**规则级标签**；
//        模块里出现的规则级标签（无字母后缀）必须都在登记表里 ——「加了规则忘登记」「标签被删」即报。
//   判据（规则级标签的形态，**刻意收窄**）：注释行以 `// ` 起（允许行首缩进）后**紧跟**编号
//     （或 `// ── ` 装饰后紧跟编号），编号后是空白或 `：`。**内层枚举**（`//   ① …`，即 `// ` 后还有空格）
//     **不算**规则级标签——实测这正是本仓的写法分野，故不必靠「语义」区分（也就不会因为内层枚举误报）。
//   边界（如实声明）：
//     · 只认**无字母后缀**的编号；子规则（②a/③b/④b/⑥b/⑥c/⑩b/⑩c/⑩d…）刻意不登记（理由见登记表头注释）。
//     · 跳过每个模块的**第 1 行**（模块头注释按惯例罗列多个编号，不是规则级标签）。
//     · 本检查**不判断规则是否真的在跑**——那由各规则自己与 A6 的真源存在性负责。
{
  const modDir = join(ROOT, 'scripts', '_lib', 'cc-rules')
  const mainScript = join(ROOT, 'scripts', 'consistency-check.mjs')
  const LABEL_RE = /^\s*\/\/ (?:── )?([①-⑳㉑-㉟㊱-㊿])([a-z]?)[\s：]/
  // 扫描面 = 主脚本 + 全部规则族模块（①-⑦/㉔ 的实装在主脚本里，只扫 `_lib/cc-rules/` 会漏掉它们——
  //   首版即踩此坑，由 ㉟ 自己的「登记表失真」报错当场抓出：8 条规则被误判为「模块里找不到标签」）。
  const scanList = [
    ...(existsSync(mainScript) ? [mainScript] : []),
    ...(existsSync(modDir) ? readdirSync(modDir).filter((x) => x.endsWith('.mjs')).map((f) => join(modDir, f)) : []),
  ]
  if (!existsSync(modDir) || !existsSync(mainScript)) {
    errors.push('[P0 规则失效] ㉟ 的真源（scripts/consistency-check.mjs 与 scripts/_lib/cc-rules/）不完整——登记表自洽检查无法运行，**不得读成通过**')
  } else {
    const found = new Map()   // id → Set<模块文件名>
    for (const p of scanList) {
      const f = basename(p)
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (i === 0) return                      // 模块头注释：按惯例罗列多个编号
        const m = l.match(LABEL_RE)
        if (!m || m[2]) return                   // 带字母后缀 = 子规则，刻意不进登记表
        if (!found.has(m[1])) found.set(m[1], new Set())
        found.get(m[1]).add(f)
      })
    }
    const registered = new Set(RULE_MAIN)
    const dup = [...found].filter(([, mods]) => mods.size > 1).map(([id, mods]) => `${id}（${[...mods].join(' / ')}）`)
    if (dup.length) {
      errors.push(`[P1 规则编号重号] ${dup.join('、')}——同一编号被多个模块占用；编号是文档与脚本互指的锚点，重号即失去唯一所指。**两种成因**：① 真重号（改编号并同步登记表）；② **内层枚举**被写成了规则级标签形态（「// 编号空格」起头）——内层枚举请改用「// · 编号空格」或「// 三空格编号空格」（登记表 = scripts/_lib/cc-rules/rule-registry.mjs）`)
    }
    const noLabel = RULE_REGISTRY.filter((r) => !(found.get(r.id) || new Set()).has(r.module)).map((r) => `${r.id}→${r.module}`)
    if (noLabel.length) {
      errors.push(`[P1 登记表失真] ${noLabel.join('、')}——登记表声明该规则实装在此模块，但模块内找不到它的**规则级标签**（形如 \`// <编号> …\`）。修法二选一：补标签，或改登记表的 \`module\``)
    }
    const unregistered = [...found.keys()].filter((id) => !registered.has(id))
    if (unregistered.length) {
      errors.push(`[P1 规则未登记] ${unregistered.join('、')}——模块里有规则级标签却不在登记表里（「加规则忘登记」正是四次计数漂移的成因）。修法：在 scripts/_lib/cc-rules/rule-registry.mjs 补一行（id / module / what）`)
    }
    if (!dup.length && !noLabel.length && !unregistered.length && found.size !== RULE_COUNTS.main) {
      errors.push(`[P1 规则计数派生不一致] 登记表主规则 ${RULE_COUNTS.main} 条，而模块里实测到 ${found.size} 个规则级标签——两者必须相等（登记表内重复登记 id 也会触发本条）`)
    }
    // （五）`docs/quick-facts.md` 的「N 类主规则」= **唯一受门约束的手写副本**（其余文档只许指向登记表）。
    //   为什么留这一个副本：该卡的全仓定位就是「把所有硬数字集中到一处」（用户文档只引本卡），
    //   故对它采用「写数字 + 有门」而非「不写数字」；A2 的注入实证正是改这个数字而门不报。
    //   ⚠️ 本行注释刻意**不写成 `// ⑤ …`**——那正是规则级标签形态，会被 ㉟ 自己当成「⑤ 重号」报出
    //   （首版即踩：㉟ 首次运行就报了 `⑤（consistency-check.mjs / repo-surface-rules.mjs）`）。
    const qfPath = join(REPO_ROOT, 'docs', 'quick-facts.md')
    if (existsSync(qfPath)) {
      const qfText = readFileSync(qfPath, 'utf8')
      const m = qfText.match(/(\d+)\s*类主规则/)
      if (m && Number(m[1]) !== RULE_COUNTS.main) {
        errors.push(`[P1 规则数口径漂移] docs/quick-facts.md 写「${m[1]} 类主规则」，登记表派生值 = ${RULE_COUNTS.main}`)
      } else if (!m) {
        errors.push('[P2 规则数口径] docs/quick-facts.md 未见「N 类主规则」——该卡是全仓硬数字汇总点，规则数请写「N 类主规则（真源 = rule-registry.mjs）」')
      }
      // ══ v18.80.0（全量审计-v18.79.1 P3-9）：速查卡**其余硬数字**也必须有门 ══════════════════════
      //   病灶（本批实测）：本卡自称「新人第一眼硬数字的**单一真源**」「改这里 = 改主文档真源」，
      //   但**只有规则数 / 命令数 / M 门项数**三条派生门（分别是 ㉟ / ㉕ / ⑥b），其余全是手写：
      //     · 标题与「当前版本」行停在 **v18.78.1**，而 bump 后真源已是 v18.80.0（**两版未跟**）；
      //     · 「角色数 9」「随包脚本 31」无门——改一处漏一处不会有任何信号。
      //   本条把这三项钉到真源（判据全用**派生**，不写字面量）：
      //     · ① 版本：本卡标题的 `（vX.Y.Z）` 与「当前版本」行的值 == `package.json#version`；
      //     · ② 角色数：`references/agents/` 下 `0N-*.md`（N=1..9）的**不同编号个数** —— 与卡上的「N 个独立角色」比；
      //     · ③ 随包脚本数：`scripts/*.mjs` 顶层实测个数 —— 与卡上的「N 个」比。
      //   为什么选这三项而不是全卡：其余各项（Phase 数 / G 清单 / 退出码族）的真源是**散文或表格**，
      //   派生不出机检值；本卡自己的头注释也承认「consistency-check 不一定全机覆盖，主控人工复核」。
      //   本条只吃「有唯一可派生真源」的那几项——够把最贵的漂移面（版本）关掉。
      const pkgVerForCard = pkgVer
      // · ① 标题 + 「当前版本」行
      const titleVer = qfText.match(/^#\s*论衡速查卡（v(\d+\.\d+\.\d+)）/m)?.[1]
      if (!titleVer) {
        errors.push('[P2 速查卡版本口径] docs/quick-facts.md 标题未见 `# 论衡速查卡（vX.Y.Z）` 形态——本卡是硬数字汇总点，标题须自述版本且受门约束')
      } else if (titleVer !== pkgVerForCard) {
        errors.push(`[P1 速查卡版本漂移] docs/quick-facts.md **标题**写 v${titleVer}，package.json = ${pkgVerForCard}——标题那处**不在 bump 脚本的替换面内**，历来靠人工，实测漏过两版`)
      }
      const curVerRow = qfText.match(/\|\s*当前版本\s*\|\s*\*\*v(\d+\.\d+\.\d+)\*\*/)
      if (curVerRow && curVerRow[1] !== pkgVerForCard) {
        errors.push(`[P1 速查卡版本漂移] docs/quick-facts.md「当前版本」行写 v${curVerRow[1]}，package.json = ${pkgVerForCard}`)
      }
      // · ② 角色数（派生 = agents/ 下 0N-*.md 的不同编号个数）
      const agentsDir = join(ROOT, 'references', 'agents')
      if (existsSync(agentsDir)) {
        const nums = new Set()
        for (const f of readdirSync(agentsDir)) {
          const mm = /^0([1-9])-/.exec(f)
          if (mm) nums.add(Number(mm[1]))
        }
        const roles = nums.size
        const cardRoles = qfText.match(/(\d+)\s*个独立角色/)
        if (cardRoles && Number(cardRoles[1]) !== roles) {
          errors.push(`[P1 速查卡角色数漂移] docs/quick-facts.md 写「${cardRoles[1]} 个独立角色」，而 references/agents/ 下实测 01–09 共 ${roles} 张编号卡（派生值 = ${roles}）`)
        }
      }
      // · ③ 随包脚本数（派生 = scripts/*.mjs 顶层个数）
      const scriptsDir = join(ROOT, 'scripts')
      if (existsSync(scriptsDir)) {
        const nScripts = readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs')).length
        const cardScripts = qfText.match(/\*\*(\d+)\s*个\*\*（`_lib\/` 子目录为共享库非入口/)
        if (cardScripts && Number(cardScripts[1]) !== nScripts) {
          errors.push(`[P1 速查卡脚本数漂移] docs/quick-facts.md 写随包脚本「${cardScripts[1]} 个」，而 scripts/*.mjs 顶层实测 ${nScripts} 个`)
        }
      }
      // · ④ 词预算登记条数（v18.80.0 补）：卡上写「**N 条**」，真源 = 仓库根 `DOC_BUDGET` 的键数。
      //   为什么值得加：该卡这一行的用途正是让新人知道「有多少文档在被棘轮管着」；条数变了而卡不跟，
      //   就会重演本批实测到的「版本连漏两版」那类漂移。读真源的方式与 r09 同法（从门源码里数键）。
      const rhPath = join(REPO_ROOT, 'scripts', 'repo-hygiene-check.mjs')
      if (existsSync(rhPath)) {
        const block = readFileSync(rhPath, 'utf8').match(/const DOC_BUDGET\s*=\s*\{[\s\S]*?\n\}/)
        if (block) {
          const nBudget = [...block[0].matchAll(/^\s*'[^']+':\s*\[/gm)].length
          const cardBudget = qfText.match(/\|\s*\*\*词预算登记数\*\*\s*\|\s*\*\*(\d+)\s*条\*\*/)
          if (cardBudget && Number(cardBudget[1]) !== nBudget) {
            errors.push(`[P1 速查卡词预算条数漂移] docs/quick-facts.md 写「${cardBudget[1]} 条」，而 repo-hygiene-check.mjs 的 DOC_BUDGET 实测 ${nBudget} 条`)
          } else if (!cardBudget) {
            errors.push('[P2 速查卡词预算条数] docs/quick-facts.md 未见「词预算登记数 | **N 条**」行——该行是常驻面 / 词预算的唯一入口数字，请补齐')
          }
        }
      }
    }
  }
}

}
