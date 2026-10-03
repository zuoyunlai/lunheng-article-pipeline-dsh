// ⑤ UTF-8
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isText } from './_shared.mjs'

export function run(ctx) {
  const { fail, note, ROOT, scanSet } = ctx
  let utf8Checked = 0
  let replacementHits = 0
  const dec = new TextDecoder('utf-8', { fatal: true })
  for (const p of scanSet.filter(isText)) {
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    utf8Checked++
    try { dec.decode(readFileSync(abs)) } catch { fail('utf8', `${p}: 非法 UTF-8（可能是 GBK 等本地编码）`) }
    // v18.0.5 新增（教训：本轮修订中我用 PowerShell `Get-Content|Set-Content` 往返改 preset.yml，
    //   把文件写成了本地编码 → 规则⑤（fatal 解码）**确实抓到了**；但**同一类事故的更隐蔽形态**是
    //   「已经是合法 UTF-8、却含 U+FFFD 替换字符」——那是不可逆的字符丢失，解码不会报错，
    //   scan 起来像正常文本。故加这一条：任何文本文件不得含 U+FFFD（`\uFFFD`）。
    const text = readFileSync(abs, 'utf8')
    const n = (text.match(/\uFFFD/g) || []).length
    if (n > 0) {
      replacementHits += n
      const line = text.split('\n').findIndex((l) => l.includes('\uFFFD')) + 1
      fail('utf8-replacement', `${p}:${line}: 含 ${n} 个 U+FFFD 替换字符（字符已丢失，通常是编码往返转换造成——请从 git blob 或备份恢复该文件，不要手改）`)
    }
  }
  note(`⑤ 编码：UTF-8 校验 ${utf8Checked} 个文本文件${replacementHits === 0 ? '（无 U+FFFD 替换字符）' : `（❗ 命中 U+FFFD ${replacementHits} 处）`}`)
}
