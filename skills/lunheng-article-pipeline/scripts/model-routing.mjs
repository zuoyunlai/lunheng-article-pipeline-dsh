#!/usr/bin/env node
// model-routing.mjs —— 能力档探测与「角色→模型」匹配（v2.5.2-dsh.17 新增，第 10 个随包脚本）
//
// 能力档定义（**主人 2026-09-11 指定的四档表**，与 references/_shared/模型路由.md 一一对应）：
//   检索     T1/T2/T3   便宜快（响应快 / token 便宜）   小参数 + 高 token/s（gpt-4o-mini / claude-haiku / 本地 Ollama）  默认：**本地 Ollama + 远程兜底**
//   分析写作 T4/T5      强推理（逻辑链 / 长上下文）      中大参数推理模型（gpt-4o / claude-sonnet / deepseek-reasoner）    默认：远程强推理
//   批判审计 T6/T7/T9/G14  顶配防漏判（严格审计 / 不放水）  顶级推理模型（claude-opus / gpt-4-turbo）              默认：远程顶配
//   主控     T0         稳定路由（多角色协调 / 不崩溃）  中参数稳定模型（gpt-4o / claude-sonnet）                     默认：远程稳定
//   终检     T8         主控亲完成（不 spawn 子代理）    不适用                                                        不适用
//
// 依据（可复核的宿主事实）：
//   · `dsh-subagent` 的 `resolveChildAgentOptions` **逐字段合并** → 只给 `model` 时 `provider` 继承父级；
//   · 宿主**无模型级回退**（`dsh-llm-retry` 只重试）→ 写死一个不存在的模型 = 该档工具不可用 ⇒ **兜底必须在论衡侧做**；
//   · `cordis.patch.yml` 的 `!!js` 不能读文件（CI 红线 ⑭）→ 加载期无法探测模型目录 ⇒ 探测只能由本脚本做。
//
// 用法：
//   node scripts/model-routing.mjs [--dsh-home <path>] [--json] [--no-probe] [--prefer-remote]
//     · 默认**自动探测本地 provider**（仅 `127.0.0.1|localhost`，3s 超时，零外发、不读密钥；`--no-probe` 关闭）
//     · `--prefer-remote`：忽略本地优先，三档全走远端（等价于主人显式选择「不用本地」）
// 返回码：0 = 三档都有主选；3 = 有档位无候选或本地不可达且无兜底（需人工决定）；1 = 读不到配置
// 只读：**从不写** settings.yaml / 环境变量 / 任何配置文件；**从不读取或发送 API Key**（远端一律不探测）。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const noProbe = args.includes('--no-probe');
const preferRemote = args.includes('--prefer-remote');
const homeIdx = args.indexOf('--dsh-home');
const DSH_HOME = (homeIdx >= 0 && args[homeIdx + 1]) ? args[homeIdx + 1] : (process.env.DSH_HOME || join(os.homedir(), '.dsh'));
const settingsPath = join(DSH_HOME, 'settings.yaml');

if (!existsSync(settingsPath)) {
  console.error(`读不到 settings.yaml：${settingsPath}`);
  console.error('用 --dsh-home <path> 指定 DSH_HOME；若你只用 DSH 内置通道（模型目录不在 settings.yaml），请手工指定模型——本脚本不猜。');
  process.exit(1);
}

// ── 零依赖 YAML 扫描：provider → { models[], baseURL, displayName, local } + agent-default-model ──
const parse = (text) => {
  const lines = text.split(/\r?\n/);
  const providers = new Map();
  const stack = [];
  let defaultModel = null, inDefault = false, defaultIndent = -1;
  const ind = (l) => l.match(/^\s*/)[0].replace(/\t/g, '  ').length;
  const key = (l) => (l.match(/^\s*-?\s*([A-Za-z0-9_.\-]+)\s*:/) || [])[1] || null;
  const val = (l) => {
    const m = l.match(/^\s*-?\s*[A-Za-z0-9_.\-]+\s*:\s*(.*)$/);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  };
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const i = ind(line), k = key(line);
    if (!k) continue;
    while (stack.length && stack[stack.length - 1].indent >= i) stack.pop();
    if (k === 'agent-default-model') { inDefault = true; defaultIndent = i; stack.push({ indent: i, key: k }); continue; }
    if (inDefault) {
      if (i > defaultIndent) { defaultModel = { ...(defaultModel || {}), [k]: val(line) }; continue; }
      inDefault = false;   // 用「块缩进」判断退出：回查栈会因出栈而失败，从而吞掉后续顶层键（单测抓到的真 bug）
    }
    const pv = stack.find((s) => s.key === 'providers');
    if (k === 'providers') { stack.push({ indent: i, key: k }); continue; }
    if (pv && i > pv.indent) {
      const inModels = stack.some((s) => s.key === 'models');
      if (k === 'models') { stack.push({ indent: i, key: k }); continue; }
      const nameFrame = [...stack].reverse().find((s) => s.provider);
      if (!inModels && !nameFrame) {
        if (!providers.has(k)) providers.set(k, { name: k, models: [], baseURL: '', displayName: '', section: (stack[0]?.key || '') });
        stack.push({ indent: i, key: k, provider: k });
        continue;
      }
      if (nameFrame) {
        const p = providers.get(nameFrame.provider);
        if (k === 'displayName') p.displayName = val(line);
        if (k === 'baseURL') { p.baseURL = val(line); p.local = /(127\.0\.0\.1|localhost|\[::1\])/.test(p.baseURL); }
        if (k === 'id' && inModels) { p.models.push({ id: val(line), contextWindow: 0, maxTokens: 0 }); stack.push({ indent: i, key: k }); continue; }
        if (inModels && p.models.length && (k === 'contextWindow' || k === 'maxTokens')) p.models[p.models.length - 1][k] = Number(val(line)) || 0;
      }
    }
    stack.push({ indent: i, key: k });
  }
  return { providers, defaultModel };
};

