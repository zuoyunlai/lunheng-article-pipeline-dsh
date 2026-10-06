// M 门项数的**派生真源**（v18.78.2 · 全量审计-v18.78.1 A4 修复）
//
// **为什么单独成模块**（教训）：M 门项数（机检 24 / 总 25）此前由三处**各自手写**——
//   ① 一致性规则 ⑥b 的内联派生（本模块前身，原在 `consistency-check.mjs` 内）；
//   ② 审计视图 `build-evidence-bundle.mjs` 的段标题与用法句（实测写「M 门 **16** 项」）；
//   ③ 各文档的计数声明（由 ⑥b 机械兜住）。
//   ② **不在 ⑥b 的扫描面内**（⑥b 只扫被 git 跟踪的 `skills/**` 与 `docs/**` `.md`，生成物不算），
//   故长期无人发现——而该视图被 T4–T9 八个角色当闸门真源读，**它自报的项数比真值少 9 项**。
//   修法 = 把「数门标签」这一实现收敛到本模块，**一致性规则与视图生成器共用同一个派生**
//   （这正是本仓「一事实一处」对**数字**的要求：数字不许手写第二遍，只许指向派生）。
//
// **边界（如实声明，不得夸大）**：
//   · 派生口径 = 门模块里 `gate: 'M-XX-N …'` **标签去重计数**（与规则 ⑥b 逐字同口径）；
//   · 它数的是「代码里登记了几道门」，**不保证每道门本轮都真跑了**——本轮实际入账数看
//     `M-Gate-Report.json` 的 `total`，两者不一致时**以报告为准**（视图里分母优先取报告的 `total`）；
//   · `total` 的 `+1` = 人工项 M-Integrity-2（T7.5/T8 亲做，无 gate 标签，故派生不出）。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 拼接「主脚本 + 门模块」源码——派生输入的唯一构造点（⑥b 与视图共用）。
 * @param scriptsDir - 随包脚本目录（即 `.../skills/lunheng-article-pipeline/scripts`）
 * @returns {{src: string, modMissing: boolean}} `modMissing` = 门模块目录缺失（缺目录的 P0 由 ⑥b 文末规则区报）
 */
export function loadGateSource(scriptsDir) {
  const modDir = join(scriptsDir, '_lib', 'mgate-gates');
  const modMissing = !existsSync(modDir);
  let src = readFileSync(join(scriptsDir, 'm-gate-check.mjs'), 'utf8');
  if (!modMissing) {
    for (const f of readdirSync(modDir).filter((x) => x.endsWith('.mjs'))) {
      src += '\n' + readFileSync(join(modDir, f), 'utf8');
    }
  }
  return { src, modMissing };
}

/**
 * 从门源码派生各族项数。`mech` = 机械项数；`total` = 机械项数 + 1 人工项（M-Integrity-2）。
 * ⚠️ **加族必须同批改三处**：本派生、⑳ 的语族清单（`mgate-doc-rules.mjs` 的 kinds）、
 *   `_shared/M-Gate-Algorithm.md` 的同名节（节头括注 + `###` 子节编号 1..N）。
 */
export function deriveGateCounts(gateSrc) {
  const grab = (pre) => new Set([...gateSrc.matchAll(new RegExp(`gate:\\s*'(M-${pre}-\\d+)`, 'g'))].map((m) => m[1])).size;
  const form = grab('Form'), exist = grab('Exist'), integ = grab('Integrity'), fact = grab('Fact');
  return { form, exist, integ, fact, mech: form + exist + integ + fact, total: form + exist + integ + fact + 1 };
}
