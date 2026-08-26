# 论衡分档预设（lunheng preset）

基于 `standard` 预设，额外挂载三档 subagent 工具，供论衡流水线按角色能力指派模型（检索便宜快 / 分析写作批判推理强 / 审计顶配）。

> **通用性（v2.3.7-dsh.6）**：本预设是**可选优化**。只配了一个模型的用户**无需安装本预设**——论衡所有角色默认继承会话模型，任何模型配置都能跑。装预设只对「配了多个模型、想按角色能力分档」的用户有意义。

| 工具 | 角色 | 能力定位 | 默认 provider/model（可覆盖） |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | 便宜快（抽取+分类） | 继承父会话（未设环境变量时） |
| `subagent_strong` | T4 分析 / T5 写作 / T6 批判 / T9 审稿 | 推理强（分析/成文/批判/评审） | 继承父会话（未设环境变量时） |
| `subagent_audit` | T7 审计 / G14 检测 | 顶配防漏判 | 继承父会话（未设环境变量时） |

> **v2.5.2-dsh.4 审计修订**：未设任何 `LUNHENG_*` 环境变量时，三档工具不覆盖模型（继承父会话）——**任何模型配置都能安全安装本预设**；设了 `LUNHENG_*_PROVIDER` 才按角色分档（model 默认 `deepseek-v4-flash/pro`，可再覆盖）。

## 安装

把本目录两个文件复制到用户预设根：

```
$DSH_HOME/.agent-presets/lunheng/agent.cordis.yml
$DSH_HOME/.agent-presets/lunheng/preset.yml
```

然后新建会话时，在预设选择器里选「论衡分档」。

## 切换模型（按角色覆盖）

**provider 与 model 分离**（DSH 架构要求：model 是裸 id，provider 单独指定；跨 provider 必须同时设两者，否则 dsh-llm 报 NO_ADAPTER）：

```powershell
# 检索档：便宜快（例：换 minimax 便宜模型）
$env:LUNHENG_RETRIEVAL_PROVIDER = "minimax"
$env:LUNHENG_RETRIEVAL_MODEL    = "MiniMax-M2.7"

# 强档：分析/写作/批判/审稿用推理强模型
$env:LUNHENG_STRONG_PROVIDER    = "deepseek-official"
$env:LUNHENG_STRONG_MODEL       = "deepseek-v4-pro"

# 审计档：顶配防漏判（T7 审计 + G14 中文 AI 痕迹检测）
$env:LUNHENG_AUDIT_PROVIDER     = "minimax"
$env:LUNHENG_AUDIT_MODEL        = "MiniMax-M3"

dsh web   # 重启生效（模型挂载期求值一次）
```

provider 名必须是你 dsh 已注册的 LLM provider（查 `settings.yaml` 的 `llm-pi-ai.providers` 或 `agent-default-model.provider`），model 是该 provider 下的裸模型 id。

## 注意

- 模型在**挂载期求值一次**（`!!js`），改环境变量后必须重启 dsh 才生效；
- 若某档未设 `LUNHENG_*_PROVIDER`，该档不覆盖模型（继承父会话）——单模型/未配 deepseek 的用户装本预设也安全，所有角色仍继承会话模型；
- 设了 PROVIDER 而未设 MODEL 时，用档位默认模型（retrieval=`deepseek-v4-flash`、strong/audit=`deepseek-v4-pro`）；
- 论衡技能本身只"建议"用哪个工具派发（见 pipeline-readme「DSH 分档预设接线」）；真正能否分模型取决于本预设是否挂载了对应工具。
