// ⑩ 随包脚本白名单 / ⑩b 脚本计数 / ⑩c 分档映射（含 walkAny / tierTruth）
// v18.3.1（审计 B2 阶段 3）：从 consistency-check.mjs 按规则族抽离，行为逐字等价（回归测试的
//   注入验证用例 + 真源仓库自跑兜底）。共享态（errors / 派生源 / 版本真源等）由主脚本构建 ctx 传入。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
// v18.80.0（全量审计-v18.79.1）：㉚「lib 版本写死」改用**真词法剥离器**（不是逐行正则切 `//`）。
//   两次实测的同一族缺陷：手写剥离器会把**字符串字面量里的 `//`** 当注释开头（v18.80.0 首次：`Config.why`
//   里写 `` `read`/`web_*` `` → 该行被截断，后续行被并入同一逻辑行），也会把**字符串里的版本号**当真
//   （同批：`lib/tools.js` 的工具描述串里写「v18.80.0 P1-2」→ 报假 P1）。
//   后者是**真判据错误**而非误报口径问题：`lib/**` 的字符串常含**面向人的说明文本**，其中的版本号是
//   「本行为于哪一版引入」的留痕（与该规则明文允许的「注释里引用版本号」完全同源），它**不会被渲染成
//   运行期版本声明**、也不会随 bump 腐烂——真正要抓的是**代码里**（含模板字面量求值结果）的版本字面量。
//   修法：复用**包内**的 `_lib/source-mask.mjs`（= `maskNonCode()`，B7 的同一件工具，已覆盖块注释 /
//   行注释 / 单双引号字符串 / 模板字面量 / 正则字面量，且**等长屏蔽、换行保留**）。
//   ⚠️ **为什么是包内副本而不是仓库根 `scripts/_lib/`**：本规则跑在 `tests/**` 的 **mkRepo 临时仓库**里
//   （`skills/` + 少量包级清单就被复制过去，**不含**仓库根 `scripts/`），故跨层 import 会在所有注入用例里
//   直接 `ERR_MODULE_NOT_FOUND`（v18.80.0 首版就是这么挂的，19 条用例同批变红）。包内副本由
//   `tests/scripts/cross-script.test.mjs` 类的**同源对账**兜住，仓库根那份仍服务于 `exit-resolution` 族。
import { maskNonCode } from '../source-mask.mjs'

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
// v18.62.4（全量审计-v18.62.3 §8.2 #27）：**「解析不到计数」必须响亮失败，不得静默 no-op**。
//   病灶：旧式单模式 `白名单（[^）]*?(\d+)\s*个` —— 措辞一旦变动（如改成「共 28 个脚本」/
//   「白名单 28 个」/「共 28 个」）就**匹配不到**，而 `if (declaredCount && …)` 让它**静默通过**：
//   门还在、红变绿，且**没有任何迹象**表明它这一轮其实没检（本仓最反感的形态）。
//   修法：多模式兜底 + 兜不到就报 P1（要求同批把计数写成可解析的形态）。
const declaredCountRaw =
  wlLine.match(/白名单（[^）]*?(\d+)\s*个/)?.[1]                       // 白名单（vX 增补后：共 N 个）
  ?? wlLine.match(/白名单[^0-9\n]{0,40}?共\s*(\d+)\s*个/)?.[1]          // 白名单 … 共 N 个
  ?? wlLine.match(/白名单[^0-9\n]{0,40}?(\d+)\s*个\s*(?:\.mjs|脚本)/)?.[1] // 白名单 … N 个脚本 / N 个 .mjs
  ?? wlLine.match(/白名单[^0-9\n]{0,40}?(\d+)\s*个/)?.[1];              // 兜底：白名单 … N 个
