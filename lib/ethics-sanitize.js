// 论衡伦理脱敏核心（v18.60.0 新增）——**纯函数、零写盘、零网络、零子进程**。
//
// 为什么是纯模块而不是随包脚本（设计取舍，如实）：
//   · 本文件的职责是「把一段文本里的可识别个人信息替换成占位符」，是**纯文本变换**，
//     不需要子进程、不需要网络、不需要读除词表外的任何东西；
//   · 既有三个原生工具（`lunheng_m_gate` / `lunheng_char_count` / `lunheng_handoff_check`）
//     都是「脚本的薄包装」——它们包脚本是因为判定逻辑必须与 `pwsh` 路径**同源**（脚本是唯一真源）。
//     本工具**没有**对应的 pwsh 路径需求，包一层脚本只会新增一处需要同步维护的脚本白名单
//     （`consistency-check` 规则 ⑩/⑩b 与 `repo-hygiene-check` 规则 ⑥ 都会因此变红）。
//   · 纯函数形态让 `tests/ethics-sanitize.test.mjs` 可以**直接 import 断言**，不必 spawn。
//
// 为什么**不写盘**（安全性设计，关键）：
//   · 该工具处理的是**最敏感**的输入（访谈逐字稿 / 田野笔记）。一个会写盘的工具，其写盘目标
//     由调用方给定 → 与「只读工具」族的既有声明（`SECURITY.md`「注册三个**只读**工具」）冲突；
//   · 本工具改为**返回脱敏后的文本**，由主控用自身 `write` 工具决定落盘位置。这样：
//     ① 族属性不变（仍是只读）；② 落盘位置由主控显式决定，不经工具入参注入。
//
// 能力边界（**如实声明，不要读成「已彻底匿名化」**）：
//   · 硬模式（身份证 / 手机 / 邮箱 / 固话 / 银行卡）由正则判定，召回率高、误报低；
//   · **人名与地名靠词表匹配，召回率与精度都不可能是 100%**——中文人名切分在无词表边界时
//     本质上是歧义问题（「王朝」是朝代、「李子」是水果、「史研究」是「历史研究」的切片）。
//     本实现的取舍是「**宁可多报待复核，不静默漏报**」：拿不准的进 `reviewFlags` 由人复核。
//   · **本工具不是双盲评审的充分条件**。它降低泄露面，不构成合规保证。
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 受控模式。none = 原样返回（显式声明「未脱敏」）；basic = 默认；strict = 地名泛化到上级。 */
export const MODES = Object.freeze(['none', 'basic', 'strict'])

/** 硬模式：高置信度个人标识（正则可直接判定，无需词表）。
 *  **应用顺序有意义**——18 位身份证也匹配 16-19 位银行卡，故身份证必须先跑
 *  （替换后数字消失，不会二次命中）。
 *
 *  `required`（v18.62.6 新增）：该维度**必须**出现的字面量；正文不含它时整条正则直接跳过。
 *    两个作用：① 零成本短路（`String.includes` 是 O(n) 且常数极小）；② **消灭二次回退**——
 *    正则引擎在「找到了前半、找不到后半」时会逐位回退，代价 O(n²)。
 */
const HARD_PATTERNS = Object.freeze([
  { type: 'idcard', re: /\b\d{17}[\dXx]\b/g, to: '[身份证号-REDACTED]', label: '身份证号' },
  { type: 'bankcard', re: /\b\d{16,19}\b/g, to: '[银行卡号-REDACTED]', label: '银行卡号' },
  { type: 'phone', re: /\b1[3-9]\d{9}\b/g, to: '[手机号-REDACTED]', label: '手机号' },
  { type: 'landline', re: /\b0\d{2,3}-\d{7,8}\b/g, to: '[固话-REDACTED]', label: '固定电话' },
  // v18.62.6（独立复测发现，未进任何既有报告）：**原写法 `[A-Za-z0-9._%+-]+@…` 是 O(n²)**。
  //   实测（本机 Node 24.20）：'A'×10k → 41 ms；×20k → 163 ms；×40k → 663 ms；×80k → 2 927 ms
  //   （每翻倍 ×4，干净的二次曲线）。真实可达形态：base64url 49k → 996 ms、长十六进制串
  //   44.8k → 850 ms、Markdown 内嵌 data URI（base64 无 `/`）37.6k → 584 ms。
  //   机制：`[A-Za-z0-9._%+-]` 贪婪吃掉整段无 `@` 的长 ASCII 串，再逐位回退找 `@`；引擎又对
  //   每个起始位重试 → O(n²)。对照：纯中文 10 万字符仅 5 ms（`[A-Za-z0-9._%+-]` 一字不匹配）。
  //   外推：本文件 hook 侧上限 256 KB → 最坏 ~28 s；`lunheng_ethics_sanitize` 工具侧
  //   `maxChars: MAX_SAFE_INTEGER` 无上限 → 1 MB 含 base64 → ~7 分钟**同步阻塞**。
  // 修法（两层，缺一不可）：
  //   ① `required: '@'` —— 正文无 `@` 时整条跳过（邮箱必含 `@`，判据安全）；
  //   ② 量词按 **RFC 5321 §4.5.3.1** 限长：local-part ≤ 64 octets、domain ≤ 255 octets。
  //      这既**比原写法更正确**（原写法接受长度非法的"邮箱"），又把回退步数从 O(n) 压到 O(64)。
  {
    type: 'email',
    re: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g,
    to: '[邮箱-REDACTED]',
    label: '邮箱',
    required: '@',
  },
])

