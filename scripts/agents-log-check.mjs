// agents-log-check.mjs — **agents-log 流水软校验**（v18.86.0-prep · 台海项目反哺 F-5）
//
// ── 为什么需要它（实测三宗事故，全部发生在台海项目一次运行里）────────────────────────
//   `run/<项目>/agents-log.md` 是流水线的**过程证据主档**（子代理追加写、主控独占写 status.md），
//   但它此前**没有任何机械检查**——三处问题全靠人工发现：
//     ① **控制字符损坏**：主控用 PowerShell 双引号字符串追加流水段时，`\a` `\v` `\b` `\r` `\n`
//        被解释为转义序列 → 写入 BEL / VT / BS / CR 等**控制字节**，「吃掉首字母」；
//     ② **「待修」行缺处置**：流水里标了「待修」却再无下文 → 读者无法判断该问题**是否已闭合**；
//     ③ **sha256 行格式**：写「正文 sha256：」却不给 64 位实值 → 指纹互锁（M-Exist-5）失去输入。
//
// ── 三条判据（**只报事实、不做判定**——这是刻意的）────────────────────────────────
//   · C0：**行内**（非行尾）的 C0 控制字节 + `DEL` + `U+FFFD` 替换字符；
//     ⚠️ **行尾 `\r` 不报**（那是 `\r\n` 换行 = 行尾一致性，属仓内规则 ④「行尾门」的领域，不是损坏）；
//   · 「待修」配处置：含「待修」的行，其后 **20 行内**须出现处置语（已修/已改/作废/已处置/已关闭/
//     已更正/处置 =）——**找不到才报**（同段自带处置语的不报）；
//   · sha 行：含 `sha256` + 分隔符（`:`/`：`/`=`/`＝`）时须给值（64 位 hex、或**缩写 hex + `…`**、
//     或显式声明缺失）；**引述类文本**（无分隔符，如「6 文件 sha256 一致」）不报。
//
// ── 退出码（**刻意没有 `1`，也不写盘、不 spawn**）────────────────────────────────
//   `0`  = 检查完成（**有发现也返回 0**）｜ `10` = 参数/路径错 ｜ `70` = 内部错误。
//   **为什么没有 `1`**：ADR-0003 的判据——**只要脚本不做内容判定，它的 `1` 就一定是撞码**
//   （`1` 在 M 门命名空间里 = 「P1 内容失败」）。本脚本检查的是**流水文件形态**，不做内容判定，
//   故与 `scripts/flow-metrics.mjs`（同为「只报事实」的仓库级检查器）取同一形态：**结论进 stdout
//   清单 / `--json`，不进退出码**。需要机器判读的调用方读 JSON，不要读码。
//
// ── 用法 ──────────────────────────────────────────────────────────────────────
//   node scripts/agents-log-check.mjs <agents-log.md | 项目目录 | run 目录> [--json]
//   目录入参 → 递归（深度 ≤3）收集全部 `agents-log*.md`（含 `agents-log-Phase*.md` 形态）。
//   **本脚本仓库级、不随包**（流水在仓库外的工作区 `run/` 下，npm 包内不存在该数据）。
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { installExitGuard, EXIT_USAGE } from '../skills/lunheng-article-pipeline/scripts/_lib/exit-guard.mjs'

installExitGuard()

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const targets = argv.filter((a) => !a.startsWith('--'))
const unknown = argv.filter((a) => a.startsWith('--') && a !== '--json')
if (unknown.length || targets.length !== 1) {
  console.error('用法：node scripts/agents-log-check.mjs <agents-log.md | 项目目录 | run 目录> [--json]')
  process.exit(EXIT_USAGE)
}

/** C0 里被允许的空白：\t(0x09) \n(0x0A)；\r(0x0D) 只在**成对 CRLF** 时允许。 */
const C0_ALLOWED = new Set([0x09, 0x0a])
const isFlaggedC0 = (code) => (code <= 0x1f && !C0_ALLOWED.has(code)) || code === 0x7f

/** 收集待检文件（文件 → 自身；目录 → 递归 ≤3 层找 agents-log*.md）。 */
function collect(input) {
  const abs = resolve(input)
  if (!existsSync(abs)) return { error: `路径不存在：${input}` }
  const st = statSync(abs)
  if (st.isFile()) {
    if (!abs.endsWith('.md')) return { error: `不是 .md 文件：${input}` }
    return { files: [abs] }
  }
  const out = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p, depth + 1) }
      else if (/^agents-log.*\.md$/.test(e.name)) out.push(p)
    }
  }
  walk(abs, 0)
  return { files: out.sort() }
}

/** 处置语（「待修」行其后 20 行内出现任一即视为已交代）。 */
//   **v18.86.0-prep 校准（真实数据自证）**：首版漏了 `处置 =`（用等号而非冒号）这一写法——台海
//   `agents-log.md:31` 的「待修」其处置其实写在 `:47`（`**处置 = 把「增量落盘」写进派发协议**`），
//   首版因只认 `处置[:：]` 而误报。现把分隔符放宽到 `[=＝:：]`，并补入「误判 / 撤回 / 已核实」。
const DISPOSAL_RE = /已修|已改|作废|已处置|已关闭|已更正|已补|已回填|不修|不适用|误判|撤回|已核实|处置\s*[=＝:：]/
// sha256：**只在「标签后应有值」的写法上判**（v18.86.0-prep 校准）。
//   真实数据实测的三种**正当**写法（首版全被误报）：
//     · 引述门的结论原文：`M-Exist-2「6 文件 sha256 一致」`（无分隔符 → 不是断言指纹）
//     · 流水惯例的**缩写指纹**：`sha256 d8ec2eaf…` / `auditTargetSha256 = 1c892b81…`
//     · 显式声明缺失：`待补 / N/A / 未计算`
//   故判据收紧为：**含 `sha256` + 后有分隔符（`:`/`：`/`=`/`＝`）** 且 **既无 64 位 hex、也无
//   缩写 hex+省略号、也无缺失声明** → 才报（真实事故形态 = `本轮正文 sha256：` 后**空着**）。
const SHA_LABEL_RE = /sha256\s*[:：=＝]/i
const SHA_OK_RE = /\b[0-9a-fA-F]{64}\b|[0-9a-fA-F]{8,}\s*(?:…|\.\.\.)|缺失|待补|待回填|N\/A|未计算|无指纹|未给/

