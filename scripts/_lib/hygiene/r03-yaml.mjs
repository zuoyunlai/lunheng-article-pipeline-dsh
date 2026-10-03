// ③ YAML 结构健全（**不引入解析器依赖**：禁制表符缩进 + 关键文件预期键 + 流量式括号配平）
// ⚠️ **为什么不上解析器（v18.62.4 · 全量审计-v18.62.3 §8.2 #29，主人裁定）**：
//   引入 `yaml` 会让**发布物首次带上运行时依赖**（本包当前零 `dependencies`），属包形态/信任面变更；
//   而「关键结构」已由下方 needKeys 与 `tests/` 的结构断言覆盖。故走**零依赖加固**——
//   **只收窄「不是解析器」的范围，不假装是解析器**。
// ⚠️ **加固过程中我实测否决了一个判据（如实留痕）**：我原本还加了「**重复键**」检测
//   （YAML 后者覆盖前者、静默丢值），但按「缩进 + 键名」构建父路径时**连续产生大量假报**：
//   · 只用一层缩进 → `drift-check`（:18）与 `hygiene`（:64）两个 job 的 `runs-on`/`steps` 被当成重复（6 条假报）；
//   · 改成完整父路径后 → **序列项**（`steps:` 下的 `- run:` / `- id:`）仍被当成重复（40+ 条假报），
//     因为 `run:` 在不同**列表项**里合法重复，而「同一个列表项内」这个粒度**行级做不到**。
//   **判据：会产生假警的门比没有这条检查更糟——它劝人去改对的东西。** 故**删掉该判据**，
//   把「重复键 / 缩进块归属 / 锚点别名」如实列为**零依赖做不到、需解析器或人工 review** 的范围。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function run(ctx) {
  const { fail, note, ROOT, tracked } = ctx
  const yamls = tracked.filter((f) => /\.(ya?ml)$/.test(f))
  const yamlFails = []
  for (const p of yamls) {
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8')
    text.split('\n').forEach((l, i) => {
      if (/^\t/.test(l)) fail('yaml', `${p}:${i + 1} 缩进使用制表符（YAML 禁止）`)
      // 流量式 `[` / `{` 未闭合——**明确可靠**：YAML 里方括号必须成对（GHA 的 `branches: [main, dev]` 等）。
      //   这类错会让 GitHub **静默不跑该 workflow**，正是审计点名的场景。
      const openB = (l.match(/\[/g) || []).length, closeB = (l.match(/\]/g) || []).length
      const openC = (l.match(/\{/g) || []).length, closeC = (l.match(/\}/g) || []).length
      if (openB !== closeB) yamlFails.push(`${p}:${i + 1} 方括号不配平（[ ${openB} / ] ${closeB}）——流量式序列写法有误，GitHub 会静默不跑该 workflow`)
      if (openC !== closeC) yamlFails.push(`${p}:${i + 1} 花括号不配平（{ ${openC} / } ${closeC}）——流量式映射写法有误`)
    })
  }
  for (const d of yamlFails.slice(0, 8)) fail('yaml', d)
  if (yamlFails.length > 8) fail('yaml', `另有 ${yamlFails.length - 8} 处未逐条列出`)
  const needKeys = {
    'cordis.patch.yml': ['insert:', 'dsh'],
    'examples/preset/preset.yml': ['name:', 'description:'],
    '.github/workflows/ci.yml': ['jobs:', 'runs-on:'],
    '.github/workflows/publish.yml': ['jobs:', 'runs-on:'],
  }
  for (const [rel, keys] of Object.entries(needKeys)) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) { fail('yaml', `关键 YAML 缺失：${rel}`); continue }
    const text = readFileSync(abs, 'utf8')
    for (const k of keys) if (!text.includes(k)) fail('yaml', `${rel}: 缺预期键「${k}」`)
  }
  note(`③ YAML：结构检查 ${yamls.length} 个（含 4 个关键文件的预期键）`)
}