/** 给定名尾部的「停用字」：命中则从候选名末尾裁掉，并**把裁掉的字还回正文**。
 *
 *  为什么需要：`张三说` 的贪婪切分会得到「张三说」，正确结果应为「张三」。
 *  中文人名没有词表边界时是歧义问题，这里用一个小停用字集裁掉最常见的动词/助词/代词——
 *  **这不解决全部歧义**，剩余歧义交给 `reviewFlags` 由人复核。
 *
 *  v18.60.0 实测修正（三处）：① 裁剪后必须**归还被裁字**，否则 `李四表示` → `受访者B示`（吞「表」）；
 *  ② 代词（我/你/他…）必须进表，否则 `白天我在` 的候选是「白天我」而躲过排除表；
 *  ③ 排除判定要同时看「全名」与「姓氏+首字」两个前缀（见 `isExcluded`）。 */
const GIVEN_TAIL_STOP = new Set(
  [...'说表示认为指出提到回忆告诉称道的是在和与及等了着过们就都也还只很更最对把被让给从向往会能可要需' +
   '我你他她它们这那很太又再没别好大小上下前后里外间中'],
)

/** 角色词：出现在人名**之前**时提高置信度，并**被人名替换一并吸收**（防「受访者受访者A」重复）。 */
const ROLE_WORDS = Object.freeze(['受访者', '访谈对象', '被访者', '受访人', '当事人', '村民', '工人', '患者', '学生', '教师', '职工', '农户', '居民'])

const HAN = '\\u4e00-\\u9fff'
/** 占位符哨兵（私有使用区）：地名先替换成哨兵，跑完人名再还原。
 *  为什么必须这样：strict 下 `杭州` → `浙江省某地`，而「浙」是姓氏——
 *  若不隔离，人名轮会把刚生成的占位符再咬一口（v18.60.0 实测踩到）。 */
const SENT = '\uE000'

/** 读取词表。缺失时**不抛**——返回空集合并把缺口记入 `missing`（由调用方如实呈现，不静默降级）。
 *
 * v18.69.0（批 6-A · P2 修复）：按 mtime 指纹缓存——H2 钩子启动期读一次是对的，但工具侧每次
 *   execute 都重读 3 个词表文件，高并发 parallel 工具下重复磁盘 IO。缓存键 = skillRoot + 三文件
 *   的 mtimeMs 指纹（词表变了自动失效，不变则零重读）。
 */
let dictCache = null
export function loadDicts(skillRoot) {
  const dir = join(skillRoot, 'references', 'dicts')
  const DICT_FILES = ['中文姓氏.txt', '人名排除词.txt', '中国行政区划.txt']
  let fingerprint = ''
  for (const f of DICT_FILES) {
    try { fingerprint += f + ':' + statSync(join(dir, f)).mtimeMs + ';' } catch { fingerprint += f + ':MISSING;' }
  }
  if (dictCache && dictCache.fingerprint === fingerprint) return dictCache.dicts
  const readLines = (file) => {
    const p = join(dir, file)
    if (!existsSync(p)) return null
    return readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  }
  const missing = []
  const surnames = readLines('中文姓氏.txt')
  if (!surnames) missing.push('中文姓氏.txt')
  const excludes = readLines('人名排除词.txt')
  if (!excludes) missing.push('人名排除词.txt')
  const placeLines = readLines('中国行政区划.txt')
  if (!placeLines) missing.push('中国行政区划.txt')

  // 地名表格式：`<地名>\t<上级（省/直辖市/自治区）>`；无制表符时视为「地名 → 自身」
  const places = new Map()
  for (const l of placeLines || []) {
    const [name, parent] = l.split('\t').map((s) => (s || '').trim())
    if (name) places.set(name, parent || name)
  }
  const result = {
    surnames: new Set(surnames || []),
    excludes: new Set(excludes || []),
    places,
    missing,
  }
  dictCache = { fingerprint, dicts: result }
  return result
}

