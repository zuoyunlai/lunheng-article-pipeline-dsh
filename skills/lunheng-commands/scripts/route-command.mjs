#!/usr/bin/env node
// route-command.mjs — /lunheng <cmd> [args] 路由到论衡阶段
// 版本：v1.0.3
// 本脚本为论衡（lunheng-article-pipeline v18.7.0+）的薄壳 wrapper 命令解析器
// 不引入新角色 / 新阶段 / 新 M 门；所有重活仍走论衡子代理
//
// v1.0.2（v18.62.0 F6）：CLI 入口判定改用 `pathToFileURL`——旧写法 `file://${process.argv[1]}`
//   在 Windows 下永不相等（`import.meta.url` = `file:///E:/…` 三斜杠正斜杠 vs `argv[1]` = `E:\…` 反斜杠），
//   CLI 入口**静默不执行**（退出码 0、零输出）。同形缺陷见 stats-cli / history-cli。

import { pathToFileURL } from 'node:url';

/**
 * 命令路由表（单一真源 = references/command-routing.md）
 * 本表与 command-routing.md 同源维护，修改命令行为只改这两处
 */
const COMMANDS = {
  '-draft':    { phase: 'full',     desc: '启动完整流水线（等效 @lunheng-article-pipeline）' },
  '-resume':   { phase: 'resume',   desc: '续跑已有项目（载入 run/<id>/ 状态）' },
  '-cite':     { phase: 'cite',     desc: '对段落跑 auto_cite（消耗 AI4Scholar 积分）' },
  '-audit':    { phase: 'audit',    desc: '仅跑 T7 G 审计 + M 门（不改稿）' },
  '-journal':  { phase: 'journal',  desc: '改目标期刊 + 重跑 T9 + 期刊匹配' },
  '-ppt':      { phase: 'ppt',      desc: '把当前定稿 → PPT 大纲（Markdown 表格）' },
  '-history':  { phase: 'history',  desc: '列 run/* 历史 + --diff <id1> <id2>' },
  // ⚠ 未实现（v19.27.5 起路由层直接拒绝，见下方 -rollback 分支）——保留条目只为「未知命令」不误报
  '-rollback': { phase: 'rollback', desc: '⚠ 未实现：本仓无 checkpoint（路由层显式拒绝并给出三条替代路径）' },
  '-status':   { phase: 'status',   desc: '显示当前进度（≤15 行人类可读）；--pending = 跨项目「待我决策」聚合收件箱' },
  '-gate':     { phase: 'gate',     desc: '主人侧：对某门裁定 --approve|--reject（原文直接进回执账本，不经主控转录）' },
  '-abort':    { phase: 'abort',    desc: '主人侧：中止 run/<项目>（落 audits/abort.json，主控在下一个门边界停）' },
  '-stats':    { phase: 'stats',    desc: 'run/ 目录项目汇总看板（借鉴论衡 v18.5.0 lunheng-stats.mjs）' },
  '-help':     { phase: 'help',     desc: '列可用命令 + 简述' },
  '-h':        { phase: 'help',     desc: 'help 别名' },
};

/**
 * 路由解析主函数
 * @param {string[]} argv - 命令行参数（数组）
 * @returns {object} - 解析结果 {ok, action, args} 或 {error}
 */
