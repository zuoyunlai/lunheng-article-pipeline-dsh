// 宿主契约产物探针的双向回归网（v18.76.0 新增 —— v18.75.1 全量架构审计 R3 修复）
//
// `scripts/host-contract-probe.mjs` 本身负责「在 CI 上红/绿」，本文件负责「双向自证」：喂它真产物
//   它必须绿；喂它篡改的产物它必须红并**指名变化点**。同时给 probeContracts() 一个反事实 fixture
//   让「宿主字段白名单漂移」「payload 键集合漂移」「版本不一致」三类故障各红一次。
//
// 为什么用**反事实 fixture**而不直接篡改仓库里的真实产物：本测试**零外部副作用**——即使失败也不
//   改任何宿主产物；下一次跑全量套时 CI 上 install 重置不会回退不到。报告 R3 DoD：
//   「故意篡改 host-contract.mjs 表项 → 门必须红」对应覆盖见 `tests/host-contract.test.mjs`；
//   「宿主升级导致契约变化 → 门红并指名变化点」对应覆盖见本文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  norm,
  resolveHostArtifacts,
  sliceMethodBody,
  probeContracts,
  REPO_ROOT,
} from '../scripts/host-contract-probe.mjs'
import {
  CONTRACT_HOST_VERSION,
  HOST_CONTRACT,
  HOST_DISPATCH,
  MATERIALIZE_WHITELIST,
} from '../scripts/_lib/host-contract.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const resolve = (pkg, rel = join('lib', 'index.js')) => {
  const { files } = resolveHostArtifacts(ROOT)
  return files[pkg]
}

const hasHost = existsSync(resolve('dsh-tools'))
const skipIfBare = hasHost ? test : test.skip

skipIfBare('探针能解析真宿主产物（dsh-tools/agent-loop/system-prompt）', () => {
  const { files, toolsVersion } = resolveHostArtifacts(ROOT)
  assert.ok(files['dsh-tools'], 'dsh-tools 解析失败（pnpm store 里查不到 @deepseek-ai+dsh-tools 兄弟目录）')
  assert.ok(files['dsh-agent-loop'], 'dsh-agent-loop 解析失败')
  assert.ok(files['dsh-system-prompt'], 'dsh-system-prompt 解析失败')
  assert.equal(toolsVersion, CONTRACT_HOST_VERSION, `实装 ${toolsVersion} ≠ 契约 ${CONTRACT_HOST_VERSION}`)
})

skipIfBare('真产物驱动探针 → 0 错误（绿）', () => {
  const { files, toolsVersion } = resolveHostArtifacts(ROOT)
  const src = (p) => (p ? readFileSync(p, 'utf8') : '')
  const out = probeContracts({
    toolsSrc: src(files['dsh-tools']),
    agentLoopSrc: src(files['dsh-agent-loop']),
    systemPromptSrc: src(files['dsh-system-prompt']),
    installedToolsVersion: toolsVersion,
  })
  assert.equal(out.errors.length, 0, `真产物应通过探针：${out.errors.join(' | ')}`)
})

test('反事实 R3-A：往 materializeFinalResult 里加一个 result.<新字段> → 探针红并指「新增/未登记」', () => {
  // 模拟「宿主升级、字段白名单新增了一个字段」的形态——探针必须捕获并指名。
  const toolsSrc = `
    function materializePresentation(c) { return c }
    function postExecute() {}
    function createSuccessResult() {}
    function normalizeDispatchResult() {}
    function init() {}
    class ToolRegistry {
      materializeFinalResult(result) {
        const presentation = {
          content: result.content,
          ...(result.meta !== void 0 ? { meta: result.meta } : {}),
          ...(result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}),
        }
        if (result.isError) return materializePresentation({ isError: true, error: result.error, ...presentation })
        return deepFreeze({
          ...materializePresentation({
            isError: false, ...presentation,
            ...result.concludesTurn === true ? { concludesTurn: true } : {},
            result.superNewField: 'x',
          }),
          value: result.value,
        })
      }
    }
  `
  const out = probeContracts({ toolsSrc, agentLoopSrc: '', systemPromptSrc: '', installedToolsVersion: CONTRACT_HOST_VERSION })
  const check = out.checks.find((c) => c.name === '字段白名单')
  assert.equal(check.ok, false, '字段白名单检查应红（result.superNewField 多余）')
  assert.match(check.detail, /新增\/未登记/, `应指「新增/未登记」：${check.detail}`)
  assert.match(check.detail, /superNewField/, `应指名变化点：${check.detail}`)
})

