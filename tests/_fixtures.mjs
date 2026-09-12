// 测试夹具公共模块（v18.0.5 抽取：冗余审计 §二.4）
//
// 来源：`audits/论衡冗余审计-v1.md` §二.4 —— 「`tmp()`/`rmSync` 生命周期 94 行；项目骨架 5 行块重复 20 处；
// 同一份『五节文末 + [L01]』定稿夹具逐字 13 次；3 份同物夹具生成器；e2e 与 scripts.test 逐字重叠 55 行」。
// 本模块只放**夹具与运行器**，不放断言：断言仍留在各自的 `*.test.mjs` 里（抽取不减少任何断言）。
//
// 使用：`import { ROOT, SCRIPTS, run, parseJson, tmp, mkProject, mkRepo, MD, mkSvg, DRAFT_WITH_ENDNOTES, CARD } from './_fixtures.mjs'`
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SCRIPTS = join(ROOT, 'skills', 'lunheng-article-pipeline', 'scripts')

// 跑一个随包脚本：返回 exit code + 合并输出 + 分离的 stdout/stderr（v18.0.5 起两个测试文件共用同一实现）
// opts.env 可整体替换子进程环境（用于 spawn 失败 / 缺环境变量等场景）
export const run = (args, opts = {}) => {
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: opts.cwd || ROOT,
    ...(opts.env ? { env: opts.env } : {}),
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '' }
}
export const parseJson = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
export const tmp = (prefix = 'lunheng-test-') => mkdtempSync(join(tmpdir(), prefix))

// 项目骨架：`<tmp>/run/proj/{final/证据包, [analysis], [audits], [drafts], [extra…]}`。
//   默认只建证据包（绝大多数用例的最小骨架）；需要额外目录时用开关，避免每个用例各写一遍 mkdirSync。
export const mkProject = ({ analysis = false, audits = false, drafts = false, extra = [], prefix } = {}) => {
  const d = tmp(prefix)
  const proj = join(d, 'run', 'proj')
  const fin = join(proj, 'final')
  const ev = join(fin, '证据包')
  const aud = join(proj, 'audits')
  mkdirSync(ev, { recursive: true })
  if (analysis) mkdirSync(join(proj, 'analysis'), { recursive: true })
  if (audits) mkdirSync(aud, { recursive: true })
  if (drafts) mkdirSync(join(proj, 'drafts'), { recursive: true })
  for (const dir of extra) mkdirSync(join(proj, dir), { recursive: true })
  return { d, proj, fin, ev, aud }
}

// 仓库骨架（consistency-check / pack-smoke 等「仓库级门」的注入用例专用）
//   · 默认只复制门所需的最小集（技能体 + 包级清单）——多数用例够用、跑得快
//   · `full: true` 复制整仓（除 .git / node_modules / *.tgz）——供 `pack-smoke.mjs` 这类
//     需要 lib/ + repo scripts/ + files 白名单里全部产物的门使用（v18.0.5 新增）
export const mkRepo = ({ extraFiles = [], readme = false, full = false } = {}) => {
  const d = tmp()
  const repo = join(d, 'repo')
  mkdirSync(repo, { recursive: true })
  if (full) {
    cpSync(ROOT, repo, {
      recursive: true,
      filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) && !/[\\/]node_modules([\\/]|$)/.test(src) && !src.endsWith('.tgz'),
    })
  } else {
    cpSync(join(ROOT, 'skills'), join(repo, 'skills'), { recursive: true })
    const files = ['package.json', 'CHANGELOG.md', 'cordis.patch.yml', ...(readme ? ['README.md'] : []), ...extraFiles]
    for (const f of files) cpSync(join(ROOT, f), join(repo, f))
  }
  return { d, repo, R: join(repo, 'skills', 'lunheng-article-pipeline') }
}

// 图件链路用例的标准定稿：两个块级图位
export const MD = '# 标题\n\n## 摘要\n\n正文。\n\n[图1：趋势]\n\n中间段。\n\n[图2：占比]\n\n结尾。\n'
export const mkSvg = (marker) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500"><text x="10" y="20">${marker}</text></svg>\n`

// 「五节文末 + [L01][L02][L03][D01]」定稿（端到端与 M 门用例共用同一份夹具，避免逐字抄 13 次）
export const DRAFT_WITH_ENDNOTES = (bodyTail = '') => '# 标题\n\n## 摘要\n\n正文 [L01] [L02] [L03] [D01]。\n\n## 一、导论\n\n'
  + '段落内容。'.repeat(30) + bodyTail
  + '\n\n## 参考文献\n\n[L01] a\n[L02] b\n[L03] c\n\n## 数据来源\n\n[D01] d\n\n## 案例来源\n\n## 先行者文献\n\n## AI 使用声明\n\nAI。\n'

// 素材卡夹具：索引段 + 正文条目（`信任级别：已发布` 为机检硬格式要求）
export const CARD = (name, ids) => `# ${name}\n\n## 📇 索引段\n\n`
  + ids.map((id) => `[${id}] 主题 ｜ 论点1`).join('\n')
  + '\n\n## 正文\n\n' + ids.map((id) => `### [${id}] 条目\n信任级别：已发布\n`).join('\n')

// 便捷写入：`writeDraft(fin, body)` 等高频组合（保持与手写 writeFileSync 完全一致的落盘形态）
export const writeFixture = (path, content) => { writeFileSync(path, content) }
