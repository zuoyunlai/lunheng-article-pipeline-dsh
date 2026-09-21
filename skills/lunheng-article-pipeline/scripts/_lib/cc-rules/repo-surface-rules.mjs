// ⑧ patch+examples 版本引用 / ⑨ .dsh 双写同步 / ㉑ 五语 README 镜像 / ㉒ 锚点存在 / ㉓ 阈值总表 + 门模块目录
// v18.3.1（审计 B2 阶段 3）：从 consistency-check.mjs 按规则族抽离，行为逐字等价（回归测试的
//   注入验证用例 + 真源仓库自跑兜底）。共享态（errors / 派生源 / 版本真源等）由主脚本构建 ctx 传入。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

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
const fiveLangs = ['README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md'];
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

}
