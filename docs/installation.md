# 安装与验证

> profile 名以你机器的实际配置为准：本机 profile 位于 `$DSH_HOME/profiles/` 下（例如 `desktop`、`web` 或自定义名），下面示例统一写作 `<profile>`，请替换成实际目录名（如 `--profile desktop`）。

## 安装（dsh）

```sh
# 1) 装进 profile 的 node_modules
#    ⚠️ **务必钉版本**：不写 `@<版本>` 时，装到哪个版本取决于本机包管理器**当时**的解析状态。
#    实测过一次：同一条命令装到 **18.15.0**，而 registry 上的 `latest` 已是 18.20.4 —— 差了五个小版本，
#    且按下面流程走下去**没有任何一步能让人察觉**。版本真源只有一处：`npm view lunheng-article-pipeline version`。
dsh plugin --profile <profile> add lunheng-article-pipeline@18.20.4

# 1b) **核对装到的版本**（钉了版本也值得跑一次——它读的是 profile 里**实际落盘**的 package.json）
node -e "console.log(require('<DSH_HOME>/profiles/<profile>/node_modules/lunheng-article-pipeline/package.json').version)"

# 2) 把 bundle 加入 profile 清单
#    $DSH_HOME/profiles/<profile>/package.json
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lunheng-article-pipeline"] } }

# 3) 重启 dsh
```

安装后**两个**技能自动出现在会话的 `skill` 工具目录，无需手动复制到技能根：
- `lunheng-article-pipeline`：主技能，9 角色流水线
- `lunheng-commands`：伴随技能，11 个 `/lunheng-*` 斜杠命令（status / stats / compression-cycle / evidence-bundle / m-gate / handoff-check 等；薄壳 wrapper，不引入新角色 / 新 M 门）

## 安装前提与注意事项

1. **需要 pnpm**：`dsh plugin add` 内部转 pnpm，目标机器需有 pnpm；没有则先：
   ```sh
   corepack enable && corepack prepare pnpm@latest --activate
   ```
2. **`dsh plugin add` 会自动加 bundles 清单（新版 dsh）**：`reconcilePlugins` 会把声明了 `dsh.bundle` 的依赖自动追加进 `dsh.profile.bundles`（按依赖顺序），装完重启即可。仅当**绕过 `dsh plugin` 用纯 npm/pnpm 直接安装**、或使用**旧版 dsh** 时，才需要手动编辑第 2 步（把包名加进 `dsh.profile.bundles`）。
3. **dshmarket 市场**：v18.0.0 起本包带 JS 包入口（`main` → `lib/index.js`），「只认 JS 入口」的校验器不再误报（详见 `docs/faq.md`）。
4. **宿主（`@deepseek-ai/dsh`）版本**（三次复审 N-4，如实声明）：本包 `peerDependencies` 写 `>=0.1.2-rc.1 <0.2.0`，但**真实装载冒烟（CI 的 `loader-smoke`）只在 `0.1.7-rc.2` 上跑过**——声明区间宽于实测证据。
   已知不兼容：`0.1.5-rc.2` / `rc.3` 的 `dsh-app-boot` 在 profile 的 `patchReload: "live"`（`dsh plugin add` 生成的默认值）且无 HMR 时会抛 `requires the Cordis HMR service` → **headless 启动必红**，与本包代码无关（`pack` / `install` / `dump-config` 三个前置子步全过）。规避：用 `0.1.7-rc.2` 及以上，或避开 headless 启动路径。
   > 该「声明宽于证据」的差额何时收口（CI 加最低版本 leg ↔ 收紧 peer 声明）见三次复审报告 §三.3 定案 1。

## 验证

```sh
# 本包自注册行 + bundle 层应出现在组合树中
dsh --profile <profile> --dump-config
#   预期看到：  # == lunheng-article-pipeline
#              - id: lunheng-article-pipeline      ← 自注册行（缺它 = 入口不会被 import，技能不注册）
#              - id: tool-subagent-retrieval       ← 以下三行是**声明行**，见下方 ⚠️
#              - id: tool-subagent-strong
#              - id: tool-subagent-audit
```

