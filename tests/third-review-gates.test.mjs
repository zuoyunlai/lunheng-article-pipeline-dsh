// 三次复审（v18.21.0 DSH 宿主契约向）N-1 / N-2 / N-3 / N-4 的回归网。
//
// 为什么需要：这四项的共同形态是「**声明面与真实行为脱节，而没有任何东西会红**」——
//   · N-1：按文档装到的可能是**陈旧 5 个版本**的构建，而入口不打版本、文档也无核对步骤 → 无从察觉；
//   · N-2：`--dump-config` 是**声明视图**（不反映 `disabled` 裁剪），而文档却把它列为「验证分档」的判据；
//   · N-3：同一外部 CLI 在 `scripts/plugin-surface-check.mjs` 与 `.github/workflows/ci.yml` 各有一处 pin
//     （v18.20.2 抬 pin 时只改了一处 → 分叉），且无门守护；
//   · N-4：`peerDependencies` 声明宽于 CI 实测证据，而「已知不兼容」只写在 workflow 注释里（用户看不到）。
// 本文件把四条钉在**行为/产物**上（不靠源文本字面量断言）：入口真跑出带版本的状态行、文档真含免责说明、
//   CI 真用单点派生、文档真写了宿主已知缺陷。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withCapturedConsole } from './_fixtures.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

// ── N-1③：入口启动行必须**真**打出带版本号的状态行（行为断言）────────────────────
test('N-1③ 入口真跑：启动状态行含本包版本号（「装错了要看得见」）', async () => {
  const { apply } = await import('../lib/index.js')
  const version = JSON.parse(read('package.json')).version
  const registered = []
  const ctx = {
    skills: { register: (s) => { registered.push(s); return () => {} } },
    effect: (fn) => { fn(); return () => {} },
  }
  const { texts } = await withCapturedConsole(async () => {
    apply(ctx, undefined)
    await new Promise((r) => setTimeout(r, 120)) // 让 ctx.effect 里的异步安装跑完（失败也已被 catch）
  })
  assert.ok(registered.length >= 1, '入口必须完成技能注册（前置）')
  assert.ok(
    texts.some((t) => t.includes(`论衡 v${version}`)),
    `启动行必须含版本号 \`论衡 v${version}\`——装到陈旧构建时这是唯一的自证线索。实测输出：${texts.join(' ｜ ').slice(0, 400)}`,
  )
})

// ── N-2：文档不得把 dump 说成能判别装载态；且必须含显式免责 ──────────────────────
test('N-2 installation.md：§验证 不得声称 dump 能判别装载态，且必须写明它不反映装载', () => {
  const doc = read('docs/installation.md')
  assert.ok(
    /不反映装载态/.test(doc),
    '§验证 必须显式写明 `--dump-config` 是「声明视图、不反映装载态」——否则读者会把三档工具行读成分档已生效',
  )
  assert.ok(
    !/三档工具行应出现在组合树中/.test(doc),
    '旧的误导措辞「三档工具行应出现在组合树中」必须删掉（实测 dump 对 LUNHENG_TIERING 三种取值都输出 3 行，不可判别）',
  )
  assert.ok(
    /不可区分/.test(doc),
    '必须写明「三种取值下不可区分」——这是该断言不敏感的直接证据',
  )
})

// ── N-3：CI 必须从唯一 pin 点派生，且不得再硬编码 ────────────────────────────────
test('N-3 ci.yml：loader-smoke 从 --print-cli-spec 派生，不得再硬编码 CLI 版本', () => {
  const ci = read('.github/workflows/ci.yml')
  assert.ok(
    ci.includes('plugin-surface-check.mjs --print-cli-spec'),
    'loader-smoke 必须用 `node scripts/plugin-surface-check.mjs --print-cli-spec` 派生 CLI 版本（单点真源）',
  )
  assert.ok(
    !/dsh-plugin-guide@\d+\.\d+\.\d+/.test(ci),
    'ci.yml 不得再出现硬编码的 `dsh-plugin-guide@<semver>`——两处 pin 会分叉（N-3 实测：发布门 0.3.19 / CI 0.3.16）',
  )
})

// ── N-3（配）：单点真源本身必须可导出、且真打印出 pin ─────────────────────────────
test('N-3 单点真源：plugin-surface-check 导出 CLI_SPEC，--print-cli-spec 真打印它', async () => {
  const mod = await import('../scripts/plugin-surface-check.mjs')
  assert.match(mod.CLI_SPEC, /^dsh-plugin-guide@\d+\.\d+\.\d+$/, `CLI_SPEC 形状应可被 dlx 直接用，实测 ${mod.CLI_SPEC}`)
})

