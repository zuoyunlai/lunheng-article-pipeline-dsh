// ② JSON
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function run(ctx) {
  const { fail, note, ROOT, tracked } = ctx
  let jsons = 0
  for (const p of tracked.filter((f) => f.endsWith('.json'))) {
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    jsons++
    try { JSON.parse(readFileSync(abs, 'utf8')) } catch (e) { fail('json', `${p}: ${e.message}`) }
  }
  note(`② JSON：解析 ${jsons} 个 .json`)
}
