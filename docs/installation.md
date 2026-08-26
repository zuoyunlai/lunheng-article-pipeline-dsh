# 安装与验证

## 安装（dsh）

```sh
# 1) 装进 profile 的 node_modules
dsh plugin --profile web add lunheng-article-pipeline

# 2) 把 bundle 加入 profile 清单
#    $DSH_HOME/profiles/web/package.json
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lunheng-article-pipeline"] } }

# 3) 重启 dsh web
```

安装后技能自动出现在会话的 `skill` 工具目录，无需手动复制到技能根。

## 安装前提与注意事项

1. **需要 pnpm**：`dsh plugin add` 内部转 pnpm，目标机器需有 pnpm；没有则先：
   ```sh
   corepack enable && corepack prepare pnpm@latest --activate
   ```
2. **`dsh plugin add` 会自动加 bundles 清单（新版 dsh）**：`reconcilePlugins` 会把声明了 `dsh.bundle` 的依赖自动追加进 `dsh.profile.bundles`（按依赖顺序），装完重启即可。仅当**绕过 `dsh plugin` 用纯 npm/pnpm 直接安装**、或使用**旧版 dsh** 时，才需要手动编辑第 2 步（把包名加进 `dsh.profile.bundles`）。
3. **dshmarket 市场会显示「校验失败」误报**：它只认 JS 入口（`main`/`exports`/`index.js`），不认 `dsh.bundle.patch`，会把论衡误标「入口产物缺失」。**实际安装与使用不受影响**（见 `docs/faq.md`）。

## 验证

```sh
# bundle 行应出现在组合树中
dsh --profile web --dump-config
#   预期看到：  # == lunheng-article-pipeline
#              - id: skill-filesystem-lunheng
```

空目录 headless 验证（排除本地技能根干扰，确认技能仅来自 bundle）：

```sh
mkdir -p /tmp/empty-cwd && cd /tmp/empty-cwd
dsh --profile headless-lunheng-test "请调用 skill 工具列出你可见的技能名称"
# 预期输出包含：lunheng-article-pipeline
```

## 分档预设（按角色分模型，可选，通用化）

**单模型用户无需本预设**——默认所有角色继承会话模型，任何模型配置都能跑。装预设只对「配了多个模型、想按角色能力分档」的用户有意义（检索便宜快 / 分析写作批判审稿推理强 / 审计顶配）：

| 工具 | 角色 | 能力定位 | 默认 provider/model（可覆盖） |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | 便宜快 | 继承父会话（设 `LUNHENG_RETRIEVAL_*` 才分档） |
| `subagent_strong` | T4 分析 / T5 写作 / T6 批判 / T9 审稿 | 推理强 | 继承父会话（设 `LUNHENG_STRONG_*` 才分档） |
| `subagent_audit` | T7 审计 / G14 检测 | 顶配防漏判 | 继承父会话（设 `LUNHENG_AUDIT_*` 才分档） |

```sh
# 1) 复制预设到用户预设根（Windows 用 copy / xcopy 同理）
cp -r examples/preset "$DSH_HOME/.agent-presets/lunheng"

# 2) 新会话在预设选择器里选「论衡分档」

# 3) 换模型：设环境变量后重启 dsh（模型挂载期求值一次，改完必须重启）
#    ⚠️ provider 与 model 分离：model 是裸 id，provider 必须单独指定
export LUNHENG_AUDIT_PROVIDER=minimax
export LUNHENG_AUDIT_MODEL=MiniMax-M3
dsh web
```

- 不装预设：技能回退到 `subagent`，所有角色继承会话模型（对多数场景够用）。
- 模型在挂载期用 `!!js` 求值一次，改环境变量后**必须重启 dsh** 才生效。
- **v2.5.2-dsh.4 修订：未设 `LUNHENG_*_PROVIDER` 的档不覆盖模型（继承父会话）——任何模型配置都能安全装预设**；设了 PROVIDER 未设 MODEL 才用档位默认模型（retrieval=deepseek-v4-flash / strong·audit=deepseek-v4-pro）。
- provider 名须是你 dsh 已注册的 LLM provider（查 `settings.yaml` 的 `agent-default-model.provider`）。
- 完整说明见 `examples/preset/README.md`。

## 使用

新开会话后，说「加载 lunheng-article-pipeline 技能」，或直接交给它一个深度文章主题。它会先走 Phase 0 定题确认（人在环），确认后自动推进三线并行检索 → 分析 → 写作 → 审计 → 终检。
