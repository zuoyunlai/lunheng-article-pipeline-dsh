// _shared.mjs —— repo-hygiene-check 子模块共享工具（批5-3 · 纯函数）
//   抽出来是为每条规则模块共享，避免在 15 个 .mjs 里复制同一组工具。
//   零行为变化：所有函数与原 repo-hygiene-check.mjs 内联实现**逐字等价**。

import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 文本文件判定（原文件 :77）：非二进制扩展名即视为文本 */
export const isText = (p) => !/\.(png|jpe?g|gif|webp|pdf|tgz|zip|ico|woff2?|ttf|eot|mp4|mp3)$/i.test(p)

/** 字节→人类可读 KB（`kb(n)`，原文件 :696） */
export const kb = (n) => `${(n / 1024).toFixed(1)} KB`

/**
 * 递归 walk 一个目录，把 .md 文件的相对路径收集起来。
 * ⑨ 用：覆盖未登记的胖文档（原文件 :855-866）。
 * ⑩ 用：版本注解密度（原文件 :898-917）—— 不带 .md 过滤，调用方按扩展名筛。
 */
export const walkMd = (dir) => {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (e.name.endsWith('.md')) out.push(f)
    }
  }
  walk(dir)
  return out
}

/**
 * ⑩ 用：递归遍历 references 目录，调用方传入谓词决定收哪些文件（原文件 :898-917）。
 * 与 walkMd 的区别：此函数把遍历与过滤合一，避免在调用方再 walk 一次。
 */
export const walkDir = (dir, accept) => {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (accept(e.name, p)) out.push(p)
    }
  }
  walk(dir)
  return out
}

/** ⑩ 用：相对仓库根的 POSIX 路径（原文件 :914, :915） */
export const toRepoPosix = (abs, ROOT) => relative(ROOT, abs).split(sep).join('/')