if (declaredCountRaw === undefined) {
  errors.push('[P1 白名单计数不可解析] SKILL.md 的「随包脚本白名单」行里找不到「N 个」计数'
    + '——本规则**已静默失效**（不是通过）。请把计数写成可解析形态（如「白名单（…：共 N 个）」），'
    + `或同批修订本规则的正则。磁盘真值 = ${diskScripts.length} 个`);
} else if (Number(declaredCountRaw) !== diskScripts.length) {
  errors.push(`[P1 白名单数量不符] SKILL.md 声明 ${declaredCountRaw} 个 ≠ 磁盘 ${diskScripts.length} 个`);
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
//   **v18.22.3 假阳性修复（由本批自己的修订记录当场抓出）**：旧式 `(\d+)\s*\.mjs` 会把**文件名尾随数字**
//     读成计数断言——`eff4-probe2.mjs` 里的 `2.mjs` 被判「写 2 个 ≠ 磁盘 24 个」（实测：v18.22.3 修订记录
//     因引用该临时脚本名而红）。修法 = 给数字加**标识符左边界否定断言**：数字紧跟在字母/数字/`_`/`-`/`.` 之后
//     即属名字的一部分，不算计数；真断言（`12 个` / `**12** \`.mjs\` / `（12.mjs`）的前导字符是空白、星号、
//     反引号或标点 → 照旧命中。**覆盖面未削弱**：回归网（`tests/scripts/consistency-check.test.mjs` ⑩b 用例，v18.68.0 拆分归位）两侧同时锁——
//     假阳性不报 + 真计数漂移仍报。
const SCRIPT_COUNT_RE = /(\d+)\s*个|(?<![\w.-])(\d+)\s*(?:zero-dependency|零依赖)?\s*\.mjs/gi;
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
  // v18.68.0 拆档：CHANGELOG 的历史归档（内容逐字移入，同为「当时事实」留痕，不追溯改写）
  if (f.replaceAll('\\', '/').includes('changelog/archive/')) continue;
  if (seenClaim.has(f)) continue;
  seenClaim.add(f);
  const rel = relative(REPO_ROOT, f).replaceAll('\\', '/');
  if (/^docs\/(审计与修订记录|验证记录)\//.test(rel)) continue;   // 历史归档目录：审计/修订/验证记录记成文时旧口径，整体豁免（发版前审计 §二）
  // v18.62.6：**`audits/**` 整体豁免**（原为两条子模式 `反哺报告-` / `*审计报告`，命名枚举不完备）。
  //   病灶（实测）：新增的 `audits/架构优化评审-2026-10-02.md` 未被任一枚举命中，其规模基线行
  //   （`根 tests/ 64 个 *.test.mjs`）与扇出表行（`仓库 10 个脚本`）被本规则判「脚本计数漂移」——
  //   而它们记的是**测试数**与**仓库根脚本数**，不是技能内随包脚本数；且该文件是**成文时的快照**，
  //   拿今天的磁盘值去核它 = 要求篡改审计记录。**本文件上方注释早已写明该原则**：
  //   「审计报告同样是一份 dated 快照……改报告 = 篡改审计记录；不改 = 门永远红」——只是当时
  //   用命名枚举实现它，故每出现一种新报告命名就复发一次（本批已是第三次）。
  //   **口径统一**：兄弟规则 `lib-line-refs.mjs` 的 `HISTORICAL_DOC_PATTERNS` 早已是 `^audits\//` 整目录豁免，
  //   本规则向它看齐。`audits/` 在本仓被明定为「**自由格式审查报告目录**」（各报告页脚自陈），
  //   其中所有内容都是 dated 快照。**权威现行计数只住 `SKILL.md` 白名单行**（规则 ⑩ 双向核验，未削弱）。
  if (/^audits\//.test(rel)) continue;
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
    if (scanned.has(f) || f.includes('CHANGELOG') || f.replaceAll('\\', '/').includes('changelog/archive/')) continue;
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

// ⑩d 产物 `version` 不得写死（v18.62.4 · 全量审计-v18.62.3 §8.3 #39）
//   病灶：7 个随包脚本在 JSON 产物里写死 `version: 'v18.11.0'` 这类字面量，**自实装起从未更新**
//   （实测停在 v18.11.0 / v18.24.0 / v18.41.0 / v18.59.0，而包已是 v18.62.4），且**两门都不覆盖**它。
//   该字段是给下游看「产物出自哪一版机制」的 —— 写死即**必然腐烂**，且没有任何东西会提醒。
//   规则：随包脚本**不得**再出现 `version: 'vX.Y.Z'` 字面量；应用 `packageVersionTag()`
//   （真源 = `_lib/pkg-version.mjs`，运行时读随包 package.json）。本门只拦**新增的写死**，
//   不做「值是否等于 pkgVer」的比对（那样每版 bump 都要改 7 处 —— 那正是本条要消灭的东西）。
for (const f of diskScripts) {
  const t = readFileSync(join(ROOT, 'scripts', f), 'utf8')
  const hard = [...t.matchAll(/version:\s*'(v\d+\.\d+\.\d+)'/g)].map((m) => m[1])
  if (hard.length) {
    errors.push(`[P1 脚本产物版本写死] ${f} 的产物 version 写死为 ${hard.join(' / ')}（包已是 v${pkgVer}）`
      + '——请改用 `packageVersionTag()`（真源 `_lib/pkg-version.mjs`）。写死必然腐烂：本轮实测 7 处停在四个旧版本上，且无门发现')
  }
}

// ㉚ `lib/**` 代码面不得出现**当前包版本**字面量（v18.76.0 · v18.75.1 全量架构审计 R7-E5 修复）
//   病灶（E5）：本仓全部版本规则跑在**技能根**（本文件与 docs 规则都只收 `.md`），`lib/**` 是唯一
//     敞着的版本面。历史两次漂移都出在这里：v18.62.4 的尾注正文、v18.62.6 的尾注**标题**各硬编码一次
//     当前版本，两次都靠人工发现（`lib/index.js` 的注释自己承认「`lib/**` 完全在扫描面之外」）。
//   判据（刻意收窄以零假阳性）：**先剥注释**（`/* */` 与行内 `//` 到行尾），再看剩余代码里有没有
//     等于 `pkgVer` 的 semver。为什么必须剥注释：本仓的注释惯例正是**引用当前版本号**记录本轮修复
//     （如 `v18.76.0（…修复）`），那不是漂移源——漂移源是**会被渲染/执行的字面量**。
//     剥注释只会导致假阴性（代码行里出现 `//` 之后被切掉），**不会制造假阳性**——方向是安全的。
{
  const libDir = REPO_ROOT ? join(REPO_ROOT, 'lib') : null
  if (libDir && existsSync(libDir)) {
    const walkJs = (dir, acc = []) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walkJs(p, acc)
        else if (name.endsWith('.js') || name.endsWith('.mjs')) acc.push(p)
      }
      return acc
    }
    for (const f of walkJs(libDir)) {
      // v18.80.0：改用 `maskNonCode()`（见文件头 import 处的说明）。旧写法是
      //   `.replace(/\/\*[\s\S]*?\*\//g,' ').split('\n').map(l=>l.replace(/\/\/.*$/,''))`——
      //   两处缺陷：① 字符串字面量里的 `//` 被当注释（行被截断、后续行并入）；② 字符串内容不被屏蔽，
      //   于是说明文本里的版本号被当成「代码里的版本字面量」。
      //   `maskNonCode` 是**真词法扫描**：注释与字符串**内容**置空格、引号与换行保留、长度不变，
      //   故下面的行号/列号仍可直接映射回原文件；它同时处理模板字面量（`` `${...}` `` 内的表达式仍算代码）。
      const src = maskNonCode(readFileSync(f, 'utf8'))
      const hits = [...new Set([...src.matchAll(new RegExp(`\\bv?${pkgVer.replace(/\./g, '\\.')}\\b`, 'g'))].map((m) => m[0]))]
      if (hits.length) {
        errors.push(`[P1 lib 版本写死] ${relative(REPO_ROOT, f)} 的**代码**（去注释后）出现当前包版本字面量 ${hits.join(' / ')}`
          + '——该串会随 bump 腐烂且无门能发现（v18.62.4/v18.62.6 两次实测）。请改用运行时真源'
          + '（`lib/index.js` 的 `readPackageVersion()` / `_lib/pkg-version.mjs` 的 `packageVersionTag()`）')
      }
    }
  }
}

// ㉛ 派发话术格式硬约束 ⊆ `_shared/机检硬格式.md` 必填项（v18.77.0 · 文档与运行-审计 v1 批 P-12 落地）
//   病灶：v18.2.7 已写明「最小集 ↔ 真源不同步」的代价（最小集没把 `[Lxx]` 列进，2026-09-20 全流程
//     第三次踩到）——派发话术的格式硬约束只写在 `pipeline-readme.md` §派发话术 段里，
//     `_shared/机检硬格式.md` §一/§五 的必填项**新增**时（如 v18.7.x 加 G15 / v18.41.0 加 G15-VolIssue）
//     **没有任何门提醒去同步派发话术**。
//   实现（v18.77.0 首版）：只检**派发话术段必须存在「⚠️ 格式硬约束」段**（存在性断言）——不做
//     「每条具体项 ⊆ 真源」的语义级派生（实测首次尝试报 11 项假阳性，正则难精确；改为存在性断言
//     同样能捕捉「整段漏写」型漂移，副作用小）。后续批可逐步收紧为「每条项 ⊆ 真源」语义级派生。
//   为什么重要：派发话术是真源下游唯一执行面——子代理照抄派发话术产出，**少了某条**等于主人侧项目
//     漏核（如漏 [Lxx] → 漏引 → T8 终检才发现 → 已无修订余量 = 列入 final/局限性.md）。
{
  const src = join(REPO_ROOT, 'skills/lunheng-article-pipeline/references/pipeline-readme.md')
  if (existsSync(src)) {
    const text = readFileSync(src, 'utf8')
    // §派发话术 段必须含「⚠️ 格式硬约束」段
    const dispatchSection = text.split(/^## 派发话术/m)[1] || ''
    if (!/⚠️\s*格式硬约束/.test(dispatchSection)) {
      errors.push('[P1 派发话术缺格式硬约束段] pipeline-readme.md §派发话术 段必须含「⚠️ 格式硬约束」段（v18.77.0 P-12；存在性断言；语义级每条 ⊆ 真源派生留待后续批）')
    }
  }
}

}