export function routeCommand(argv) {
  // 校验 argv[1] === '-lunheng'
  if (!Array.isArray(argv) || argv.length < 2 || argv[1] !== '-lunheng') {
    return { error: '用法：-lunheng <cmd> [args]（例：-lunheng -draft 写一篇论文）' };
  }

  const cmd = argv[2];
  const args = argv.slice(3);

  // -help / -h 单独处理
  if (!cmd || cmd === '-help' || cmd === '-h') {
    return { ok: true, action: 'help', args: [] };
  }

  // 未知命令
  if (!COMMANDS[cmd]) {
    return { error: `未知命令：${cmd}。可用命令：${Object.keys(COMMANDS).filter(k => k !== '-h').join(', ')}` };
  }

  // -rollback（v19.27.5 · 审计 P1-4「声明存在但无实现」）：本仓**没有** checkpoint 机制，也没有任何
  //   自动回退脚本——旧版只校验 `--confirm` 就把 `{ok:true, action:'rollback'}` 交出去，主控拿不到任何
  //   可执行动作，只能自己编一套；最坏情况下它会把「已回滚」当成事实写进 status.md。
  //   故在**路由层直接拒绝**（宁可显式不可用，不返回假绿），并给三条真实可行的替代路径。
  if (cmd === '-rollback') {
    return {
      error: '⚠ `-rollback` 在论衡里**没有实现**（本仓不建 checkpoint、无自动回退脚本）。它不会假装成功。三条真实可用的回退路径：\n'
        + '· 正文回退 —— 把 `drafts/初稿-vN.md` 复制为新的 v(N+1)，写 `修订说明-v(N+1).md`；版本号**只增不降**（见 references/deliverables.md）\n'
        + '· 文件级回退 —— 用 git（`git checkout -- <路径>`）或运行前自建的备份目录；论衡自己不保存历史副本\n'
        + '· 阶段级回退 —— 重跑该阶段的角色（T5/T7 等），**不要删产物**：删了会让闸门记录与账本对不上（A7 硬 21）',
    };
  }

  // -cite -auto / -cite -manual 子模式识别
  if (cmd === '-cite') {
    const mode = args[0];
    if (mode === '-auto') return { ok: true, action: 'cite-auto', args: args.slice(1) };
    if (mode === '-manual') return { ok: true, action: 'cite-manual', args: args.slice(1) };
    return { ok: true, action: 'cite', args };
  }

  // -status --pending：跨项目「待我决策」聚合收件箱（v18.62.0 F4）
  //   旗标不改变命令数（真源仍是 COMMANDS 表去 -h 的 13 个）——与 -cite 的三种模式同构。
  if (cmd === '-status' && args.includes('--pending')) {
    return { ok: true, action: 'status-pending', args: args.filter((a) => a !== '--pending') };
  }

  // -gate / -abort（v19.27.8 · 审计 P2-2「主人只有一条腿」）：**主人侧入口**，机械实现 = 同目录
  //   `owner-cli.mjs`（本路由只做参数形状校验与转交，不自己写文件）。
  //   为什么放在路由层校验：`--approve` 与 `--reject` 同时给 / 都不给，是最常见的手滑；在这里拒绝
  //   比让 `owner-cli` 写到一半再报错干净（那里也会拒，两处同判据）。
  if (cmd === '-gate') {
    const hasApprove = args.includes('--approve');
    const hasReject = args.includes('--reject');
    if (hasApprove === hasReject) {
      return { error: '用法：-lunheng -gate <项目> <Phase0|Phase2.5|Phase3.5|Phase5> --approve|--reject [--note "…"]'
        + '\n（`--approve` 与 `--reject` 必须且只能给一个；`--note` 的原文会逐字进回执账本的 rawAnswer）' };
    }
    return { ok: true, action: 'gate', agent: 'owner-cli', args, decision: hasApprove ? 'approve' : 'reject' };
  }
  if (cmd === '-abort') {
    return { ok: true, action: 'abort', agent: 'owner-cli', args };
  }

  return { ok: true, action: COMMANDS[cmd].phase, args };
}

/**
 * 列出所有可用命令（用于 -help）
 */
export function listCommands() {
  return Object.entries(COMMANDS)
    .filter(([k]) => k !== '-h')
    .map(([k, v]) => ({ cmd: k, ...v }));
}

// CLI 调用入口（v1.0.2：可移植判定，见文件头 F6 注）
// ⚠️ v18.62.4（全量审计-v18.62.3 P1-4）：**旧版此处必然走 usage 分支**——
//   旧码 `routeCommand(process.argv)`：`process.argv` 的形状是 `[node, <脚本绝对路径>, …用户参数]`，
//   于是 `routeCommand` 里的 `argv[1] !== '-lunheng'` **恒真**（argv[1] 永远是脚本路径）→
//   命令行调用**永远**打印用法并以 exit 1 结束，下面 help 表与 JSON 打印在真实调用下**不可达**。
//   （单测 `tests/route.test.mjs` 传的是**合成 argv** `['node','-lunheng',…]`，故测不到这个缺陷。）
//   修法：**在入口处剥掉前两位**，把合成 argv 重新交给 `routeCommand`（函数契约不动、22 条单测不受影响）。
//   为什么不在 `routeCommand` 内部判断：它是**单测直接导入的纯函数**，argv 契约
//   （`argv[1] === '-lunheng'`）已被用例钉住，且 `tests/route.test.mjs:142` 专门断言「缺前缀 → 用法错」。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = routeCommand(['node', '-lunheng', ...process.argv.slice(2)]);
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.action === 'help') {
    console.log('可用命令：');
    for (const c of listCommands()) {
      console.log(`  ${c.cmd.padEnd(12)} ${c.desc}`);
    }
    console.log('\n用法：node scripts/route-command.mjs <命令> [参数…]（`-help` / `-h` 均为本帮助）');
    process.exit(0);
  }
  try {
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    // 管道提前关闭（如 `| head -1`）会抛 EPIPE：写不出去不是本命令的错，不该渲染成崩溃
    if (e && e.code !== 'EPIPE') throw e;
  }
}