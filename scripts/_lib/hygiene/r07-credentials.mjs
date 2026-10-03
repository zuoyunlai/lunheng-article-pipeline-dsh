// ⑦ 凭据扫描（v2.5.2-dsh.13 新增）：零依赖实现，取代引入第三方扫描 action——
//    与仓库「零运行时依赖」哲学一致，且不扩大 CI 的供应链面（本项目 action 已全部 pin SHA）。
//    注意：本文件自身含模式字面量，扫描时跳过自身。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isText } from './_shared.mjs'

export function run(ctx) {
  const { fail, note, ROOT, scanSet, SELF } = ctx
  const SECRET_PATTERNS = [
    ['npm token', /npm_[A-Za-z0-9]{30,}/],
    ['GitHub PAT（classic）', /ghp_[A-Za-z0-9]{30,}/],
    ['GitHub PAT（fine-grained）', /github_pat_[A-Za-z0-9_]{30,}/],
    ['OpenAI 风格 key', /sk-[A-Za-z0-9]{20,}/],
    ['AWS Access Key ID', /AKIA[0-9A-Z]{16}/],
    ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
    ['GitLab PAT', /glpat-[A-Za-z0-9_-]{15,}/],
    ['HuggingFace token', /hf_[A-Za-z0-9]{30,}/],
    ['私钥块', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['npmrc _authToken', /_authToken\s*=\s*\S{20,}/],
  ]
  const scanned = scanSet.filter(isText).filter((p) => p !== SELF)
  let secretHits = 0
  for (const p of scanned) {
    const abs = join(ROOT, p)
    if (!existsSync(abs)) continue
    readFileSync(abs, 'utf8').split('\n').forEach((l, i) => {
      for (const [label, re] of SECRET_PATTERNS) {
        const m = l.match(re)
        if (m) {
          secretHits++
          // 只输出掩码前缀——绝不把疑似凭据原文写进 CI 日志/annotation（日志本身就是泄漏面）
          fail('secret', `${p}:${i + 1} 疑似凭据（${label}）：${m[0].slice(0, 6)}…（已掩码）——请轮换该凭据并改用环境变量 / GitHub Secrets`)
        }
      }
    })
  }
  note(`⑦ 凭据扫描：${scanned.length} 个文本文件 × ${SECRET_PATTERNS.length} 类模式${secretHits ? '（命中 ' + secretHits + '）' : '，无命中'}`)
}
