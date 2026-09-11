#!/usr/bin/env node
// build-evidence-bundle.mjs — T8 终检：自动生成 final/证据包/ + 可选 audits/审计视图-v0.md
// 用法: node scripts/build-evidence-bundle.mjs <run/项目名> [--project <名>] [--summary] [--deep-summary]
// 行为:
//   默认：收集 文献卡/数据卡/案例卡/先行者清单/分析大纲/批判报告/审计报告/复核报告/反哺报告/修订说明*/status/01-任务简报 到 <项目>/final/证据包/
//   --summary：额外生成 <项目>/audits/审计视图-v0.md（T6 批判 / T7 审计 / T9 审稿 / T8 终检 共用轻量摘要，避免各自重读全文）
//   --deep-summary：在 --summary 基础上，把每个素材卡的标题/作者/年份/信任级别列入 `审计视图-v0.md` 的「素材卡全集」段（T7 复核一次看完全部素材，不用 grep 跳文件）
//   审计视图含：定稿章节结构 + 字数 + 素材卡数量 + 信任级别分布 + M 门状态（从 final/M-Gate-Report.json 读取，
//   兼容 audits/ 旧路径；报告由 `m-gate-check.mjs --report <path>` 落盘 —— v2.5.2-dsh.13 修复路径契约）
import { readdirSync, copyFileSync, existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const wantDeepSummary = args.includes('--deep-summary');
// --deep-summary 蕴含 --summary（旧版单独用是静默空操作，v2.5.2-dsh.13 修复）
const wantSummary = args.includes('--summary') || wantDeepSummary;
// --project <名> 或第一个位置参数（旧版表达式自引用，--project 的值从未被使用）
const projectIdx = args.indexOf('--project');
const project = (projectIdx >= 0 && args[projectIdx + 1])
  ? args[projectIdx + 1]
  : args.find((a, i) => !a.startsWith('--') && i !== projectIdx + 1);
if (!project || !existsSync(project)) {
  console.error('用法: node build-evidence-bundle.mjs <run/项目名> [--project <名>] [--summary] [--deep-summary]');
  process.exit(2);
}

// 收集规则：源相对路径 → 目标文件名（找不到就跳过并记录）
const RULES = [
  ['literature/文献卡.md', '文献卡.md'],
  ['literature/先行者清单.md', '先行者清单.md'],
  ['data/数据卡.md', '数据卡.md'],
  ['cases/案例卡.md', '案例卡.md'],
  ['analysis/分析大纲.md', '分析大纲.md'],
  ['analysis/批判报告-v1.md', '批判报告-v1.md'],
  ['audits/审计报告-v1.md', '审计报告-v1.md'],
  ['audits/复核报告-v1.md', '复核报告-v1.md'],
  ['audits/反哺报告-v1.md', '反哺报告-v1.md'],
  ['audits/审稿报告-v1.md', '审稿报告-v1.md'],
  ['01-任务简报.md', '01-任务简报.md'],
  ['status.md', 'status.md'],
];

const destDir = join(project, 'final', '证据包');
if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

let copied = 0, missing = 0;
for (const [rel, name] of RULES) {
  const src = join(project, rel);
  if (existsSync(src)) {
    copyFileSync(src, join(destDir, name));
    copied++;
    console.log(`✓ ${rel} -> 证据包/${name}`);
  } else {
    missing++;
    console.log(`· 跳过(不存在): ${rel}`);
  }
}

// 修订说明 *：drafts/ 下所有 修订说明-*.md
const draftsDir = join(project, 'drafts');
if (existsSync(draftsDir)) {
  for (const f of readdirSync(draftsDir)) {
    if (/^修订说明-.*\.md$/.test(f)) {
      copyFileSync(join(draftsDir, f), join(destDir, f));
      copied++;
      console.log(`✓ drafts/${f} -> 证据包/${f}`);
    }
  }
}

console.log(`\n证据包生成完成: 复制 ${copied} 个文件, 跳过 ${missing} 个缺失源.`);
console.log(`目录: ${destDir}`);

// ===== 审计视图摘要（v2.5.2-dsh.7 新增，--summary 启用）=====
if (wantSummary) {
  const finalPath = join(project, 'final', '定稿.md');
  if (!existsSync(finalPath)) {
    console.log('· 跳过审计视图：final/定稿.md 不存在（**未生成任何审计视图**，请先产出定稿；此行非报错但不得当作「已生成」）');
    process.exit(0);
  }
  const finalText = readFileSync(finalPath, 'utf8');
  const han = (finalText.match(/[\u4e00-\u9fff]/g) || []).length;   // 与 count-chars.mjs 同一口径（旧版 [一-龥] 少 89 个码位）
  // 章节结构（H1/H2）
  const sections = [];
  for (const line of finalText.split('\n')) {
    const m1 = line.match(/^#\s+(.+)/);
    const m2 = line.match(/^##\s+(.+)/);
    if (m1) sections.push(`# ${m1[1]}`);
    else if (m2) sections.push(`  ## ${m2[1]}`);
  }
  // 素材卡条目数（v2.5.2-dsh.7 用 Set 去重，避免全文中重复 [Lxx] 引用被多次计数）
  const cntCards = (p) => {
    if (!existsSync(join(project, p))) return 0;
    const t = readFileSync(join(project, p), 'utf8');
    const ids = new Set();
    const re = /\[([LCFD])(\d+)\]/g;   // 与 m-gate-check 同口径（旧版限 2-3 位 → 1 位编号漏计，审计视图自相矛盾）
    let m;
    while ((m = re.exec(t)) !== null) ids.add(m[1] + m[2]);
    return ids.size;
  };
  // 兼容旧版调用（部分位置仍可能引用 cnt）
  const cnt = cntCards;
  const litN = cnt('literature/文献卡.md');
  const datN = cnt('data/数据卡.md');
  const casN = cnt('cases/案例卡.md');
  // 信任级别分布
  const trustDist = (p) => {
    if (!existsSync(join(project, p))) return null;
    const t = readFileSync(join(project, p), 'utf8');
    const a = (t.match(/[Aa] 级|A 级|核心期刊|权威机构/g) || []).length;
    const b = (t.match(/[Bb] 级|B 级|一般期刊/g) || []).length;
    const c = (t.match(/[Cc] 级|C 级|网络来源|媒体报道|二手转引/g) || []).length;
    return { a, b, c };
  };
  const litT = trustDist('literature/文献卡.md');
  const datT = trustDist('data/数据卡.md');
  // M 门状态：真源 = final/M-Gate-Report.json（文档全仓一致口径），兼容 audits/ 旧路径
  const mCandidates = [join(project, 'final', 'M-Gate-Report.json'), join(project, 'audits', 'M-Gate-Report.json'), join(project, 'audits', 'M-Gate-Report-v0.json')];
  const mReportPath = mCandidates.find((p) => existsSync(p));
  let mSummary = '（未找到 M-Gate 报告：先跑 `node scripts/m-gate-check.mjs <final/定稿.md> <final/证据包> --report <项目>/final/M-Gate-Report.json`）';
  if (mReportPath) {
    try {
      const m = JSON.parse(readFileSync(mReportPath, 'utf8'));
      mSummary = `通过 ${m.pass || 0}/${m.total || 12} | P0: ${m.p0 || 0} | P1: ${m.p1 || 0} | P2: ${m.p2 || 0} | LLM 兜底: ${m.soft || m.llm || 0} | exit: ${m.exit ?? '?'}`;
    } catch (e) {
      mSummary = `（M-Gate-Report-v0.json 解析失败: ${e.message}）`;
    }
  }
  // 批判/审计/审稿/终检报告存在性
  const reports = {
    '批判': existsSync(join(project, 'analysis', '批判报告-v1.md')),
    '审计': existsSync(join(project, 'audits', '审计报告-v1.md')),
    '复核': existsSync(join(project, 'audits', '复核报告-v1.md')),
    '审稿': existsSync(join(project, 'audits', '审稿报告-v1.md')),
    '修订说明': existsSync(join(project, 'drafts', '修订说明-v1.md')),
  };
  const reportsLine = Object.entries(reports).map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join(' ');

  // 引用闭环扫描（[Lxx]/[Dxx]/[Cxx] 在定稿中的实际使用，去重计数）
  const uniq = (arr) => new Set(arr).size;
  const usedL = uniq(finalText.match(/\[L\d+\]/g) || []);
  const usedD = uniq(finalText.match(/\[D\d+\]/g) || []);
  const usedC = uniq(finalText.match(/\[C\d+\]/g) || []);

  const summary = `# 审计视图（v2.5.2-dsh.7 自动生成，T6/T7/T9/T8 共用）

> **用法**：T6 批判 / T7 审计 / T9 审稿 / T8 终检 派发时**先读本视图**，按需跳转全文/数据卡/文献卡/案例卡；不强制重读全部素材——本视图含章节结构、字数、素材卡数量、信任级别分布、M 门 13 项状态、引用闭环、报告存在性。
> 生成时间：${new Date().toISOString()}

## 一、定稿结构（${han} 纯汉字）

${sections.join('\n')}

## 二、素材卡数量

| 类型 | 数量 | 信任级别分布（A / B / C） |
|------|------|----------------------------|
| 文献卡 [Lxx] | ${litN} | ${litT ? `${litT.a} / ${litT.b} / ${litT.c}` : '—'} |
| 数据卡 [Dxx] | ${datN} | ${datT ? `${datT.a} / ${datT.b} / ${datT.c}` : '—'} |
| 案例卡 [Cxx] | ${casN} | — |

## 三、引用闭环（定稿正文实际引用的不重复编号数）

- 文献 [Lxx]：${usedL} 个
- 数据 [Dxx]：${usedD} 个
- 案例 [Cxx]：${usedC} 个

## 四、M 门 13 项状态

${mSummary}

## 五、阶段报告存在性（v1 = 最新一轮）

${reportsLine}

## 六、待 T8 终检 + 主人确认项

- [ ] 引用闭环：素材卡条数 vs 引用数差异（孤儿、未引用）
- [ ] 字数：定稿 ${han} 汉字 vs 任务简报目标（±2% 软档）
- [ ] 信任级别全填：数据卡每条「信任级别」独立段
- [ ] AI 使用声明：定稿文末 5 节白名单（M-Form-7）
- [ ] 参考文献编号闭环：定稿引用 [Lxx] 必须在参考文献清单
`;

  const auditsDir = join(project, 'audits');
  if (!existsSync(auditsDir)) mkdirSync(auditsDir, { recursive: true });
  const summaryPath = join(auditsDir, '审计视图-v0.md');
  writeFileSync(summaryPath, summary, 'utf8');
  console.log(`\n✓ 审计视图: ${summaryPath}`);
  console.log(`  - 定稿纯汉字: ${han}`);
  console.log(`  - 素材卡: L${litN} D${datN} C${casN}`);
  console.log(`  - 引用闭环: L${usedL} D${usedD} C${usedC}`);
  console.log(`  - 报告: ${reportsLine}`);

  // ===== --deep-summary 附加段（v2.5.2-dsh.7 新增）：素材卡全集标题/作者/年份/信任级别 =====
  if (wantDeepSummary) {
    // 直接从 project/literature|data|cases 读素材卡，提取每条 [Lxx]/[Dxx]/[Cxx] 标题（前 80 字）+ 信任级别 + 关键 URL
    const parseCard = (p, re) => {
      if (!existsSync(p)) return [];
      const t = readFileSync(p, 'utf8');
      const cards = [];
      // 按 [Lxx]/[Dxx]/[Cxx] 行分段
      const lines = t.split('\n');
      let cur = null;
      for (const line of lines) {
        const m = line.match(re);
        if (m) {
          if (cur) cards.push(cur);
          cur = { id: m[0], title: line.replace(m[0], '').trim().slice(0, 80), trust: null, source: null };
        } else if (cur) {
          const t2 = line.match(/信任级别\**[:：]\s*(已发布|主人投喂|二手转引)/);
          if (t2) cur.trust = t2[1];
          const u = line.match(/DOI[:：]?\s*(10\.\d{4,9}\/[^\s]+)/);
          if (u) cur.source = u[1];
        }
      }
      if (cur) cards.push(cur);
      return cards;
    };
    const Ls = parseCard(join(project, 'literature', '文献卡.md'), /\[L\d+\]/);
    const Ds = parseCard(join(project, 'data', '数据卡.md'), /\[D\d+\]/);
    const Cs = parseCard(join(project, 'cases', '案例卡.md'), /\[C\d+\]/);

    let deepSection = '\n\n---\n\n## 七、素材卡全集（--deep-summary 模式，v2.5.2-dsh.7 新增）\n\n';
    deepSection += `> T7 复核 / T5 修订 / T8 终检可在此段一次性看完全部素材卡标题 + 信任级别 + DOI，无需跳 `;
    deepSection += `final/证据包/ 逐个 grep。\n\n`;
    if (Ls.length) {
      deepSection += `### 文献卡 [L] 共 ${Ls.length} 条\n`;
      for (const c of Ls.slice(0, 30)) deepSection += `- ${c.id}  ${c.title}${c.trust ? ` ｜ ${c.trust}` : ''}${c.source ? ` ｜ DOI:${c.source}` : ''}\n`;
      if (Ls.length > 30) deepSection += `- ... 另 ${Ls.length - 30} 条省略\n`;
    }
    if (Ds.length) {
      deepSection += `\n### 数据卡 [D] 共 ${Ds.length} 条\n`;
      for (const c of Ds.slice(0, 30)) deepSection += `- ${c.id}  ${c.title}${c.trust ? ` ｜ ${c.trust}` : ''}\n`;
      if (Ds.length > 30) deepSection += `- ... 另 ${Ds.length - 30} 条省略\n`;
    }
    if (Cs.length) {
      deepSection += `\n### 案例卡 [C] 共 ${Cs.length} 条\n`;
      for (const c of Cs.slice(0, 30)) deepSection += `- ${c.id}  ${c.title}${c.trust ? ` ｜ ${c.trust}` : ''}\n`;
      if (Cs.length > 30) deepSection += `- ... 另 ${Cs.length - 30} 条省略\n`;
    }
    if (!Ls.length && !Ds.length && !Cs.length) {
      deepSection += '\n> ⚠️ 未找到素材卡（literature/文献卡.md 或 data/数据卡.md 或 cases/案例卡.md 缺失）\n';
    }

    const deepPath = join(auditsDir, '审计视图-v0.md');
    const prev = readFileSync(deepPath, 'utf8');
    writeFileSync(deepPath, prev + deepSection, 'utf8');
    console.log(`  - 素材卡全集（deep）: L${Ls.length} D${Ds.length} C${Cs.length}`);
  }
}
