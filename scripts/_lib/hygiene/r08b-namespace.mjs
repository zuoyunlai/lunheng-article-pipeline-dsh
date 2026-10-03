// ⑧b 退出码命名空间对账（C-11 机械化 · v18.18.5）
//   动机：纪律要求两处登记——`EXIT_CONTRACT`（机器面）与 `docs/troubleshooting.md` §8
//   「命名空间配额」（人读面）——但两处一直**只靠人工同步**。加了新码而 §8 忘写（或反之）
//   没有任何门会发现。审计 C-11 要的是「§8 与 EXIT_CONTRACT 一致（新增断言）」。
//   审计设想 §8 是逐行表，实测它是**配额散文**，故实现其等价不变量：
//   「代码实际用到的码集合」== 「§8 声明的码集合」，**双向**查（漏登记 / 已无人用 都报）。
//   解析器放在 `_lib/exit-namespace.mjs`（可单测）；形状变了会**抛错**而不是静默通过。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseExitContract, parseNamespaceQuota, parseExitTable, reconcile } from '../exit-namespace.mjs' // C-11：§8 配额 ↔ EXIT_CONTRACT 双向对账

export function run(ctx) {
  const { fail, note, ROOT } = ctx
  try {
    const contract = parseExitContract(readFileSync(join(ROOT, 'scripts', 'repo-hygiene-check.mjs'), 'utf8'))
    const docText = readFileSync(join(ROOT, 'docs', 'troubleshooting.md'), 'utf8')
    const quota = parseNamespaceQuota(docText)
    const { onlyInCode, onlyInDoc } = reconcile(contract.codes, quota.codes)
    if (onlyInCode.length) {
      fail('exit-code', `退出码 ${onlyInCode.join(', ')} 已写进 EXIT_CONTRACT 但**未登记**于 docs/troubleshooting.md §8 命名空间配额（:${quota.line}）——两处必须同一次提交一起改`)
    }
    if (onlyInDoc.length) {
      fail('exit-code', `§8 命名空间配额（:${quota.line}）声明了 ${onlyInDoc.join(', ')}，但 EXIT_CONTRACT 里**已无人使用**——要么补用，要么从 §8 删掉（免得下一个人以为这些码被占了）`)
    }
    // M-4（二次复审）：§8 的「声明」还有**第二种载体——表格**（主控最常读的入口）。旧版只钉了配额散文，
    //   实测把表里 `| 2 |` 改成 `| 12 |` 时**全套门绿**。故对表行做同一套双向对账。
    const table = parseExitTable(docText)
    const tbl = reconcile(contract.codes, table.codes)
    if (tbl.onlyInCode.length) {
      fail('exit-code', `退出码 ${tbl.onlyInCode.join(', ')} 在 EXIT_CONTRACT 里，但 §8 的**表格**（:${table.line} 起）**缺该行**——表是主控的阅读入口，缺行会让读表的人以为该码不存在`)
    }
    if (tbl.onlyInDoc.length) {
      fail('exit-code', `§8 的**表格**（:${table.line} 起）列了 ${tbl.onlyInDoc.join(', ')}，但 EXIT_CONTRACT 里**已无人使用**——要么补用，要么从表里删掉`)
    }
    note(`⑧b 退出码命名空间：代码侧 ${contract.codes.length} 个码 ↔ §8 配额 ${quota.codes.length} 个 ↔ §8 表格 ${table.codes.length} 个，三方一致（${contract.codes.join('/')}）`)
  } catch (e) {
    fail('exit-code', `⑧b 退出码命名空间对账无法执行：${e.message}`)
  }
}