/** 把姓名映射稳定化：同一原名始终得到同一占位符（跨全文一致，便于正文引用一致）。 */
function makeAssigner(prefix) {
  const map = new Map()
  return (name) => {
    if (!map.has(name)) {
      const i = map.size
      const letter = String.fromCharCode(65 + (i % 26))
      map.set(name, `${prefix}${letter}${i >= 26 ? Math.floor(i / 26) + 1 : ''}`)
    }
    return map.get(name)
  }
}

/**
 * 排除判定（v18.60.0 实测修正②）：**全名与「姓氏+首字」两个前缀都要看**。
 * 只查全名会让 `白天我在` 的候选「白天我」躲过排除表里的「白天」；只查首字会误杀三字名。
 */
function isExcluded(surname, given, excludes) {
  if (excludes.has(surname + given)) return true
  if (given.length > 1 && excludes.has(surname + given[0])) return true
  return false
}

/**
 * 裁掉给定名尾部的停用字。返回 `{given, dropped}`——`dropped` 必须归还正文。
 * @returns `{given:string, dropped:string}`；`given` 为空串表示应跳过（大概率不是人名）。
 */
function trimGiven(given) {
  let g = given
  let dropped = ''
  while (g.length > 1 && GIVEN_TAIL_STOP.has(g[g.length - 1])) {
    dropped = g[g.length - 1] + dropped
    g = g.slice(0, -1)
  }
  // 首字即停用字 → 大概率不是名字（如「王说」）
  if (GIVEN_TAIL_STOP.has(g[0])) return { given: '', dropped: '' }
  return { given: g, dropped }
}

/**
 * 脱敏主函数（纯函数：不改入参、不写盘、不联网）。
 *
 * @param {string} text - 待处理文本。
 * @param {object} opts
 * @param {'none'|'basic'|'strict'} [opts.mode='basic'] - 模式。
 * @param {object} [opts.dicts] - `loadDicts()` 的返回值；缺省时降级为「只做硬模式」并在 degraded 里说明。
 * @param {number} [opts.maxChars=60000] - 返回文本的字符上限（超出即截断并置 truncated，**如实报告**）。
 * @param {number} [opts.maxList=200] - replacements / reviewFlags 的条数上限。
 * @returns {{text:string, mode:string, truncated:boolean, counts:object, replacements:Array, reviewFlags:Array, distinctPersons:number, dictStats:object, degraded:boolean, degradedReason:string}}
 */
