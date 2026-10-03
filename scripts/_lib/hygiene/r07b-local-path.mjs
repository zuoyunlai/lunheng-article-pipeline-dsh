// ⑦b 本机绝对路径（D-2·修法② · v18.18.4）
//   动机：规则⑦ 只扫**凭据形态**，对「路径」这类可避免的信息泄露完全无感——审计 D-2 实测
//   发布物里写着 `E:\<本机根>\…`（其中一处还带内部项目目录名与内部审计报告名），而⑦ 照打印
//   「无命中」。那三处内容已在早前批次改为占位符；本规则补的是**防复发的那一半**。
//
//   两档强度（这是刻意的，理由见 `_lib/local-path-scan.mjs` 头注释）：
//     · **发布物**——硬零。它是要发出去的制品，一条都不许有。
//     · **非随包树**——**棘轮**。那 22 个文件是历史修订记录，备份路径是安全流程的过程证据；
//       设成硬零会让门**永久红**，而永久红的门等于没有门。棘轮 = 新增即红、缩减即绿。
//
//   ⚠️ **两个由 CI 抓出来的实现缺陷**（v18.18.4，本地跑是绿的、推上去才红）：
//     ① **扫 tracked 会漏掉未 `git add` 的新文件**——`git ls-files` 只列已跟踪的。我本地跑门时
//        新模块还没 add，于是「零命中」；提交后被 CI 扫到才暴露。**改为扫 `scanSet`（含未跟踪，
//        与规则① 同源）**，本地与 CI 才同口径。
//     ② **扫描器自身的定义与测试必然含示例机器路径**——`_lib/local-path-scan.mjs` 要写出模式、
//        `tests/local-path-scan.test.mjs` 要写正/负例夹具，那不是泄露。故显式豁免（同 `SELF` 的思路）。
//        边界（如实）：这三个文件里若真藏了一条与模式无关的真实路径，本规则会漏；缓解是它们
//        **都不随包**（发布物硬零仍生效）、体积小、用途单一。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { scanLocalPaths, LOCAL_PATH_BASELINE } from '../local-path-scan.mjs' // D-2②：本机绝对路径（发布物硬零 + 非随包树棘轮）
import { isText } from './_shared.mjs'

export function run(ctx) {
  const { fail, note, ROOT, scanSet, SELF, packFiles } = ctx
  const LOCAL_PATH_EXEMPT = new Set([SELF, 'scripts/_lib/local-path-scan.mjs', 'tests/local-path-scan.test.mjs'])
  const packKnown = packFiles !== null   // 三态（O-2）：null = UNKNOWN，**不得**当作「发布物 0 处合格」
  const packedSet = new Set(packFiles ?? [])
  let shippedPathHits = 0
  let ratchetBreaches = 0
  const baselineSeen = new Set()
  for (const p of scanSet.filter(isText)) {
    if (LOCAL_PATH_EXEMPT.has(p)) continue
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    const hits = scanLocalPaths(readFileSync(abs, 'utf8'))
    if (!hits.length) continue
    if (packedSet.has(p)) {
      shippedPathHits++
      // 路径本身不是凭据，可以照原样打印（打印才可修）；但仍只给首例，避免刷屏
      if (shippedPathHits <= 5) fail('localpath', `**发布物**含本机绝对路径：${p} → \`${hits[0].text}\`（${hits[0].why}）——发布物一条都不许有，请改占位符（如 \`<项目根>/…\`）`)
    } else {
      const cap = LOCAL_PATH_BASELINE[p]
      if (cap === undefined) {
        ratchetBreaches++
        if (ratchetBreaches <= 5) fail('localpath', `非随包文件含本机绝对路径但**未登记**：${p}（${hits.length} 处，首例 \`${hits[0].text}\`）——若确属历史记录，请在 \`_lib/local-path-scan.mjs\` 的 LOCAL_PATH_BASELINE 登记并写明理由`)
      } else {
        baselineSeen.add(p)
        if (hits.length > cap) {
          ratchetBreaches++
          if (ratchetBreaches <= 5) fail('localpath', `${p} 本机绝对路径 ${hits.length} 处 > 棘轮上限 ${cap}（首例 \`${hits[0].text}\`）——新增泄露当即拦下；确属必要请在同一次提交抬升上限并写明理由`)
        }
      }
    }
  }
  if (shippedPathHits > 5) fail('localpath', `发布物本机绝对路径另有 ${shippedPathHits - 5} 处未逐条列出`)
  const staleBaseline = Object.keys(LOCAL_PATH_BASELINE).filter((p) => !baselineSeen.has(p))
  note(
    (packKnown
      ? `⑦b 本机绝对路径：发布物 ${shippedPathHits} 处（须为 0）`
      : `⑦b 本机绝对路径：**发布物档 UNKNOWN**（⑥ 的 npm pack 清单未取得——**不得**读作「0 处合格」）`) +
      `／非随包树棘轮 ${baselineSeen.size}/${Object.keys(LOCAL_PATH_BASELINE).length} 个已登记文件在基线内` +
      `${staleBaseline.length ? `；⚠️ 基线内 ${staleBaseline.length} 个文件已无命中，可把上限改小（${staleBaseline.slice(0, 3).join(' / ')}…）` : ''}`,
  )
}
