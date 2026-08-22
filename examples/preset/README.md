# 论衡分档预设（lunheng preset）

基于 `standard` 预设，额外挂载三档 subagent 工具，供论衡流水线按角色指派模型。

| 工具 | 角色 | 默认模型 | 环境变量 |
|---|---|---|---|
| `subagent_retrieval` | T1 文献 / T2 数据 / T3 案例 | `deepseek-v4-flash` | `LUNHENG_RETRIEVAL_MODEL` |
| `subagent_strong` | T4 分析 / T5 写作 / T6 批判 | `deepseek-v4-pro` | `LUNHENG_STRONG_MODEL` |
| `subagent_audit` | T7 审计 | `deepseek-v4-pro` | `LUNHENG_AUDIT_MODEL` |

## 安装

把本目录两个文件复制到用户预设根：

```
$DSH_HOME/.agent-presets/lunheng/agent.cordis.yml
$DSH_HOME/.agent-presets/lunheng/preset.yml
```

然后新建会话时，在预设选择器里选「论衡分档」。

## 切换模型

```powershell
# 例如：审计档换成 claude-opus-5，检索档保持 deepseek-v4-flash
$env:LUNHENG_AUDIT_MODEL      = "claude-opus-5"
$env:LUNHENG_RETRIEVAL_MODEL  = "deepseek-v4-flash"
dsh web   # 重启生效
```

## 注意

- 模型在**挂载期求值一次**（`!!js`），改环境变量后必须重启 dsh 才生效；
- 若某档未设环境变量，则用上表默认值；
- 论衡技能本身只"建议"用哪个工具派发；真正能否分模型取决于本预设是否挂载了对应工具。