export function sanitize(text, opts = {}) {
  const mode = MODES.includes(opts.mode) ? opts.mode : 'basic'
  const dicts = opts.dicts || { surnames: new Set(), excludes: new Set(), places: new Map(), missing: ['（未提供词表）'] }
  const maxChars = Number.isFinite(opts.maxChars) && opts.maxChars > 0 ? opts.maxChars : 60000
  const maxList = Number.isFinite(opts.maxList) && opts.maxList > 0 ? opts.maxList : 200

  const src = typeof text === 'string' ? text : ''
  const counts = { idcard: 0, bankcard: 0, phone: 0, landline: 0, email: 0, person: 0, place: 0 }
  const replacements = []
  const reviewFlags = []
  const stats = { persons: dicts.surnames.size, places: dicts.places.size }
  const distinct = new Set()

  if (mode === 'none') {
    return {
      text: src.slice(0, maxChars),
      mode,
      truncated: src.length > maxChars,
      counts,
      replacements,
      reviewFlags: [{ kind: 'mode', detail: 'mode=none：未做任何替换（调用方显式声明不做脱敏）' }],
      distinctPersons: 0,
      dictStats: stats,
      degraded: false,
      degradedReason: '',
    }
  }

  let out = src

  // ① 硬模式（高置信度）——先跑，替换后数字消失，避免与银行卡互相二次命中
  for (const p of HARD_PATTERNS) {
    // v18.62.6：`required` 短路——正文不含该字面量时整条跳过。
    //   对 email 而言这是**二次回退的主要消除手段**（详见 HARD_PATTERNS 内注释的实测数据）。
    if (p.required && !out.includes(p.required)) continue
    out = out.replace(p.re, (m) => {
      counts[p.type]++
      if (replacements.length < maxList) replacements.push({ type: p.type, label: p.label, from: m, to: p.to })
      return p.to
    })
  }

  // ② 地名（词表）→ 先换成**哨兵**，跑完人名再还原（修正③：防占位符被二次咬）
  const sentMap = new Map()
  if (dicts.places.size) {
    const names = [...dicts.places.keys()].sort((a, b) => b.length - a.length)
    const re = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    out = out.replace(re, (m) => {
      const parent = dicts.places.get(m) || m
      counts.place++
      // strict 泛化到上级；**省级本身保持原样**——省级粒度不足以识别个体，
      // 替换成「广东某地」是制造假精度（真实数据是「广东省」而非「广东省的某地」）。
      const final = mode !== 'strict' ? '[地名-REDACTED]' : (parent === m ? m : `${parent}某地`)
      if (replacements.length < maxList) replacements.push({ type: 'place', label: '地名', from: m, to: final })
      const token = `${SENT}${sentMap.size}${SENT}`
      sentMap.set(token, final)
      return token
    })
  }

  // ③ 人名（词表姓氏 + 上下文裁剪）
  if (dicts.surnames.size) {
    const nextPerson = makeAssigner('受访者')
    const surnames = [...dicts.surnames].sort((a, b) => b.length - a.length)
    const roleAlt = ROLE_WORDS.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    // 角色词作为**可选前缀**一并匹配：命中时整段（角色词+姓名）替换成单个占位符，
    // 从而消除「受访者受访者A」的重复（修正④）。
    const re = new RegExp(`(${roleAlt})?(${surnames.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([${HAN}]{1,2})`, 'g')
    out = out.replace(re, (m, role, surname, given, offset) => {
      const { given: g, dropped } = trimGiven(given)
      if (!g) return m
      if (isExcluded(surname, g, dicts.excludes)) return m   // 命中排除表 → 原样返回（修正②）
      // 修正⑤（v18.60.0 实测）：姓氏可能是某个普通词的**第二字**——
      //   `历史概念` 的「史」、`明白` 的「白」、`关于` 的「于」。这类无法靠「姓氏+给定名」表达，
      //   故把「前一字 + 姓氏」也拿去查排除表（`历史` / `明白` / `关于` 已在表内）。
      if (offset > 0) {
        const prev = out[offset - 1]
        if (prev >= '\u4e00' && prev <= '\u9fff' && dicts.excludes.has(prev + surname)) return m
      }
      const full = surname + g
      counts.person++
      distinct.add(full)
      const to = nextPerson(full)
      if (replacements.length < maxList) replacements.push({ type: 'person', label: '人名', from: full, to, ...(role ? {} : { lowConfidence: true }) })
      if (!role && reviewFlags.length < maxList) {
        reviewFlags.push({ kind: 'person-low-confidence', text: full, detail: '姓氏命中但上下文无角色词——请人工确认是否真人姓名（可能把普通词切成人名）' })
      }
      // 修正①：把裁剪掉的字**还回正文**，不得吞字
      return to + dropped
    })
  }

  // 还原地名哨兵
  if (sentMap.size) {
    const collisions = []
    out = out.replace(new RegExp(`${SENT}(\\d+)${SENT}`, 'g'), (m, i) => {
      const key = `${SENT}${i}${SENT}`
      const v = sentMap.get(key)
      if (v !== undefined) return v
      // v18.69.0（批 6-A · P2 修复）：原文自带与脱敏哨兵同形的序列（`\uE000<n>\uE000`）——
      //   旧版 `?? ''` 在这里静默吞字。现保留原串（不吞字），并记 sentinel-collision 供人工核。
      collisions.push(key)
      return m
    })
    if (collisions.length) {
      reviewFlags.push({ kind: 'sentinel-collision', detail: `原文自带与脱敏哨兵同形的序列 ${collisions.length} 处，已保留原串未吞字——请人工确认该处是否本应被还原为地名占位符` })
    }
  }

  const truncated = out.length > maxChars
  const missing = (dicts.missing || []).filter(Boolean)
  return {
    text: truncated ? out.slice(0, maxChars) : out,
    mode,
    truncated,
    counts,
    replacements,
    reviewFlags: [
      ...reviewFlags,
      ...missing.map((f) => ({ kind: 'dict-missing', detail: `词表缺失：${f}——该维度未生效（不是「已脱敏」）` })),
    ],
    distinctPersons: distinct.size,
    dictStats: stats,
    degraded: missing.length > 0,
    degradedReason: missing.length ? `缺词表：${missing.join(' / ')}` : '',
  }
}

/** 人类可读摘要（供工具 render 与主控汇报复用；**不含脱敏文本本身**）。 */
export function summarize(result) {
  const c = result.counts
  const parts = [
    `身份证 ${c.idcard}`, `手机 ${c.phone}`, `固话 ${c.landline}`, `邮箱 ${c.email}`, `银行卡 ${c.bankcard}`,
    `人名 ${c.person}（${result.distinctPersons} 个不同）`, `地名 ${c.place}`,
  ]
  return `模式=${result.mode}｜替换：${parts.join(' / ')}｜待复核 ${result.reviewFlags.length} 条` +
    (result.truncated ? '｜⚠️ 输出已截断（原文超上限，请分段处理）' : '') +
    (result.degraded ? `｜⚠️ 降级：${result.degradedReason}` : '')
}
