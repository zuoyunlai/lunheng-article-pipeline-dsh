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
2. **`dsh plugin add` 不会自动加 bundles 清单**：它只把包装进 node_modules 并写进 `dependencies`，第 2 步（手动加 `dsh.profile.bundles`）是必须的——漏掉会导致 bundle 不生效。
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

## 使用

新开会话后，说「加载 lunheng-article-pipeline 技能」，或直接交给它一个深度文章主题。它会先走 Phase 0 定题确认（人在环），确认后自动推进三线并行检索 → 分析 → 写作 → 审计 → 终检。
