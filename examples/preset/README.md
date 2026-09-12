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
# 锁定具体版本：dsh plugin --profile web add lunheng-article-pipeline@18.2.1

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
#   - subagent_strong: T4/T5 推理强
#   - subagent_audit: T6 批判 / T7 审计 / T9 审稿 / G14 检测 顶配（不得为省钱降档）
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

## 5. 技能如何随包生效（v18.0.0 变更；v18.0.1 补自注册行）

**链路完整版**：patch 第一段 `- insert:` 插入**本包自注册行**（`- id: lunheng-article-pipeline` / `name: lunheng-article-pipeline`）→ loader 按包名解析到 `package.json#main` → **import `lib/index.js`** → 其 `apply` 读 `skills/lunheng-article-pipeline/SKILL.md`，经 `ctx.effect(() => ctx.skills.register({ … }))` 注册技能，`resourceBase` 指向该技能目录（因此 `references/**`、`scripts/**` 的相对引用在任意 cwd 下可解析；卸载时注册自动回滚）。

> ⚠️ **自注册行是承重的**：`package.json#main` **不会**因为「包被列进 profile 的 `bundles`」就自动执行——**patch 里的行才是会被 import 的东西**（官方 `publish.zh.md`：插件行按包名引用本包，Node 的模块解析才能找到已安装的代码）。v18.0.0 删掉旧挂载行时漏补这一行 → 组合树里 `name: lunheng-article-pipeline` 行数为 0 → **入口从不被加载、技能不注册**；18.0.1 修复，并由 `tests/bundle-contract.test.mjs` 机械防守（该测试跑已发布的 18.0.0 产物会红）。

- **删掉的东西**：早期版本第一段 `- insert:` 行挂 `@deepseek-ai/dsh-skill-filesystem` 提供者
  （`providerName` / `includeDefaultRoots: false` / `customSkillDirs` + 一处 `!!js` 路径求值）。该行连同那处加载期求值一并删除，
  故本包 `!!js` 由 4 处降为 **3 处**，且不再依赖内部包名 `@deepseek-ai/dsh-skill-filesystem`。
- **本包现在的三处 `!!js`**：三段 `agentOptions`（见第 4 节），只用 `process.env.*` 与全局 `Object.assign`。
- **入口回归**：`tests/entry.test.mjs` 用最小 ctx 真执行 `apply`，断言注册字段与 `resourceBase` 下的
  `SKILL.md` / `references/` / `scripts/` 齐备；`tests/bundle-contract.test.mjs` 断言「patch 恰有一行 `name == 包名`」。
  两条合起来才是完整防线：前者证明「入口能跑」，后者证明「入口会被加载」。

## 7. 可选：把三档工具行移进 agent preset（v18.1.0 新增配方，**未在真实部署验证**）

上面的 3 步是**默认路径**：三行 `- insert:` 在**包级** `cordis.patch.yml`，因此**该 profile 的每个会话**都能看到三个分档工具。

若希望「**只有选定了该预设的会话**才有这三个工具」，官方机制是**把同样的行挂到 preset 组合里**（工具注册落在该 preset 的作用域层：`docs/subsystems/tools.md:484-504`、`docs/subsystems/skills.md:13`；`docs/architecture.md:131` 是入口判据）。完整配方（三步 + 每步验证 + 回滚 + 五条已知限制）见
[`../../skills/lunheng-article-pipeline/references/_shared/DSH-集成方案.md`](../../skills/lunheng-article-pipeline/references/_shared/DSH-集成方案.md) **§八**。

**三个要点先看**：① 官方知识库里**没有任何 preset 组合文件的完整示例**，且预设组合文件名（「preset cordis.yml」vs `agent.cordis.yml`）只有摘要级依据——**照抄你部署里已存在的预设目录**；② **预设只在会话空白期可切**（跑了就别换）；③ 本包**默认不动** patch（「装了不坏」优先），换作用域需要你自己选预设。

---

## 8. 升级/降级/卸载

```sh
dsh plugin --profile web update lunheng-article-pipeline@dsh
# 卸载后三档 subagent 工具随 - insert 段消失，入口注册的技能同时注销
dsh plugin --profile web remove lunheng-article-pipeline
```
