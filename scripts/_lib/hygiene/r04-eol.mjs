// ④ 行尾
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isText } from './_shared.mjs'

export function run(ctx) {
  const { fail, note, ROOT, scanSet, git } = ctx
  const eolOut = git(['ls-files', '--eol'])
  let eolBad = 0
  const eolSeen = new Set()
  for (const line of (eolOut.stdout || '').split('\n')) {
    const m = line.match(/w\/(crlf|mixed)/)
    if (m) { eolBad++; if (eolBad <= 5) fail('eol', `工作区行尾 ${m[1]}：${line.split('\t').pop()}`) }
    const rel = line.split('\t').pop()
    if (rel) eolSeen.add(rel)
  }
  // ④ 补扫（二次复审 M-1）：`git ls-files --eol` **只见已跟踪文件**——未跟踪 / 被 ignore 的文件
  //   （它们可能按 `files` 白名单**随包发布**）不在其中。故对 scanSet 里未被上表覆盖的文本文件直接读盘检测。
  for (const p of scanSet.filter(isText)) {
    if (eolSeen.has(p)) continue
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    const buf = readFileSync(abs)
    if (buf.includes(0)) continue // 含 NUL = 二进制，跳过
    if (buf.toString('utf8').includes('\r\n')) {
      eolBad++
      if (eolBad <= 5) fail('eol', `工作区行尾 crlf/mixed（未跟踪）：${p}`)
    }
  }
  if (eolBad === 0) note('④ 行尾：无 w/crlf / w/mixed')
}
