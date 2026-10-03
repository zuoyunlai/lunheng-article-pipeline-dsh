// 人类命令 `/lunheng-status`（C 组 · v18.1.0）：主人在 1-3 小时长跑中**随时自查进展**，
// 且**不产生模型消息**（官方 `docs/subsystems/commands.md:5`：interactive adapters 用它直接执行命令）。
//
// 官方依据：`commands.md` — `register(definition: CommandDefinition): () => void`；定义字段
//   `{ name, description, input?, recordInput?, handler }`；handler 返回
//   `{ kind:'success', text? }` 或 `{ kind:'error', text }`；`invocation.rawInput` 是命令名之后的原文。
//
// 与工具化的区别（为什么用命令而不是工具）：命令**不进模型上下文**、不占一轮对话，适合「只看一眼」；
// 而「让主控据此改写产物」才需要工具（那由 `lunheng_m_gate` / `lunheng_char_count` 承担）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveProjectDir, isSafeProjectArg, isDirectChildOf, isPathInsideRunDir } from './run-path-fence.mjs'

const clip = (s, n) => String(s ?? '').replace(/\s+$/g, '').slice(0, n)

// ── v18.57.x（审计修订 P2）+ v18.62.5 P2-6 共享：项目名必须是 `run/` 下的**直接子目录名** ─────
// 收口逻辑（`isSafeProjectArg` + `isDirectChildOf`）已在 v18.62.5 §P2-6 抽出到 `lib/run-path-fence.mjs`，
// 同族入口（`history-cli.mjs` / `pending-cli.mjs`）与之同源——避免「同族收紧 ≠ 一致」缺陷复发。
// 收口方式（三层，缺一不可）：
//   ① 词法层：拒绝对路径 / 路径分隔符 / `.` / `..` / 空段；
//   ② 结构层：解析结果必须是 runDir 的**直接子目录**（不允许再下一层）；
//   ③ 物理层：用 realpath 解析后**再判一次**——防 `run/<软链接>` 指到工作区之外。

/** 在 `<cwd>/run/` 下挑项目：有参数用参数；否则取 status.md 最近修改的那个。
 *  参数无效或越出 `run/`（含软链接绕过）→ 返回 null（调用方报「未找到项目」）。 */
function pickProject(cwd, arg) {
  const runDir = join(cwd, 'run')
  if (arg) {
    return resolveProjectDir(runDir, arg)
  }
  if (!existsSync(runDir)) return null
  const cands = readdirSync(runDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(runDir, e.name))
    // v18.69.0（批 6-A · P2 修复）：无参分支此前不做过物理层校验——`run/` 内放一个 junction
    //   指向工作区外，会被当「最近项目」选中并读其 status.md（只读，但读面越界，与三层围栏
    //   口径不一致）。补 isDirectChildOf（realpath 空间 containment）拦截。
    .filter((p) => isDirectChildOf(runDir, p))
    .map((p) => {
      const s = join(p, 'status.md')
      return existsSync(s) ? { p, m: statSync(s).mtimeMs } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.m - a.m)
  return cands.length ? cands[0].p : null
}

function firstLines(text, n, { skipHeadings = true } = {}) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !(skipHeadings && /^#{1,2}\s/.test(l)))
    .slice(0, n)
}

/**
 * 注册 `/lunheng-status`。返回 disposer（未安装时 undefined）。
 * @param ctx - 插件 ctx。
 * @param opts.cwd - 兜底基准目录（v18.2.6：**优先用会话工作区**，见 handler 内注释）。
 */
export function installStatusCommand(ctx, { cwd }) {
  const commands = ctx.get('commands')
  if (!commands?.register) return undefined
  return commands.register({
    name: 'lunheng-status',
    description: '查看论衡项目进展（读 run/<项目>/status.md 与 进展-主人版.md；不产生模型消息）',
    input: { hint: '项目名（省略 = run/ 下 status.md 最近修改的项目）' },
    recordInput: true,
    handler: (invocation) => {
      try {
        // v18.2.6 修复（审计 P1-4）：`run/<项目>` 必须按**会话工作区**解析，而不是宿主进程启动目录。
        //   旧实现用入口在 apply 期捕获的 `process.cwd()`（= 宿主启动目录，DSH Desktop / `dsh web` 下
        //   通常不是用户的工作区）→ `/lunheng-status` 会在错误目录里找 `run/`，永远报「未找到项目」。
        //   官方的会话工作区在 `invocation.agent.session.header.cwd`（与 fs 工具同源，
        //   见 `dsh-tool-fs/lib/index.js:225-242`），命令回调**同步就能拿到**，故优先用它，配置只作兜底。
        const sessionCwd = invocation?.agent?.session?.header?.cwd
        const base = typeof sessionCwd === 'string' && sessionCwd.trim() ? sessionCwd.trim() : cwd
        const arg = String(invocation?.rawInput || '').trim().split(/\s+/)[0] || ''
        const project = pickProject(base, arg)
        if (!project) {
          const runDir = join(base, 'run')
          const names = existsSync(runDir)
            ? readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).slice(0, 12)
            : []
          return {
            kind: 'success',
            text:
              `论衡：未找到项目${arg ? `「${arg}」` : ''}（在 ${resolve(runDir)} 下找 status.md）。` +
              (names.length ? `\n现有项目：${names.join(' / ')}` : '\n（run/ 目录为空或不存在——Phase 0 定题后才会创建）') +
              (sessionCwd ? '' : `\n（提示：本次未能取到会话工作区，已回落到宿主启动目录 ${cwd}）`),
          }
        }
        const statusPath = join(project, 'status.md')
        const progressPath = join(project, '进展-主人版.md')
        const parts = [`论衡项目：${project.replace(/\\/g, '/').split('/').pop()}`]
        if (existsSync(progressPath)) {
          parts.push('— 主人版进展（最新在文件未尾）—', ...firstLines(readFileSync(progressPath, 'utf8'), 12, { skipHeadings: false }))
        }
        if (existsSync(statusPath)) {
          parts.push('— 状态机（status.md 前几行）—', ...firstLines(readFileSync(statusPath, 'utf8'), 10))
        }
        if (!existsSync(progressPath) && !existsSync(statusPath)) parts.push('（该项目目录下既无 进展-主人版.md 也无 status.md）')
        parts.push(`— 路径 —\n${statusPath.replace(/\\/g, '/')}`)
        return { kind: 'success', text: clip(parts.join('\n'), 4000) }
      } catch (e) {
        return { kind: 'error', text: `读取论衡进展失败：${String(e?.message || e).slice(0, 200)}` }
      }
    },
  })
}

