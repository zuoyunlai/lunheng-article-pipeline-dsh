# examples/preset/ — 论衡分档 preset 安装指南

> **v2.5.2-dsh.12 重大变更**：早期版本的 `agent.cordis.yml`（≈16KB standard 全量副本）**已删除**——
> DSH 5.5.0+ 的 `cordis-plugin-include` 真正支持 `- insert:` 局部 patch 增量叠加，不再需要"凑出有效"副本
> （凑副本有版本漂移风险：standard 一更新，副本就过期了）。
>
> 现在装分档只要：① 把 `cordis.patch.yml` 放到包根（已就位）② 用户的 profile 声明 `lunheng-article-pipeline` 为 bundle 依赖。

## 1. 装论衡分档的 3 步（DSH 5.5.0+ 推荐路径）

```sh
# 1. 在 profile package.json 声明 bundle 依赖
#    （DSH 会读 dsh.bundle.patch 找到 cordis.patch.yml 加载）
dsh plugin --profile web add lunheng-article-pipeline@2.5.2-dsh.14

# 2. 设三档 subagent 工具的 provider/model 环境变量
#    （未设时各档抛错 → 必须显式声明，DSH 安装时提示授权）
export LUNHENG_RETRIEVAL_PROVIDER=deepseek-official
export LUNHENG_RETRIEVAL_MODEL=deepseek-v4-flash
export LUNHENG_STRONG_PROVIDER=deepseek-official
export LUNHENG_STRONG_MODEL=deepseek-v4-pro
export LUNHENG_AUDIT_PROVIDER=deepseek-official
export LUNHENG_AUDIT_MODEL=deepseek-v4-pro

# 3. 重启 dsh 进程
dsh web  # 或 supervisor 自动拉起
```

## 2. 验证

```sh
# 验证 patch 行进入组合树（4 段 insert 应全部命中）
dsh --profile web --dump-config 2>&1 | grep -E "skill-filesystem-lunheng|tool-subagent-(retrieval|strong|audit)"

# 验证论衡技能可见
dsh headless --profile web "列出当前可见的技能"
# 预期：lunheng-article-pipeline
```

## 3. preset.yml 仅是分档说明文件

`preset.yml` 不是 DSH 加载的 cordis 配置——它**只是给主人读的分档说明**。
真要装分档行为，看 `../../cordis.patch.yml`（包根）里的 3 档 subagent 工具。

```sh
# preset.yml 的内容：
# name: 论衡分档
# description: 三档 subagent 工具按角色能力分模型
#   - subagent_retrieval: T1/T2/T3 便宜快（默认 deepseek-v4-flash）
#   - subagent_strong: T4/T5/T6/T9 推理强（默认 deepseek-v4-pro）
#   - subagent_audit: T7 审计 + G14 顶配（默认 deepseek-v4-pro）
#   - 模型经 LUNHENG_*_PROVIDER + LUNHENG_*_MODEL 环境变量覆盖
```

## 4. provider/model 分离原则（DSH 架构要求）

DSH 的 subagent 工具 `agentOptions` 字段**要求** `provider`（注册名）+ `model`（裸 id）同时声明。
本包 cordis.patch.yml 的 3 档 subagent 都用 `!!js` 求值环境变量：

```yaml
provider: !!js "process.env.LUNHENG_RETRIEVAL_PROVIDER || undefined"
model: !!js "(process.env.LUNHENG_RETRIEVAL_PROVIDER ? (process.env.LUNHENG_RETRIEVAL_MODEL || 'deepseek-v4-flash') : undefined)"
```

> **更正（v2.5.2-dsh.13）**：上面这段**就是包根 `cordis.patch.yml` 的实际写法**（此前本文档展示的 `|| (() => { throw … })()` 变体从未实装，属文档与实现相反，已修正）。

实际行为（与实现一致）：

| 环境变量组合 | 结果 |
|---|---|
| 都不设 | 两值皆 `undefined` → 该档**静默继承会话模型**（不报错，最省心） |
| 只设 `PROVIDER` | `model` 取档位默认（retrieval=`deepseek-v4-flash` / strong·audit=`deepseek-v4-pro`） |
| 只设 `MODEL` | **静默无效**（`provider` 为 undefined → 该档仍继承会话模型）——跨 provider 必须成对指定 |

因此「分档是否生效」**不会有报错提示**：派发前请按 `SKILL.md` 的约定确认三档工具存在且 provider/model 符合预期，否则回退 `subagent`。

## 5. 与 skills/ 目录的 skill-filesystem provider

cordis.patch.yml 第一段（id: `skill-filesystem-lunheng`）是 skill filesystem 提供者配置：

```yaml
- insert:
    - id: skill-filesystem-lunheng
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: skill-filesystem-lunheng
        includeDefaultRoots: false
        customSkillDirs:
          - !!js "process.getBuiltinModule?.('node:url')?.fileURLToPath(new URL('node_modules/lunheng-article-pipeline/skills/', baseUrl))"
```

要点：
- `providerName: skill-filesystem-lunheng`（v2.5.2-dsh.12 命名规范以 `skill-filesystem-*` 前缀区分系统默认）——这是论衡自己的提供者 namespace，与 system 默认 `filesystem` 不冲突
- `includeDefaultRoots: false`：本行只贡献本包的 `skills/`，不重复扫描项目/用户根（避免和系统技能根重复加载）
- `customSkillDirs` 需要**绝对路径**（provider 内部对每项做 `path.resolve(root)`，相对路径会按进程 cwd 解析，不可靠）；绝对化由本文件的 `!!js` 表达式完成：`decodeURIComponent(new URL('node_modules/lunheng-article-pipeline/skills/', baseUrl).pathname)`（`baseUrl` 由宿主锚定在 profile 目录，故与安装位置无关）
- 该表达式**只用** `process.platform` 与全局 `URL`（v2.5.2-dsh.13 起不再用 `getBuiltinModule`，并把这条写进 CI 红线）

## 6. 升级/降级/卸载

```sh
dsh plugin --profile web update lunheng-article-pipeline@2.5.2-dsh.14
# 卸载后 subagent 工具和 skill provider 一起消失（因 cordis.patch.yml 整体 - insert 段）
dsh plugin --profile web remove lunheng-article-pipeline
```
