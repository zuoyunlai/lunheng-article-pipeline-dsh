#!/usr/bin/env node
// 联网用例（手动跑；不进 `npm test`——见同目录 README.md）
//
// 用法：$env:REFVERIFY_ONLINE = '1'; node tests/network/ref-verify.online.mjs
// 退出码：0 全过 / 1 有断言失败 / 2 未设开关（明确拒绝，防"忘了设也当跑过"）
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.REFVERIFY_ONLINE !== '1') {
  console.error('未设 REFVERIFY_ONLINE=1 → 明确拒绝执行（不做"静默跳过"）')
  process.exit(2)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts', 'ref-verify.mjs')

const CARD = `# 文献卡（联网夹具）

### [L01] Chatting and cheating: Ensuring academic integrity in the era of ChatGPT
- **作者**: COTTON D R E, COTTON P A, SHIPWAY J R
- **年份**: 2024
- **DOI**: 10.1080/14703297.2023.2190148

### [L02] A completely different paper about marine biology
- **作者**: Zhang S
- **年份**: 2023
- **DOI**: 10.1057/s41296-023-00664-y
`

let fail = 0
const ok = (cond, msg) => {
  if (cond) console.log(`✔ ${msg}`)
  else { fail++; console.log(`✖ ${msg}`) }
}

const proj = mkdtempSync(join(tmpdir(), 'lunheng-rv-online-'))
mkdirSync(join(proj, 'literature'), { recursive: true })
writeFileSync(join(proj, '01-任务简报.md'), '外部服务授权：检索=全网检索 / 推理=远程 / 脱敏=basic\n', 'utf8')
writeFileSync(join(proj, 'literature', '文献卡.md'), CARD, 'utf8')
const report = join(proj, 'final', '引用核验.json')

let code = 0
try {
  execFileSync(process.execPath, [SCRIPT, proj, '--report', report], { stdio: 'ignore' })
} catch (e) {
  code = e.status ?? 1
}

const out = JSON.parse(readFileSync(report, 'utf8'))
ok(out.mode === 'online', '授权串为「全网检索」时进入 online 模式')
ok(['0', '3'].includes(String(code)), `退出码 ∈ {0,3}（实际 ${code}）——绝不出现 1`)

const l1 = out.results.find((r) => r.id === 'L01')
ok(l1 && l1.status === 'found', `真实 DOI → found（实际 ${l1 && l1.status}）`)
ok(l1 && Array.isArray(l1.backfill) && l1.backfill.length > 0, 'R3：found 条目给出 backfill 建议（卷/期/页）')

const l2 = out.results.find((r) => r.id === 'L02')
ok(l2 && (l2.status === 'unverified' || l2.status === 'partial'), `源不可达/张冠李戴时不得假阳（实际 ${l2 && l2.status}）`)
ok(!out.results.some((r) => r.status === 'not_found' && r.unverified === true), 'not_found 不得由基础设施故障冒充')

rmSync(proj, { recursive: true, force: true })
console.log(fail ? `\n✖ ${fail} 条失败` : '\n✔ 全过')
process.exit(fail ? 1 : 0)