const { providers, defaultModel } = parse(readFileSync(settingsPath, 'utf8'));
if (providers.size === 0) {
  console.error(`settings.yaml 未解析到任何 provider 目录：${settingsPath}`);
  process.exit(1);
}

// ── 本地 provider 可达性探测（默认开启；仅回环地址，零外发）──
const localProbe = {};
if (!noProbe) {
  for (const [, p] of providers) {
    if (!p.local || !p.baseURL) continue;
    const url = p.baseURL.replace(/\/$/, '') + '/models';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const txt = await res.text();
      const ids = [...new Set([...txt.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))];
      localProbe[p.name] = { ok: res.ok, status: res.status, advertised: ids.slice(0, 12) };
      if (res.ok && ids.length) {
        // 以本机实际广告的模型为准（settings 可能过期）——把广告里有、settings 里没有的补进候选池
        for (const id of ids) if (!p.models.some((m) => m.id === id)) p.models.push({ id, contextWindow: 0, maxTokens: 0 });
      }
    } catch (e) {
      localProbe[p.name] = { ok: false, error: String((e && e.message) || e) };
    }
  }
}
const localUsable = (name) => (noProbe ? true : localProbe[name]?.ok === true);

// ── 能力画像（启发式，仅用于排序；`MiniMax` 含 mini/max ⇒ 必须用词边界，首跑实测踩过）──
const SPEED = /\b(flash|lite|mini|small|nano|tiny|turbo|oss|air|haiku)\b|(?:^|[^a-z])(?:qwen|gemma|phi)(?:\d)?|:[0-9]{1,2}b|-?[0-9]{1,2}b\b/i;
const REASON = /\b(pro|max|plus|ultra|thinking|reasoner|reasoning|opus|sonnet|large|70b|72b|235b|405b)\b|\bM[0-9]+(?:\.[0-9]+)?\b/i;
const NO_REASONING = /\b(vision|embed|embedding|rerank|whisper|tts|audio|image|dall|sd)\b/i;
const versionOf = (id) => {
  const m = id.match(/\bM(\d+(?:\.\d+)?)\b/i) || id.match(/\bv(\d+(?:\.\d+)?)\b/i) || id.match(/(\d+(?:\.\d+)?)\s*$/);
  return m ? Number(m[1]) : 0;
};
const ctxScore = (n) => (n >= 200000 ? 3 : n >= 100000 ? 2 : n >= 32000 ? 1 : 0);

const inventory = [];
for (const [, p] of providers) {
  for (const m of p.models) {
    const id = m.id;
    if (NO_REASONING.test(id)) continue;                       // 非对话模型不入池
    const speed = SPEED.test(id), reason = REASON.test(id);
    inventory.push({
      id, provider: p.name, local: !!p.local,
      reachable: p.local ? localUsable(p.name) : true,
      // 本地模型**不按命名判「快」**：本机推理速度取决于算力，命名启发式无法判断
      fast: p.local ? 1 : (speed && !reason ? 3 : speed ? 2 : reason ? 1 : 2),
      reasoning: p.local ? 1 : (reason ? 3 : speed ? 1 : 2),
      context: m.contextWindow || 0,
      version: versionOf(id),
    });
  }
}
const usable = inventory.filter((c) => c.reachable);
if (usable.length === 0) {
  console.error('没有可用模型（本地不可达且无远端候选）——请检查 settings.yaml 的 provider 配置。');
  process.exit(3);
}