/**
 * 注册 `/lunheng-stats`（C 组 · v18.5.0）：聚合 run/ 全部项目的遥测看板（M 门证据覆盖率 /
 *   修订轮数 / 门拦截频率 / 字数 / 审稿），**只读、不产生模型消息**。
 *
 * 与 `/lunheng-status`（读单个项目 status.md）的差别：本命令跨项目聚合，直接复用
 *   `scripts/lunheng-stats.mjs`（CLI 与命令同源，避免两处维护）。命令跑在**宿主进程**（非 agent 沙箱），
 *   故用 `spawnSync` 同步执行脚本——与 tools.js 的异步 `spawn`（跑在沙箱）不同，宿主有完整 spawn 权限。
 * @param ctx - 插件 ctx。
 * @param opts.cwd - 兜底基准目录（同 /lunheng-status，优先会话工作区）。
 * @param opts.skillRoot - 随包技能目录（脚本相对它解析）。
 * @param opts.scriptTimeoutMs - 脚本超时（来自 Config）。
 */
export function installStatsCommand(ctx, { cwd, skillRoot, scriptTimeoutMs }) {
  const commands = ctx.get('commands')
  if (!commands?.register) return undefined
  return commands.register({
    name: 'lunheng-stats',
    description: '聚合 run/ 全部项目的遥测看板（M 门证据覆盖率 / 修订轮数 / 门拦截频率 / 字数 / 审稿评分）；只读，不产生模型消息',
    input: { hint: '（可选）--json；省略 = 全量人读表格' },
    recordInput: true,
    handler: (invocation) => {
      try {
        const sessionCwd = invocation?.agent?.session?.header?.cwd
        const base = typeof sessionCwd === 'string' && sessionCwd.trim() ? sessionCwd.trim() : cwd
        const runDir = join(base, 'run')
        const raw = String(invocation?.rawInput || '').trim()
        // v18.16.0（C-6 反哺 · 岔口 #4 白名单化）：原写法 `raw.split(/\s+/)` 把用户原文整段拼到 argv 末尾，
        //   等于把宿主进程的 spawn 权限交给用户的键盘输入——危险面（详见 SECURITY.md §信任边界）。
        //   故改为**白名单旗标**：只有登记过的旗标能进 argv。
        // v18.62.4（全量审计-v18.62.3 P2-3）：白名单由「只放 --json」扩为 `--json` + **受围栏的** `--run-dir <path>`。
        //   为什么扩：`references/command-routing.md:86,94` 与 CHANGELOG 都把 `-stats --run-dir <path>` 写成
        //   可用形态，而宿主命令一律拒绝 → 照文档操作的用户只会拿到一句错误提示（**同仓自相矛盾**）。
        //   为什么敢扩：`--run-dir` 的值**必须**落在 `<会话工作区>/run/` 之内（逐个 realpath 后判包含关系，
        //   与 `/lunheng-status` 的 `pickProject` 同一套三层收口：词法 → 结构 → 物理），
        //   用户无法借此把 spawn 指向工作区之外；脚本本身也只读该目录。
        const tokens = raw ? raw.split(/\s+/) : []
        const allowed = []
        const rejected = []
        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i]
          if (t === '--json') { allowed.push(t); continue }
          if (t === '--run-dir') {
            const v = tokens[i + 1]
            if (!v) { rejected.push(`${t}（缺值）`); break }
            // ⚠️ 必须用 `resolve(base, v)` 而**不是** `join(base, v)`：`join` 遇到绝对路径**不会重置**，
            //   会拼出 `base\C:\…` 这种畸形串（本批实测踩到，表现为绝对路径被误判越界）。
            const cand = resolve(base, v)
            // 三层收口（词法 → 结构 → 物理）：v18.67.0（全量审计 P1 修复）起**改调真源函数**
            //   `isPathInsideRunDir`（lib/run-path-fence.mjs），不再在本处内联第三套实现。
            //   旧版（v18.62.4 P2-3）为避开「假拒绝」干脆砍掉物理层（不用 realpath）——注释自认实测
            //   `%TEMP%` 经 junction/短名解析后两侧落在不同路径空间 → relative() 假越界。但砍掉物理层的
            //   代价是：`<工作区>/run/` 内放一个 junction 指向工作区外，字符串包含判定通过、existsSync
            //   通过 → 有宿主完整权限的脚本读取工作区外目录。假拒绝的真根因是**只 realpath 一侧**——
            //   真源函数两侧同入 realpath 空间，合法路径不误伤、junction 逃逸被拦。
            const inside = isPathInsideRunDir(runDir, cand)
            if (!inside) { rejected.push(`${t} ${v}（超出 <工作区>/run 范围）`); i++; break }
            if (!existsSync(cand)) { rejected.push(`${t} ${v}（目录不存在）`); i++; break }
            allowed.push(t, cand)
            i++
            continue
          }
          rejected.push(t)
        }
        if (rejected.length) {
          return {
            kind: 'error',
            text: `/lunheng-stats 仅接受白名单旗标 \`--json\` 与 \`--run-dir <工作区内 run 目录>\`；`
              + `收到未授权参数：${rejected.join(' ')}（详见 SECURITY.md 信任边界——\`--run-dir\` 只允许指向 `
              + `<会话工作区>/run 之内的目录，防把宿主 spawn 指向任意路径）`,
          }
        }
        const script = join(skillRoot, 'scripts', 'lunheng-stats.mjs')
        // v18.62.4（P2-3）：默认 `--run-dir` 与白名单里的 `--run-dir` **不得重复**（重复 argv 会让脚本
        //   按最后一个取值，虽同值但属自造歧义）。用户给了就尊重用户那个（已通过围栏校验）。
        const runDirArgs = allowed.includes('--run-dir') ? [] : ['--run-dir', runDir]
        const r = spawnSync(process.execPath, [script, ...runDirArgs, ...allowed], {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
          // v18.67.0（批 3）：**钉死 cwd = 会话工作区**（围栏判据的 base）——下游 lunheng-stats.mjs
          //   自带同口径包含围栏（其基座 = 自身 process.cwd()/run）；不钉 cwd 时子进程继承宿主进程
          //   cwd（不保证等于会话工作区）→ 上下游围栏基座错位 → 合法路径被误拒（实测 commands.test
          //   P2-3/C-6 两用例红）。钉死后两道围栏同基，语义闭环。
          cwd: base,
          timeout: Number.isFinite(scriptTimeoutMs) && scriptTimeoutMs > 0 ? scriptTimeoutMs : 120000,
          // v18.69.0（批 6-A · P2 修复）：显式化采集上限。Node 默认 maxBuffer 1MB 已有界（超限
          //   ENOBUFS → 下方 r.error 分支兜成 kind:error，不会装死宿主）；此处显式抬到 8MB 并
          //   声明——输出最终 clip(8000)，8MB 已远超实际需求，留足余量防大 run/ 目录误触 ENOBUFS。
          maxBuffer: 8 * 1024 * 1024,
        })
        if (r.error) {
          return { kind: 'error', text: `执行 /lunheng-stats 失败（${r.error.code || '子进程未启动'}）：${String(r.error.message || '').slice(0, 160)}` }
        }
        const out = String(r.stdout || '')
        const err = String(r.stderr || '')
        if (r.status !== 0 && !out) {
          return { kind: 'error', text: `/lunheng-stats 脚本退出 ${r.status}：${clip(err, 300)}` }
        }
        return { kind: 'success', text: clip(out + (err ? '\n（stderr）' + err : ''), 8000) }
      } catch (e) {
        return { kind: 'error', text: `/lunheng-stats 失败：${String(e?.message || e).slice(0, 200)}` }
      }
    },
  })
}
