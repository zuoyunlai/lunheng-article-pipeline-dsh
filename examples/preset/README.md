# examples/preset/ — 论衡分档安装指南

> **v18.0.0 复核**：本目录**只有两个文件**——`preset.yml`（给主人读的分档说明）+ 本文件（安装指南），
> **不含任何可加载的 cordis 配置**。分档行为来自包根 `cordis.patch.yml` 的 3 段 `- insert:` 行。
>
> 历史变更（v2.5.2-dsh.12）：早期版本的 `agent.cordis.yml`（≈16KB standard 全量副本）**已删除**——
> DSH 5.5.0+ 的 `cordis-plugin-include` 真正支持 `- insert:` 局部 patch 增量叠加，不再需要"凑出有效"副本
> （凑副本有版本漂移风险：standard 一更新，副本就过期了）。

## 1. 装论衡分档的 3 步（DSH 5.5.0+ 推荐路径）

```sh
# 1. 在 profile 里声明 bundle 依赖（DSH 读 dsh.bundle.patch 找到 cordis.patch.yml 加载）
dsh plugin --profile web add lunheng-article-pipeline@dsh   # 推荐：跟随最新 DSH 迭代版
# 锁定具体版本：dsh plugin --profile web add lunheng-article-pipeline@18.0.0

# 2. （可选）设三档 subagent 工具的 provider/model 环境变量
#    不设任何变量 = 三档全部继承会话模型（安全默认，单模型用户无需本步）
export LUNHENG_RETRIEVAL_PROVIDER=deepseek-official
export LUNHENG_RETRIEVAL_MODEL=deepseek-v4-flash
export LUNHENG_STRONG_PROVIDER=deepseek-official
export LUNHENG_STRONG_MODEL=deepseek-v4-pro
export LUNHENG_AUDIT_PROVIDER=deepseek-official
export LUNHENG_AUDIT_MODEL=deepseek-v4-pro

# 3. 重启 dsh 进程（模型在挂载期求值一次，改完必须重启）
dsh web  # 或 supervisor 自动拉起
```

## 2. 验证

```sh
# ① patch 行进入组合树：3 段 insert 应全部命中
dsh --profile web --dump-config 2>&1 | grep -E "lunheng-article-pipeline|tool-subagent-(retrieval|strong|audit)"

# ② 技能是否真的挂上（技能由包入口注册，不表现为 patch 行）：
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
#   - subagent_retrieval: T1/T2/T3 便宜快
#   - subagent_strong: T4/T5/T6/T9 推理强
#   - subagent_audit: T7 审计 + G14 顶配（不得为省钱降档）
#   - 模型经 LUNHENG_*_PROVIDER + LUNHENG_*_MODEL 环境变量覆盖
```

## 4. provider/model 分离与「未设即继承」

DSH 的 subagent 工具 `agentOptions` 里 `provider`（注册名）与 `model`（裸 id）是**两个字段**。本包每档用**一个**
`!!js` 表达式整块求值（v2.5.2-dsh.17 起，此前是 provider/model 各一个表达式）：

```yaml
agentOptions: !!js "(e => { const p = e.LUNHENG_RETRIEVAL_PROVIDER, m = e.LUNHENG_RETRIEVAL_MODEL; if (e.LUNHENG_TIERING === 'off' || (!p && !m)) return undefined; return Object.assign({}, p ? { provider: p } : {}, m ? { model: m } : {}); })(process.env)"
```

实际行为（与实现一致）：

| 环境变量组合 | 结果 |
|---|---|
| 都不设（或 `LUNHENG_TIERING=off`） | 整块 `undefined` → 该档**继承会话模型**（不报错，最省心，也是默认） |
| 只设 `MODEL` | **生效**（字段独立：`provider` 由宿主逐字段继承父级） |
| 只设 `PROVIDER` | 生效（不写 `model` 时用该 provider 的默认模型） |
| 跨 provider | **必须同时给** `PROVIDER` + `MODEL` |

> 本包**不写死任何厂商默认模型**：宿主没有模型级回退，写错模型会让该档工具直接不可用。正确取值请跑
> `node skills/lunheng-article-pipeline/scripts/model-routing.mjs` 按本机实况生成。

「分档是否生效」**不会有报错提示**：派发前请按 `SKILL.md` 的约定确认三档工具存在且取值符合预期，否则回退 `subagent`。

## 5. 技能如何随包生效（v18.0.0 变更）

v18.0.0 起，技能**不再**由 patch 行挂载：包入口 `lib/index.js` 在 `apply` 期读
`skills/lunheng-article-pipeline/SKILL.md`，经 `ctx.effect(() => ctx.skills.register({ … }))` 注册，`resourceBase`
指向该技能目录（因此 `references/**`、`scripts/**` 的相对引用在任意 cwd 下可解析；卸载时注册自动回滚）。

- **删掉的东西**：早期版本第一段 `- insert:` 行挂 `@deepseek-ai/dsh-skill-filesystem` 提供者
  （`providerName` / `includeDefaultRoots: false` / `customSkillDirs` + 一处 `!!js` 路径求值）。该行连同那处加载期求值一并删除，
  故本包 `!!js` 由 4 处降为 **3 处**，且不再依赖内部包名 `@deepseek-ai/dsh-skill-filesystem`。
- **本包现在的三处 `!!js`**：三段 `agentOptions`（见第 4 节），只用 `process.env.*` 与全局 `Object.assign`。
- **入口回归**：`tests/entry.test.mjs` 用最小 ctx 真执行 `apply`，断言注册字段与 `resourceBase` 下的
  `SKILL.md` / `references/` / `scripts/` 齐备——这正是「入口路径写错 → 技能静默不出现」这类缺陷的机械防线。

## 6. 升级/降级/卸载

```sh
dsh plugin --profile web update lunheng-article-pipeline@dsh
# 卸载后三档 subagent 工具随 - insert 段消失，入口注册的技能同时注销
dsh plugin --profile web remove lunheng-article-pipeline
```