// ── 四档定义（主人指定表；T9 归入「批判审计」档——推断，见文档注）──
const TIERS = [
  {
    key: 'retrieval', tool: 'subagent_retrieval', roles: ['T1 文献检索', 'T2 数据检索', 'T3 案例检索'],
    need: '便宜快（响应快 / token 便宜）',
    pool: '小参数 + 高 token/s（gpt-4o-mini / claude-haiku / 本地 Ollama）',
    strategy: '本地优先 + 远程兜底',
    weight: { fast: 3, reasoning: 1, context: 1 },
    localFirst: true,
  },
  {
    key: 'strong', tool: 'subagent_strong', roles: ['T4 分析（大纲）', 'T5 写作'],
    need: '强推理（逻辑链 / 长上下文）',
    pool: '中大参数推理模型（gpt-4o / claude-sonnet / deepseek-reasoner）',
    strategy: '远程强推理',
    weight: { fast: 1, reasoning: 3, context: 3 },
    localFirst: false,
  },
  {
    key: 'audit', tool: 'subagent_audit', roles: ['T6 批判', 'T7 审计', 'T9 审稿', 'G14 检测'],
    need: '顶配防漏判（严格审计 / 不放水）',
    pool: '顶级推理模型（claude-opus / gpt-4-turbo）',
    strategy: '远程顶配（**不得为省钱降档**）',
    weight: { fast: 0, reasoning: 3, context: 3 },
    localFirst: false,
  },
];

const scoreOf = (c, t) => {
  let s = 0;
  s += (t.weight.fast || 0) * c.fast;
  s += (t.weight.reasoning || 0) * c.reasoning;
  s += (t.weight.context || 0) * ctxScore(c.context);
  // 检索档：本地优先（可用则压过远端）；其余档位本地不加分（顶配/强推理走远端）
  if (t.localFirst && c.local && !preferRemote) s += 10;
  if (c.provider === defaultModel?.provider) s += 0.5;
  s += (t.key === 'retrieval' ? -0.3 : 0.3) * c.version;
  return s;
};
const ranked = (t) => [...usable].sort((a, b) => scoreOf(b, t) - scoreOf(a, t));

const routing = TIERS.map((t) => {
  const list = ranked(t);
  const top = list[0] || null;
  // 兜底链：本地主选 → 同档次优的**远端**候选（宿主无模型级回退，兜底由论衡在主控侧执行）
  const fallback = top && top.local ? list.find((c) => !c.local) || null : (list[1] || null);
  const second = list[1];
  return {
    tier: t.key, tool: t.tool, roles: t.roles, need: t.need, pool: t.pool, strategy: t.strategy,
    pick: top ? top.id : null,
    pickProvider: top ? top.provider : null,
    pickLocal: !!(top && top.local),
    crossProvider: !!(top && defaultModel?.provider && top.provider !== defaultModel.provider),
    fallback: fallback ? { model: fallback.id, provider: fallback.provider, local: !!fallback.local } : null,
    candidates: list.slice(0, 3).map((c) => `${c.id}@${c.provider}${c.local ? '(本地)' : ''}`),
    confidence: top && second && Math.abs(scoreOf(top, t) - scoreOf(second, t)) < 0.4 ? 'low' : 'medium',
  };
});

// ── 主控档（T0）：不参与路由，只给「稳定性」建议（它就是会话模型）──
const t0Pool = usable.filter((c) => !c.local);
const t0Pick = (t0Pool.length ? [...t0Pool] : [...usable])
  .sort((a, b) => (b.version + b.reasoning * 0.5 + (b.context >= 100000 ? 1 : 0)) - (a.version + a.reasoning * 0.5 + (a.context >= 100000 ? 1 : 0)))[0] || null;
const t0 = {
  role: 'T0 主控',
  need: '稳定路由（多角色协调 / 不崩溃）',
  pool: '中参数稳定模型（gpt-4o / claude-sonnet）',
  strategy: '远程稳定；**不参与分档路由**（它就是当前会话模型）',
  current: defaultModel || null,
  suggest: t0Pick ? `${t0Pick.id}@${t0Pick.provider}` : null,
  howToChange: '改 DSH 的 `agent-default-model`（settings.yaml）或会话内模型选择——**不由论衡自动改**（改宿主配置属主人动作）',
};
const t8 = { role: 'T8 终检', need: '主控亲完成（不 spawn 子代理）', pool: '不适用', strategy: '不适用' };