// ── N-3（v18.21.1 收紧）：pin 必须是**唯一权威**，本地副本版本对不上时不得抢在 dlx 之前 ─────────
// 为什么：N-3 只解决了「两处 pin 分叉」，但**第二处分叉在解析层**——本机 profile 副本一旦被抬到
//   pin 之上（v18.20.2 实测 0.3.19 / pin 0.3.16），本地门就跑另一份语义，而旧判定被策略标签里的
//   版本号短路成静默（`!hinted` 条件）→ 「本地全绿 CI 红」的经典形态复活。本用例钉**顺序**。
test('N-3b pin 权威：版本==pin 的副本走快路径；版本≠pin 的副本降级为兜底（排在 dlx 之后）', () => {
  const home = mkdtempSync(join(tmpdir(), 'lh-cli-pin-'))
  try {
    for (const [profile, version] of [['aligned', '0.3.16'], ['stale', '0.3.19']]) {
      const dir = join(home, 'profiles', profile, 'node_modules', 'dsh-plugin-guide')
      mkdirSync(join(dir, 'bin'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-plugin-guide', version }))
      writeFileSync(join(dir, 'bin', 'dsh-plugin-dev.js'), '// 用例桩：本文件不执行，只用于让策略可见')
    }
    const raw = execFileSync(
      process.execPath,
      [join(ROOT, 'scripts', 'plugin-surface-check.mjs'), '--print-strategies'],
      { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8' },
    )
    const labels = JSON.parse(raw).map((s) => s.label)
    const iAligned = labels.findIndex((l) => l.includes('aligned'))
    const iDlx = labels.findIndex((l) => l.startsWith('pnpm dlx'))
    const iStale = labels.findIndex((l) => l.includes('stale'))
    assert.ok(iAligned >= 0 && iDlx >= 0 && iStale >= 0, `三条策略都应可见，实测：${labels.join(' ｜ ')}`)
    assert.ok(iAligned < iDlx, `与 pin 同版本的本地副本应排在 dlx 之前（零下载快路径），实测：${labels.join(' ｜ ')}`)
    assert.ok(
      iStale > iDlx,
      `与 pin 版本不一致的副本必须排在 dlx 之后——否则「本地门一份语义、CI 门另一份」会再次静默分叉。实测顺序：${labels.join(' ｜ ')}`,
    )
  }
  finally { rmSync(home, { recursive: true, force: true }) }
})

// ── N-3（配·v18.21.1）：pin 与「文档里的门数」必须同源（0.3.16 = 14 项 / 0.3.19 = 15 项）─────────
// 为什么：v18.20.2 抬 pin 时项数从 14 改到 15；v18.21.1 回退 pin 又得改回 14——**同一事实两处维护**
//   正是本仓标志性毛病。现把项数收进 CLI_CHECK_COUNT（单一来源），用例把 AGENTS.md 的三处口径
//   焊死在它上面：抬 pin 时改一个常量即可，文档漏改即红。
test('N-3c 门数同源：AGENTS.md 的 check 项数（三处）== CLI_CHECK_COUNT，且与 pin 版本自洽', async () => {
  const mod = await import('../scripts/plugin-surface-check.mjs')
  assert.equal(
    mod.CLI_PIN_VERSION,
    /@(\d+\.\d+\.\d+)$/.exec(mod.CLI_SPEC)?.[1],
    `CLI_PIN_VERSION 必须从 CLI_SPEC 派生（实测 CLI_SPEC=${mod.CLI_SPEC} / CLI_PIN_VERSION=${mod.CLI_PIN_VERSION}）`,
  )
  const agents = read('skills/lunheng-article-pipeline/AGENTS.md')
  const mentioned = [...agents.matchAll(/dsh-plugin-dev check`[^\n]{0,30}?(\d+) 项/g)].map((m) => Number(m[1]))
  assert.ok(mentioned.length >= 3, `AGENTS.md 至少三处声明 check 项数，实测命中 ${mentioned.length} 处`)
  for (const n of mentioned) {
    assert.equal(
      n,
      mod.CLI_CHECK_COUNT,
      `AGENTS.md 写「${n} 项」与 CLI_CHECK_COUNT=${mod.CLI_CHECK_COUNT}（pin ${mod.CLI_SPEC}）不一致——抬/降 pin 必须同步改常量与文档`,
    )
  }
})

// ── N-4：宿主已知缺陷必须写在**用户看得到**的文档里（而非 workflow 注释）─────────
test('N-4 installation.md：写明 peer 区间宽于实测证据 + 已知宿主不兼容与规避', () => {
  const doc = read('docs/installation.md')
  assert.ok(/peerDependencies/.test(doc) && /0\.1\.7-rc\.2/.test(doc), '必须写明 peer 声明与**实际只测过**的宿主版本')
  assert.ok(
    /requires the Cordis HMR service/.test(doc),
    '必须写出已知不兼容的具体症状（0.1.5-rc.2/rc.3 的 app-boot HMR 守卫）——只写在 ci.yml 注释里用户看不到',
  )
  assert.ok(/规避/.test(doc), '必须给出规避路径（用 0.1.7-rc.2 及以上 / 避开 headless 启动）')
})
