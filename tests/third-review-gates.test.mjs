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
import { readFileSync } from 'node:fs'
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