const anyMissing = routing.some((r) => !r.pick) || routing.some((r) => r.pickLocal && !r.fallback);
const envOf = (r) => {
  const P = `LUNHENG_${r.tier.toUpperCase()}`;
  return r.crossProvider
    ? [`$env:${P}_PROVIDER = '${r.pickProvider}'`, `$env:${P}_MODEL = '${r.pick}'`]
    : [`$env:${P}_MODEL = '${r.pick}'`];
};
const out = {
  dshHome: DSH_HOME, settings: settingsPath,
  defaultModel: defaultModel || null,
  localProbe: noProbe ? '（--no-probe：未探测本地）' : localProbe,
  inventory,
  routing, t0, t8,
  envSnippet: {
    note: '同 provider 只写 _MODEL（provider 逐字段继承父级）；**跨 provider 必须同时写 _PROVIDER**；设置后重启 DSH 生效。',
    powershell: [...new Set(routing.filter((r) => r.pick).flatMap(envOf))],
    bash: [...new Set(routing.filter((r) => r.pick).flatMap((r) => envOf(r).map((l) => l.replace(/^\$env:/, 'export ').replace(/ = /, '='))))],
  },
  fallbackPolicy: '宿主**无模型级回退**：某档模型报错时，主控按「兜底链」改派——① 该档 fallback（脚本已给）；② 仍失败 → 设 LUNHENG_TIERING=off 用分档工具但继承会话模型；③ 再失败 → 用标准 subagent 重派并在进展页如实记录。',
  safeDefault: '不设任何 LUNHENG_* 变量 = 三档全部继承会话模型（任何 provider 都能跑）。',
  killSwitch: 'LUNHENG_TIERING=off = 强制全部继承（即便其它变量已设）。',
  boundary: '原生「按调用选模型」（list_subagent_models + provider/model 参数）需宿主侧服务与 Agent/preset scope，本包不默认开启（缺服务会在加载期抛错）；见 references/_shared/模型路由.md。',
};

if (wantJson) { console.log(JSON.stringify(out, null, 2)); process.exit(anyMissing ? 3 : 0); }

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n=== 能力档路由规划（只读；DSH_HOME=${DSH_HOME}）===`);
console.log(`默认模型（agent-default-model）：${defaultModel ? `${defaultModel.provider} / ${defaultModel.model}` : '（未配置）'}`);
console.log('\n候选池（能力画像为启发式；本地模型不按命名判「快」）：');
for (const c of [...usable].sort((a, b) => b.reasoning - a.reasoning || b.fast - a.fast)) {
  console.log(`  ${pad(c.id, 30)} ${pad(c.provider, 20)} fast=${c.fast} reasoning=${c.reasoning} ctx=${c.context || '?'}${c.local ? ' [本地·' + (noProbe ? '未探测' : '可达') + ']' : ''}`);
}
if (!noProbe && Object.keys(localProbe).length) {
  console.log('\n本地 provider 探测（仅回环地址，零外发）：');
  for (const [k, v] of Object.entries(localProbe)) console.log(`  ${pad(k, 20)} ${v.ok ? `✓ 可达（广告 ${v.advertised?.length || 0} 个模型）` : `✗ 不可达：${v.error || v.status}`}`);
}
console.log('\n能力档 → 模型 路由：');
for (const r of routing) {
  const head = r.pick ? `${r.pick}@${r.pickProvider}` : '**无候选 → 该档留空（继承会话模型）**';
  console.log(`  ${pad(r.tool, 20)} [${pad(r.tier, 9)}] ${r.roles.join(' / ')}`);
  console.log(`     需求：${r.need}　｜　策略：${r.strategy}`);
  console.log(`     主选：${head}${r.crossProvider ? '（跨 provider：需同时设 _PROVIDER）' : ''}${r.confidence === 'low' ? '（候选接近，需人工确认）' : ''}`);
  if (r.fallback) console.log(`     兜底：${r.fallback.model}@${r.fallback.provider}${r.fallback.local ? '（本地）' : '（远程）'}`);
  if (r.candidates?.length) console.log(`     候选：${r.candidates.join(' / ')}`);
}
console.log(`  ${pad('（不参与路由）', 20)} [session  ] ${t0.role}：${t0.strategy}`);
console.log(`     现用：${t0.current ? `${t0.current.provider} / ${t0.current.model}` : '（未配置）'}　｜　建议：${t0.suggest || '（无候选）'}`);
console.log(`     如何改：${t0.howToChange}`);
console.log(`  ${pad('（不适用）', 20)} [n/a      ] ${t8.role}：${t8.strategy}`);
if (anyMissing) console.log('\n⚠️ 有档位缺主选或缺兜底：**不要硬填模型名**（宿主无模型级回退，写错 = 该档不可用）→ 该档留空即继承。');
console.log('\n若要启用分档（可选，需重启 DSH 生效）：');
out.envSnippet.powershell.forEach((l) => console.log('  ' + l));
console.log(`\n兜底策略：${out.fallbackPolicy}`);
console.log(`安全默认：${out.safeDefault}`);
console.log(`一键退路：${out.killSwitch}`);
console.log(`边界：${out.boundary}\n`);
process.exit(anyMissing ? 3 : 0);