skipIfBare('反事实 R3-B：agent/request payload 多塞一个键 → 探针红并指「子串找不到归一化形态」', () => {
  // 在 dispatch 子串里加一个键，模拟宿主新增字段——HOST_DISPATCH 子串断言会红。
  // 喂**真** agent-loop 源码作为对照基线（只有另两个 src 空 → toolsSrc / systemPromptSrc 相关检查会
  // 因「产物缺失」红，不影响本断言的目标 = agent/request）。然后用一个明显篡改的 HOST_DISPATCH 让
  // `agent/request` 的归一化子串在真源码里找不到 → 红。
  const { files } = resolveHostArtifacts(ROOT)
  const agentLoopSrc = files['dsh-agent-loop'] ? readFileSync(files['dsh-agent-loop'], 'utf8') : ''
  const out = probeContracts({
    toolsSrc: '',
    agentLoopSrc,
    systemPromptSrc: '',
    installedToolsVersion: CONTRACT_HOST_VERSION,
    tables: {
      HOST_CONTRACT,
      MATERIALIZE_WHITELIST,
      CONTRACT_HOST_VERSION,
      HOST_DISPATCH: { ...HOST_DISPATCH, 'agent/request': '"agent/request", { turn, step, signal, tokenCount },' },
    },
  })
  const check = out.checks.find((c) => c.name === '派发形态 agent/request')
  assert.equal(check.ok, false, 'agent/request 派发形态应红（tables 被篡改）')
  assert.match(check.detail, /找不到归一化形态/, `应指派发形态：${check.detail}`)
  assert.match(check.detail, /tokenCount/, `应指名被多塞的键：${check.detail}`)
})

test('反事实 R3-C：本地版本与 CONTRACT_HOST_VERSION 不一致 → 探针红并指版本', () => {
  const out = probeContracts({ toolsSrc: '', agentLoopSrc: '', systemPromptSrc: '', installedToolsVersion: '0.99.0-rc.0' })
  const check = out.checks.find((c) => c.name === '探针目标版本')
  assert.equal(check.ok, false)
  assert.match(check.detail, /不得只改注释/, `应指版本不一致：${check.detail}`)
})

test('反事实 R3-D：HOST_CONTRACT 漏 since → 探针的「契约表自洽」守门红', () => {
  // 模拟「契约表加了新条目但忘了 since」——自洽检查应红。
  const tampered = {
    ...HOST_CONTRACT,
    'tools/post-execute': { ...HOST_CONTRACT['tools/post-execute'], since: undefined },
  }
  const out = probeContracts({
    toolsSrc: '',
    agentLoopSrc: '',
    systemPromptSrc: '',
    installedToolsVersion: CONTRACT_HOST_VERSION,
    tables: { HOST_CONTRACT: tampered, HOST_DISPATCH, MATERIALIZE_WHITELIST, CONTRACT_HOST_VERSION },
  })
  const check = out.checks.find((c) => c.name === '契约表 since tools/post-execute')
  assert.equal(check.ok, false, '漏 since 应红')
  assert.match(check.detail, /缺失或非 semver/, `应指 since 缺失：${check.detail}`)
})

test('sliceMethodBody：找到方法体 / 缺失方法体都安全', () => {
  const src = `class T {\n\tmaterializeFinalResult(result) {\n\t\tconst x = 1\n\t}\n}`
  assert.equal(typeof sliceMethodBody(src, 'materializeFinalResult(result) {'), 'string')
  assert.equal(sliceMethodBody(src, 'doesNotExist('), null)
})

test('norm：连续空白归一为单空格（含 tab / 换行）', () => {
  assert.equal(norm('a\tb\n\nc'), 'a b c')
  assert.equal(norm('a\n\n  b'), 'a b')
})
