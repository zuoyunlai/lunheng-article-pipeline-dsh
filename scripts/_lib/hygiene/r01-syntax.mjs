// ① 语法：node --check（v18.1.0 起含 .js）
//   v18.1.0 扩面的动机（自查发现的缺口）：入口与 C 组新增的 `lib/*.js` 此前**不被任何静态门做语法检查**
//   （规则①只扫 .mjs），它们唯一的下场是「被测试 import」——而裸仓库/CI 里 `lib/index.js` 由
//   `tests/entry.test.mjs` 覆盖、`lib/tools.js` 等**只在有宿主包时才被装载**，语法错会静默潜伏。
//   兼容性：文件是 ESM（包内 `"type":"module"`），Node ≥12 会按最近的 package.json 解析模块类型；
//   万一某版本 `--check` 仍按 CJS 解析（报 "Cannot use import statement outside a module"），
//   退化为「复制成临时 .mjs 再 check」——不引入版本假设。
//   v18.1.0 加一条：扫描集 = git 跟踪文件 **∪ 未跟踪但未被 ignore 的文件**。理由（真实不对称）：
//   `npm pack` 按 package.json 的 `files` 白名单取盘上文件，**包含尚未 git add 的新文件**——
//   即「新写的脚本能被打进发布物、却逃过规则①的语法检查」。
import { readFileSync, existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function run(ctx) {
  const { fail, note, ROOT, scanSet, untracked } = ctx
  let checked = 0
  let mjs = 0
  for (const p of scanSet.filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))) {
    if (!existsSync(join(ROOT, p))) continue
    checked++
    if (p.endsWith('.mjs')) mjs++
    const r = spawnSync(process.execPath, ['--check', join(ROOT, p)], { encoding: 'utf8' })
    if (r.status === 0) continue
    const err = r.stderr || ''
    const esmAsCjs = /import statement outside a module|Unexpected token 'export'|Cannot use import statement/.test(err)
    if (p.endsWith('.js') && esmAsCjs) {
      const d = mkdtempSync(join(tmpdir(), 'lh-syntax-'))
      try {
        const tmp = join(d, 'probe.mjs')
        copyFileSync(join(ROOT, p), tmp)
        const r2 = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' })
        if (r2.status === 0) continue
        fail('syntax', `${p}: ${(r2.stderr || '').split('\n').slice(0, 2).join(' / ')}`)
        continue
      } finally { rmSync(d, { recursive: true, force: true }) }
    }
    fail('syntax', `${p}: ${err.split('\n').slice(0, 2).join(' / ')}`)
  }
  note(`① 语法：检查 ${checked} 个脚本（.mjs ${mjs} + .js ${checked - mjs}${untracked.length ? `；含未跟踪 ${untracked.length} 个（npm pack 会打包它们）` : ''}）`)
}
