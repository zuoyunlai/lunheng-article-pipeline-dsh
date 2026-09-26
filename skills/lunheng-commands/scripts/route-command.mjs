#!/usr/bin/env node
// route-command.mjs — /lunheng <cmd> [args] 路由到论衡阶段
// 版本：v1.0.1
// 本脚本为论衡（lunheng-article-pipeline v18.7.0+）的薄壳 wrapper 命令解析器
// 不引入新角色 / 新阶段 / 新 M 门；所有重活仍走论衡子代理

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
  '-rollback': { phase: 'rollback', desc: '回滚到 checkpoint（需 --confirm 二次确认）' },
  '-status':   { phase: 'status',   desc: '显示当前进度（≤15 行人类可读）' },
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

  // 二次确认检查（-rollback 必填 --confirm）
  if (cmd === '-rollback' && !args.includes('--confirm')) {
    return { error: '⚠ -rollback 需要 --confirm 二次确认（防误操作）。示例：-lunheng -rollback phase-25-outline --confirm' };
  }

  // -cite -auto / -cite -manual 子模式识别
  if (cmd === '-cite') {
    const mode = args[0];
    if (mode === '-auto') return { ok: true, action: 'cite-auto', args: args.slice(1) };
    if (mode === '-manual') return { ok: true, action: 'cite-manual', args: args.slice(1) };
    return { ok: true, action: 'cite', args };
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

// CLI 调用入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = routeCommand(process.argv);
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.action === 'help') {
    console.log('可用命令：');
    for (const c of listCommands()) {
      console.log(`  ${c.cmd.padEnd(12)} ${c.desc}`);
    }
    console.log('\n帮助：-lunheng -help');
    process.exit(0);
  }
  console.log(JSON.stringify(result, null, 2));
}