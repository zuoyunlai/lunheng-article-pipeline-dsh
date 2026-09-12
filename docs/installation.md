# 安装与验证

> profile 名以你机器的实际配置为准：本机 profile 位于 `$DSH_HOME/profiles/` 下（例如 `desktop`、`web` 或自定义名），下面示例统一写作 `<profile>`，请替换成实际目录名（如 `--profile desktop`）。

## 安装（dsh）

```sh
# 1) 装进 profile 的 node_modules
dsh plugin --profile <profile> add lunheng-article-pipeline

# 2) 把 bundle 加入 profile 清单
#    $DSH_HOME/profiles/<profile>/package.json
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lunheng-article-pipeline"] } }

# 3) 重启 dsh
```

安装后技能自动出现在会话的 `skill` 工具目录，无需手动复制到技能根。

## 安装前提与注意事项

1. **需要 pnpm**：`dsh plugin add` 内部转 pnpm，目标机器需有 pnpm；没有则先：
   ```sh
   corepack enable && corepack prepare pnpm@latest --activate
   ```
2. **`dsh plugin add` 会自动加 bundles 清单（新版 dsh）**：`reconcilePlugins` 会把声明了 `dsh.bundle` 的依赖自动追加进 `dsh.profile.bundles`（按依赖顺序），装完重启即可。仅当**绕过 `dsh plugin` 用纯 npm/pnpm 直接安装**、或使用**旧版 dsh** 时，才需要手动编辑第 2 步（把包名加进 `dsh.profile.bundles`）。
3. **dshmarket 市场**：v18.0.0 起本包带 JS 包入口（`main` → `lib/index.js`），「只认 JS 入口」的校验器不再误报（详见 `docs/faq.md`）。

## 验证

```sh
# 本包自注册行 + bundle 层 + 三档工具行应出现在组合树中
dsh --profile <profile> --dump-config
#   预期看到：  # == lunheng-article-pipeline
#              - id: lunheng-article-pipeline      ← 自注册行（缺它 = 入口不会被 import，技能不注册）
#              - id: tool-subagent-retrieval
#              - id: tool-subagent-strong
#              - id: tool-subagent-audit
```

> ⚠️ **`- id: lunheng-article-pipeline` 这一行是承重的**：loader 靠它按包名 import 本包入口（`package.json#main` → `lib/index.js`），入口的 `apply` 才会执行 `ctx.skills.register()`。**只有层头 `# == lunheng-article-pipeline` 而没有这一行，说明技能不会注册**（v18.0.0 的真实缺陷，18.0.1 修复；回归防线 `tests/bundle-contract.test.mjs`）。

技能本身由包入口 `lib/index.js` 在加载期经 `ctx.skills.register()` 注册，**不表现为独立配置行**——技能是否真的挂上仍需会话目录验证（下一条）。

空目录 headless 验证（排除本地技能根干扰，确认技能仅来自 bundle）：

```sh
mkdir -p /tmp/empty-cwd && cd /tmp/empty-cwd
dsh --profile <headless-profile> "请调用 skill 工具列出你可见的技能名称"
# 预期输出包含：lunheng-article-pipeline
```

## 分档预设（按角色分模型，可选，通用化）

**单模型用户无需任何配置**——默认所有角色继承会话模型，任何模型配置都能跑。分档只对「配了多个模型、想按角色能力分档」的用户有意义（检索便宜快 / 分析写作推理强 / 批判审计审稿顶配）：

| 工具 | 角色 | 能力定位 | 默认 provider/model（可覆盖） |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | 便宜快 | 继承父会话（设 `LUNHENG_RETRIEVAL_*` 才分档） |
| `subagent_strong` | T4 分析 / T5 写作 | 推理强 | 继承父会话（设 `LUNHENG_STRONG_*` 才分档） |
| `subagent_audit` | T6 批判 / T7 审计 / T9 审稿 / G14 检测 | 顶配防漏判 | 继承父会话（设 `LUNHENG_AUDIT_*` 才分档） |

**分档随 bundle 生效，无需复制任何预设目录**（`examples/preset/` 只是说明文档，不含可加载的 `agent.cordis.yml`）：安装本包即在 profile 里插入上述三档工具行。

```sh
# 换模型：设环境变量后重启 dsh（模型在挂载期求值一次，改完必须重启）
#    ⚠️ provider 与 model 分离：model 是裸 id，provider 必须单独指定
export LUNHENG_AUDIT_PROVIDER=minimax
export LUNHENG_AUDIT_MODEL=MiniMax-M3
dsh --profile <profile>
```

- 不设任何 `LUNHENG_*`：三档全部继承会话模型（安全默认）；某档工具未挂载时，派发回退到 `subagent`。
- 模型在挂载期用 `!!js` 求值一次，改环境变量后**必须重启 dsh** 才生效。
- **v2.5.2-dsh.4 修订：未设 `LUNHENG_*_PROVIDER` 的档不覆盖模型（继承父会话）——任何模型配置都能安全装预设**；设了 PROVIDER 未设 MODEL 才用档位默认模型（retrieval=deepseek-v4-flash / strong·audit=deepseek-v4-pro）。
- provider 名须是你 dsh 已注册的 LLM provider（查 `settings.yaml` 的 `agent-default-model.provider`）。
- 完整说明见 `examples/preset/README.md`。

## 使用

新开会话后，说「加载 lunheng-article-pipeline 技能」，或直接交给它一个深度文章主题。它会先走 Phase 0 定题确认（人在环），确认后自动推进三线并行检索 → 分析 → 写作 → 审计 → 终检。
