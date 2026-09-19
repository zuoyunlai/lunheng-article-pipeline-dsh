// 命令行参数解析（唯一实现，v18.2.6 新增：第三方审计 B-4 及其同族）
//
// 为什么必须抽出来（不是"整洁"问题，是缺陷复发问题）：
//   审计 B-4 的实测事实是 `apply-diff --dry-rnu` **exit 0 且被静默忽略**（用户以为在试运行，实际会落盘）、
//   `--out`（缺值）被静默接受后回落到输入正文。修 B-4 时给 apply-diff 写了严格解析，而**同一仓库**的
//   build-evidence-bundle 仍是 `args.includes('--summary')` 式的宽松解析——拼错的 `--sumary` 依然静默忽略
//   （用户以为只出摘要，实际拿到全量；`--sorce` 同理 → 以为指定了源，实际用了默认源）。同一类"静默降级"
//   在一个仓库里出现两次，说明**守卫写在调用处就一定会漂**。故本模块是"旗标/值/位置参数"解析的唯一实现。
//
// 口径（两条脚本共用，保持一致）：
//   · 未知 `-` 开头 token → 报错（含已知旗标清单 + 如何写带值旗标）
//   · 带值旗标缺值（是最后一个 token，或下一个 token 又是旗标）→ 报错
//   · 位置参数个数越界 → 报错
//   报错一律**抛 UsageError**（`code = USAGE_CODE`）；「打印用法 + exit 10」由调用方做——理由有两条：
//   ① 退出码是各脚本与主控之间的契约，留在调用处才一眼可见；
//   ② `scripts/repo-hygiene-check.mjs` 的退出码门是**按文件**静态解析 `process.exit(...)` 字面量与常量的，
//      把 exit 藏到 `_lib` 里会让那条门看不见它（宁可多 3 行，也不要让守卫脱离校验）。
//
// 用法：
//   import { parseArgs, USAGE_CODE } from './_lib/cli-args.mjs';
//   const usageExit = (why) => { console.error(why); console.error(USAGE); process.exit(10); };
//   let flags, opts, positionals;
//   try { ({ flags, opts, positionals } = parseArgs(argv, { flags: ['--dry-run'], values: { '--out': 'drafts/初稿-v4.md' }, minPositionals: 2, maxPositionals: 2, positionalHint: '<目标正文.md> <段级diff清单.md>' })); }
//   catch (e) { if (e && e.code === USAGE_CODE) usageExit(e.message); throw e; }   // 其他异常交 exit-guard 归类

/** 参数错误码：调用方据此决定「打印用法 + exit 10」，不要靠 message 文本匹配。 */
export const USAGE_CODE = 'LUNHENG_USAGE'

/** 参数用法错误（未知旗标 / 缺值 / 位置参数越界）。 */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
    this.code = USAGE_CODE
  }
}

/**
 * 解析 argv（已 slice(2)）。
 * @param {string[]} argv 原始参数数组
 * @param {object} spec
 * @param {string[]}  [spec.flags=[]]        布尔旗标（如 `--dry-run`）
 * @param {object}    [spec.values={}]       带值旗标 → **示例值**（用于缺值报错时给出可照抄的写法）
 * @param {number}    [spec.minPositionals=0] 位置参数下限
 * @param {number}    [spec.maxPositionals=Infinity] 位置参数上限
 * @param {string}    [spec.positionalHint=''] 位置参数在用法串里的写法（报错时点名）
 * @returns {{ flags: Set<string>, opts: Record<string,string|null>, positionals: string[] }}
 *   未出现的带值旗标在 `opts` 里为 `null`（调用方不必再判 undefined）。
 */
export function parseArgs(argv, spec = {}) {
  const flags = new Set()
  const valueNames = Object.keys(spec.values || {})
  const valueExamples = spec.values || {}
  const minPos = spec.minPositionals ?? 0
  const maxPos = spec.maxPositionals ?? Infinity
  const posHint = spec.positionalHint || '<位置参数>'
  const known = [...(spec.flags || []), ...valueNames]
  const opts = Object.fromEntries(valueNames.map((n) => [n, null]))
  const positionals = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if ((spec.flags || []).includes(a)) { flags.add(a); continue }
    if (valueNames.includes(a)) {
      const v = argv[i + 1]
      // 缺值 = 本参数是最后一个 token，或下一个 token 又是旗标（如 `--out --dry-run`）
      if (!v || v.startsWith('--')) {
        const eg = valueExamples[a] ? `（示例：${a} ${valueExamples[a]}）` : `（${a} 后必须紧跟一个值）`
        throw new UsageError(`${a} 缺少值${eg}`)
      }
      opts[a] = v
      i++
      continue
    }
    if (a.startsWith('-')) {
      const vEg = valueNames.length ? `；带值的旗标用空格分隔：${valueNames[0]} ${valueExamples[valueNames[0]] || '<值>'}` : ''
      throw new UsageError(`未知参数: ${a}（本脚本只认 ${known.join(' / ')}${vEg}）`)
    }
    positionals.push(a)
  }

  if (positionals.length > maxPos) {
    const extra = positionals.slice(maxPos)
    throw new UsageError(`多余的参数: ${extra.join(' ')}（本脚本只接受 ${maxPos} 个位置参数：${posHint}）`)
  }
  if (positionals.length < minPos) {
    throw new UsageError(`缺少必需的位置参数：${posHint}`)
  }
  return { flags, opts, positionals }
}
