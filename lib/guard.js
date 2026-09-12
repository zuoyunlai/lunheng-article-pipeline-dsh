// 机制文件写保护（C 组 · v18.1.0）：用官方 `ctx.tools.guard()` 把「不得改机制文件」从**文档纪律**
// 升级为**机制否决**。
//
// 官方依据：`docs/subsystems/tools.md:313-324`
//   · `guard(guard: ToolGuard): () => void`；`ToolGuard = (execution) => string | undefined`；
//   · 返回值只会**收紧**权限（返回理由 = 否决，返回 undefined = 不改变），后面的监听器无法把它改回允许；
//   · 「A plain-context guard applies globally」——在插件（profile 级）ctx 上注册即全局生效。
//
// ⚠️ **边界（如实声明，不许夸大）**：
//   ① guard 只看**工具调用**。本包主流程里 `pwsh` 仍可以写文件（官方对子进程的围栏是部署级
//      `ctx.sandbox` 后端 / `sandbox/mode`，插件改不了别人的 profile）；官方也**没有** per-path 只读声明，
//      `fs/write-intent` 没有 deny 返回值。故本保护是「**比 prompt 强、比机制强制弱**」的部分强制。
//   ② 授权例外：主人显式授权修订机制文件时，在**宿主环境**设 `LUNHENG_ALLOW_MECH_EDIT=1`（或插件 Config
//      同名开关）即可放行——授权是主人的动作，不由 agent 自己声明。
//   ③ 只覆盖常见写工具名（不同版本的写工具名可能不同，故用集合匹配 + 参数键名匹配，宁松勿误伤）。
import { resolve, sep } from 'node:path'

const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'str_replace_editor', 'str-replace-editor', 'str_replace', 'multi_edit'])
const PATH_KEYS = ['path', 'file_path', 'filePath', 'target', 'filename', 'file', 'target_file']

/** 从工具参数里取出被写的路径（取第一个像路径的字符串）。 */
function writtenPath(args) {
  if (!args || typeof args !== 'object') return null
  for (const k of PATH_KEYS) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  // 有些编辑工具用数组（多文件编辑）：取第一项的 path/file_path
  for (const v of Object.values(args)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const hit = writtenPath(item)
        if (hit) return hit
      }
    }
  }
  return null
}

const inside = (abs, root) => abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep)

/**
 * 安装机制文件写保护。返回 disposer（未安装时返回 undefined）。
 * @param ctx - 插件 ctx（profile 级 → 全局 guard）。
 * @param opts.mechanismRoots - 受保护路径（绝对）：技能目录 + 包级 patch/入口目录。
 * @param opts.allowed - () => boolean：主人授权时为 true（env/Config）。
 */
export function installMechanismGuard(ctx, { mechanismRoots, allowed }) {
  const tools = ctx.get('tools')
  if (!tools?.guard) return undefined
  const roots = mechanismRoots.filter(Boolean).map((r) => resolve(r))
  if (roots.length === 0) return undefined
  return tools.guard((execution) => {
    try {
      if (allowed?.()) return undefined
      const name = String(execution?.name || '')
      if (!WRITE_TOOLS.has(name)) return undefined
      const raw = writtenPath(execution?.arguments)
      if (!raw) return undefined
      const abs = resolve(raw)
      const hit = roots.find((r) => inside(abs, r))
      if (!hit) return undefined
      return (
        `论衡机制文件写保护（v18.1.0，机制级否决）：${abs} 位于技能包内（受保护根：${hit}），` +
        '主控与子代理默认均不得写入。改进动议请写入 audits/反哺报告-vN.md，由主人在 host shell 审阅后 apply；' +
        '若主人已显式授权本次修订，请在宿主环境设 LUNHENG_ALLOW_MECH_EDIT=1 后重试。' +
        '（提示：本保护只覆盖 write/edit 类工具，pwsh 不经此门——见 SKILL.md §执行能力边界）'
      )
    } catch {
      return undefined // guard 自身异常不改变权限（宁松勿误伤）
    }
  })
}