> ⚠️ **`--dump-config` 是「声明视图」，不反映装载态**——三档工具行的存在**不能**证明它们已挂载。
> `disabled` 由 loader 在**装载期**求值裁剪（`refresh()` 首行即 `if (this.disabled) return`），
> 而 dump 打印的是**声明**。实测：同一条命令在 `LUNHENG_TIERING` **未设 / `on` / `off` 三种取值下
> 都输出这三行**——三种状态**完全不可区分**。
> 故本步只能证明「**bundle 层存在 + 自注册行存在**」（这两条才是承重项），**不能**用来判断分档是否生效。
> tiering 的可见性只能在**真实会话**里看工具清单（即下一条）。

> ⚠️ **`- id: lunheng-article-pipeline` 这一行是承重的**：loader 靠它按包名 import 本包入口（`package.json#main` → `lib/index.js`），入口的 `apply` 才会执行 `ctx.skills.register()`。**只有层头 `# == lunheng-article-pipeline` 而没有这一行，说明技能不会注册**（v18.0.0 的真实缺陷，18.0.1 修复；回归防线 `tests/bundle-contract.test.mjs`）。

技能本身由包入口 `lib/index.js` 在加载期经 `ctx.skills.register()` 注册，**不表现为独立配置行**——技能是否真的挂上仍需会话目录验证（下一条）。

空目录 headless 验证（排除本地技能根干扰，确认技能仅来自 bundle）：

```sh
mkdir -p /tmp/empty-cwd && cd /tmp/empty-cwd
dsh --profile <headless-profile> "请调用 skill 工具列出你可见的技能名称"
# 预期输出包含：lunheng-article-pipeline 与 lunheng-commands（两技能目录均出现）
```

## 分档预设（按角色分模型，可选，通用化）

**单模型用户无需任何配置**——默认所有角色继承会话模型，任何模型配置都能跑。分档只对「配了多个模型、想按角色能力分档」的用户有意义（检索便宜快 / 分析写作推理强 / 批判审计审稿顶配）：

| 工具 | 角色 | 能力定位 | 默认 provider/model（可覆盖） |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | 便宜快 | 继承父会话（设 `LUNHENG_RETRIEVAL_*` 才分档） |
| `subagent_strong` | T4 分析 / T5 写作 | 推理强 | 继承父会话（设 `LUNHENG_STRONG_*` 才分档） |
| `subagent_audit` | T6 批判 / T7 审计 / T9 审稿 / G14 检测 | 顶配防漏判 | 继承父会话（设 `LUNHENG_AUDIT_*` 才分档） |

**分档随 bundle 生效，无需复制任何预设目录**（`examples/preset/` 只是说明文档，不含可加载的 `agent.cordis.yml`）：**v18.2.6 起三档工具行默认不装载**——未设任何 `LUNHENG_*` 时它们不挂载（三档全继承时它们与内置 `subagent` 完全同义，无条件装载等于每会话白付 3 份工具 schema）；设任一档的 `PROVIDER`/`MODEL`，或 `LUNHENG_TIERING=on`，才装载；`LUNHENG_TIERING=off` 优先级最高（强制不装载）。

```sh
# 换模型：设环境变量后重启 dsh（模型在挂载期求值一次，改完必须重启）
#    ⚠️ provider 与 model 分离：model 是裸 id，provider 必须单独指定
export LUNHENG_AUDIT_PROVIDER=minimax
export LUNHENG_AUDIT_MODEL=MiniMax-M3
dsh --profile <profile>
```

- 不设任何 `LUNHENG_*`：三档行**不装载**，派发用内置 `subagent`（继承会话模型，安全默认）；设了 `off` 同样不装载。
- 模型在挂载期用 `!!js` 求值一次，改环境变量后**必须重启 dsh** 才生效。
- **v2.5.2-dsh.4 修订：未设 `LUNHENG_*_PROVIDER` 的档不覆盖模型（继承父会话）——任何模型配置都能安全装预设**；设了 PROVIDER 未设 MODEL 才用档位默认模型（retrieval=deepseek-v4-flash / strong·audit=deepseek-v4-pro）。
- provider 名须是你 dsh 已注册的 LLM provider（查 `settings.yaml` 的 `agent-default-model.provider`）。
- 完整说明见 `examples/preset/README.md`。

## 三个开关与三条工具路径（v18.2.6 新增）

### 环境变量与 Config

