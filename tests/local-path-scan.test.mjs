// 本机绝对路径扫描器回归网（v18.18.4 新增 · 审计 D-2②）
//
// 为什么需要：规则⑦ 只扫**凭据形态**，对「路径」这类可避免的信息泄露完全无感——
// 审计 D-2 实测发布物里写着 `E:\<本机根>\…`（一处还带内部项目目录名与内部审计报告名），
// 而⑦ 照打印「无命中」。内容已在早前批次改占位符；本文件钉住的是**防复发的扫描口径**。
//
// 本文件同时钉住「**不过宽**」——第一版把 `C:\repo` / `D:\data\x.xlsx` 这类**示例占位**
// 也算命中，门一上来就红；而红的原因是文档在教读者填自己的值，属正当写法。
// 会被正当写法触发的门，结局只有一个：被关掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanLocalPaths, LOCAL_PATH_BASELINE, LOCAL_PATH_PATTERNS } from '../scripts/_lib/local-path-scan.mjs'
import { readPackManifest, isPackEnvUnavailable } from '../scripts/_lib/pack-manifest.mjs' // M-2/O-3：pack 清单单点解析

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('命中：真实用户名 / 本机工作根 / 备份目录 三类机器指纹', () => {
  const cases = [
    ['C:\\Users\\Zuoyunlai\\.dsh\\skills', 'win-user-home'],
    ['E:\\HERNESS\\lunheng-article-pipeline-dsh', 'machine-root'],
    ['C:\\Users\\Zuoyunlai\\.dsh\\_backup\\lunheng-cgaudit-20260925', 'backup-dir'],
    ['/home/zuoyunlai/work/x', 'posix-home'],
    ['/Users/zuoyunlai/work/x', 'mac-home'],
  ]
  for (const [sample, id] of cases) {
    const hits = scanLocalPaths(sample)
    assert.ok(hits.length > 0, `应命中但漏了：${sample}`)
    assert.ok(hits.some((h) => h.id === id), `${sample} 应以 ${id} 命中，实际 ${hits.map((h) => h.id).join(',')}`)
  }
})

test('放行：尖括号占位写法（文档在教读者填自己的值，不是泄露）', () => {
  const ok = [
    'C:\\Users\\<用户>\\AppData\\Local\\Temp\\dsh-<随机后缀>',
    'C:\\Users\\<你>\\.dsh\\_backup\\x',
    'C:\\Users\\<user>\\.dsh',
    'cd C:\\Users\\<username>\\x',
  ]
  for (const s of ok) {
    assert.deepEqual(scanLocalPaths(s), [], `占位写法被误判为泄露：${s}`)
  }
})

test('放行：通用示例路径（无机器指纹、无用户名）——防门过宽', () => {
  const ok = [
    'C:\\repo + C:\\tmp\\x.md → C:\\repo\\C:\\tmp\\x.md', // 代码注释里讲 bug 的通用记法
    '| 1 | `D:\\writings\\旧作一.md` | 公众号深度 |', // 模板示例
    '| 1 | `D:\\data\\某市教师问卷.xlsx` |', // 模板示例
    '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless', // 真实系统路径，但不指向作者
  ]
  for (const s of ok) {
    assert.deepEqual(scanLocalPaths(s), [], `通用示例被误判为泄露：${s}`)
  }
})

test('棘轮基线形态：键非空、值为正整数', () => {
  const keys = Object.keys(LOCAL_PATH_BASELINE)
  assert.ok(keys.length > 0, '基线不应为空——空基线会让下面「真实树」用例恒真')
  for (const [k, v] of Object.entries(LOCAL_PATH_BASELINE)) {
    assert.ok(k.length > 0 && !k.startsWith('/') && !k.includes('\\'), `基线键应为仓库相对 POSIX 路径：${k}`)
    assert.ok(Number.isInteger(v) && v > 0, `${k} 的上限应为正整数，实测 ${v}`)
  }
  assert.ok(LOCAL_PATH_PATTERNS.length >= 4, '模式数过少——可能被误删')
})

test('真实树：发布物零命中，且非随包命中数不超过棘轮（防「门自己写了恒真断言」）', (t) => {
  let packed
  try {
    packed = new Set(readPackManifest(ROOT).files) // M-2/O-3：单点解析器（数组 ≤npm11 / 对象 npm12+）
  } catch (e) {
    // O-5 / M-2 修法 4：**按错误类型分流**——只有「环境不可用」才 skip（node:test 会记 skip，可见）；
    //   形状不认识（PackManifestShapeError）一律**照抛**。旧写法 `catch { return }` 会把 npm 12 对象
    //   形态的 TypeError 当「环境不可用」吞掉 = 用例报 ✔（静默 pass），本文件的反恒真断言（下一行）永不执行。
    if (isPackEnvUnavailable(e)) return t.skip('受限会话禁子进程 / npm 不可用')
    throw e
  }
  assert.ok(packed.size > 100, `pack 清单过少（实测 ${packed.size}）——派生失败会让本断言恒真`)

  const shipped = []
  const overCap = []
  let scannedFiles = 0
  for (const rel of [...packed]) {
    if (!/\.(md|mjs|js|yml|json)$/.test(rel)) continue
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) continue
    scannedFiles++
    const hits = scanLocalPaths(readFileSync(abs, 'utf8'))
    if (hits.length) shipped.push(`${rel} → ${hits[0].text}`)
  }
  assert.ok(scannedFiles > 100, `实际扫到的发布物文件过少（${scannedFiles}）`)
  assert.deepEqual(shipped, [], `发布物含本机绝对路径（一条都不许有）：\n${shipped.join('\n')}`)

  for (const [rel, cap] of Object.entries(LOCAL_PATH_BASELINE)) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) continue
    const n = scanLocalPaths(readFileSync(abs, 'utf8')).length
    if (n > cap) overCap.push(`${rel}: ${n} > ${cap}`)
  }
  assert.deepEqual(overCap, [], `以下文件的本机绝对路径超过棘轮上限：\n${overCap.join('\n')}`)
})