/** 检一个文件，返回 findings 数组。 */
function checkFile(p, base) {
  const raw = readFileSync(p, 'utf8')
  const rel = relative(base, p).split('\\').join('/') || p
  const lines = raw.split('\n')
  // **行尾 CR 判据（v18.86.0-prep 第二次自证修复）**：`split('\n')` 之后，**行尾**的 `\r` 只可能来自
  //   `\r\n` 行尾——即**CRLF 换行**，属正常形态；真正要报的是**行内**（非行尾）的孤立 `\r`。
  //   ⚠️ 首版用「`\r\n` 是否占行数过半」判「CRLF 文件」，**导致 LF/CRLF 混排文件里的少数 CRLF 行尾
  //   被逐行误报**——真实数据实测：台海 `agents-log.md` 报 12 处，而 `CR 总数(12) == CRLF 数(12)`、
  //   行内 CR = 0 ⇒ **12 处全是假阳性**（该文件是 LF 为主 + 12 行 CRLF 的混排，不是损坏）。
  //   判据的教训与仓内规则 ④「行尾门」一致：**行尾形态是「一致性」问题，不是「控制字符损坏」问题**；
  //   把两者混在一个检查里，必然误报。本脚本只负责**损坏**（行内 CR / 其他 C0 / U+FFFD）。
  const out = []
  lines.forEach((line, i) => {
    // ① C0 / DEL / U+FFFD（逐码位判；**行尾 `\r` = CRLF 换行，豁免**）
    for (let k = 0; k < line.length; k++) {
      const code = line.codePointAt(k)
      if (code === 0x0d) {
        if (k !== line.length - 1) out.push({ kind: 'C0', line: i + 1, detail: '行内孤立 CR（0x0D，非行尾 = 非 CRLF 换行）' })
        continue
      }
      if (code === 0xfffd) { out.push({ kind: 'C0', line: i + 1, detail: 'U+FFFD 替换字符（编码损坏）' }); continue }
      if (isFlaggedC0(code)) {
        const name = { 0x07: 'BEL', 0x08: 'BS', 0x0b: 'VT', 0x0c: 'FF', 0x1b: 'ESC' }[code] || ''
        out.push({ kind: 'C0', line: i + 1, detail: `控制字节 0x${code.toString(16).toUpperCase().padStart(2, '0')}${name ? `（${name}）` : ''}` })
      }
    }
    // ② 「待修」行须在后 20 行内交代处置（同行自带即算交代）
    if (line.includes('待修') && !DISPOSAL_RE.test(line)) {
      const tail = lines.slice(i + 1, i + 21).join('\n')
      if (!DISPOSAL_RE.test(tail)) out.push({ kind: 'DISPOSAL', line: i + 1, detail: '「待修」行其后 20 行内未见处置语（已修/已改/作废/已处置/已关闭/已更正…）' })
    }
    // ③ sha256 标签后须给值（64 位 hex / 缩写 hex + … / 显式声明缺失）
    if (SHA_LABEL_RE.test(line) && !SHA_OK_RE.test(line)) {
      out.push({ kind: 'SHA', line: i + 1, detail: '`sha256` 标签后未给值（须 64 位 hex、或缩写 hex + `…`、或显式声明缺失）' })
    }
  })
  return { file: rel, findings: out }
}

const { files, error } = collect(targets[0])
if (error) { console.error(error); process.exit(EXIT_USAGE) }
if (!files.length) {
  console.log('未找到 `agents-log*.md`（目录入参会递归 ≤3 层；文件入参请指向 .md 本身）')
  process.exit(0)
}

const base = statSync(resolve(targets[0])).isDirectory() ? resolve(targets[0]) : resolve(targets[0], '..')
const reports = files.map((f) => checkFile(f, base))
const all = reports.flatMap((r) => r.findings.map((x) => ({ file: r.file, ...x })))

if (asJson) {
  console.log(JSON.stringify({ root: base, files: reports.length, findings: all.length, total: all.length, items: all }, null, 2))
  process.exit(0)
}

console.log(`agents-log 软校验：${reports.length} 个文件`)
if (!all.length) {
  console.log('✓ 未发现软提示（C0 控制字符 / 「待修」缺处置 / sha256 行格式）')
} else {
  const byKind = { C0: '控制字符', DISPOSAL: '「待修」缺处置', SHA: 'sha256 行格式' }
  console.log(`⚠️ ${all.length} 处软提示（**只报事实、不判失败**；请人工复核——含误报可能）：`)
  for (const x of all) console.log(`  · [${byKind[x.kind]}] ${x.file}:${x.line} ${x.detail}`)
}
// **恒 0**：本脚本不做判定（ADR-0003：非内容判定脚本用 1 = 撞码）。
process.exit(0)