| 开关 | 取值 | 作用 | 备注 |
|---|---|---|---|
| `LUNHENG_QUIET` | `1` / `true` | 静音**info 级**启动状态行（「已注册原生工具」之类） | **warn 永不静音**——「静默降级」正是 v18.0.0 事故的形态，降级/失败始终可见 |
| `LUNHENG_ALLOW_MECH_EDIT` | `1` / `true` | **主人授权例外**：放行 write/edit 类工具对机制文件（技能包内 `SKILL.md` / `AGENTS.md` / `references/**` / `scripts/**` / `cordis.patch.yml`）的写入 | 授权是**主人的动作**，agent 不得自行声明；改机制文件的推荐路径仍是「写 `audits/反哺报告-vN.md` → 主人在 host shell 审阅后 apply」 |
| `LUNHENG_TIERING` | `on` / `off` | `on` = 显式装载三档工具行（不指定模型也可，用于确认工具可见）；`off` = 强制不装载 | 优先级最高，压过其它 `LUNHENG_*` |
| `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_{PROVIDER,MODEL}` | provider 名 / 模型 id | 分档取值；**设任一档即同时装载三行** | 跨 provider 时才需同时给 PROVIDER + MODEL |

同名的**部署开关**走插件 `config`（v18.2.6 起入口导出 `Config`）：`allowMechanismEdit` / `quiet` / `scriptTimeoutMs`（原生工具跑脚本的超时，默认 120 000 ms）/ `scriptMaxOutputBytes`（单次 stdout/stderr 采集上限，默认 4 MiB）/ `handoffLevel`（交接门灰度开关：`basic` = 仅验存在/非空/回报六要素；`strict` = 加结构/版本/成对/agents-log 校验；默认 `basic`）。写在你 profile 里本插件行上：

```yaml
- id: lunheng-article-pipeline
  name: lunheng-article-pipeline
  config: { quiet: true, scriptTimeoutMs: 180000 }
```

**非法配置在加载期响亮失败**（Cordis 用 standard-schema 校验并抛错），不会静默回落到默认值；`dsh --profile <profile> --dump-config` 可见。口径：**env 是操作者开关**（主人授权、CI 静音、临时排障），**Config 是部署开关**（随 profile 走、可 review）。

### 三条工具路径的可用性差异（如实声明）

同一件机检有三条执行路径，**它们不等价**——`SKILL.md` 说「两条路径等价、脚本仍是唯一真源」指的是**退出码与 JSON 契约同源**，不是可用性相同：

| 路径 | 依赖 | 受限环境下的表现 |
|---|---|---|
| ① 原生工具 `lunheng_m_gate` / `lunheng_char_count` / `lunheng_handoff_check` | bundle 部署（入口跑过）+ 宿主有 `tools` 服务 + `@deepseek-ai/dsh-tools` 可解析 | 工具本体在**宿主进程内**，但脚本由 `lib/tools.js` **派生子进程**执行 → 沙箱禁子进程管道时失败（错误信息会明确写 EPERM 并提示改用 `pwsh`） |
| ② `pwsh` 调脚本 `node scripts/<脚本>.mjs …` | 会话里有命令工具（`pwsh`/`bash`） | 沙箱**整体禁止派生子进程**时不可用（v18.2.2 记录过整段 `pwsh` 失效的实例）——此时该如实记「本机无法执行机检」 |
| ③ 纯技能目录部署直接跑脚本 | 只把 `skills/lunheng-article-pipeline/` 拷进技能根 | **没有**路径 ①（入口不跑 → 无原生工具、无 guard、无 `/lunheng-status`、无 `/lunheng-stats` 两条人类命令），只剩 `pwsh`/命令工具 |

> **人类命令只在路径 ① 存在**：`/lunheng-status`（读 `run/<项目>/status.md`）与 `/lunheng-stats`（跨项目遥测看板，白名单只放行 `--json`）都由 `lib/commands.js` 经 `ctx.commands.register()` 注册，**入口不跑就没有它们**。纯技能目录部署（路径 ③）下要用看板，只能照旧 `pwsh` 跑 `scripts/lunheng-stats.mjs`——**退出码与 JSON 契约同源，可用性不同**。

**纪律**：三条路径全废时**停机报告主人**，**不得**用 LLM 断言充当闸门实据（见 `SKILL.md` §执行能力边界）。

## 使用

新开会话后，说「加载 lunheng-article-pipeline 技能」，或直接交给它一个深度文章主题。它会先走 Phase 0 定题确认（人在环），确认后自动推进三线并行检索 → 分析 → 写作 → 审计 → 终检。
