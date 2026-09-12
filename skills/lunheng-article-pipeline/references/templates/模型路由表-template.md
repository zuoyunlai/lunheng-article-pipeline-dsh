# 模型路由表 — <项目名>

> 版本：v18.0.5（DSH bundle 插件）
> 来源：`node scripts/model-routing.mjs --json`（**只读脚本**：探测本机 provider×模型、本地可达性，并按四档能力表出建议）
> 位置：`run/<项目名>/model-routing.md`　｜　产出者：**主控**（Phase 0 定题时落盘；本机模型/provider 变化或发生回退时更新）
> 用途：① 派发时按表选工具档位；② 交付说明「成本指标」引用本表说明「各角色实际用哪个模型」；③ 回退留痕。

## 一、本机实况（脚本输出，勿手改）

- **默认模型**（`agent-default-model`）：<provider> / <model>
- **本地 provider 探测**（仅回环地址，零外发）：<provider> ✓ 可达（广告 N 个模型） / ✗ 不可达（<原因>）
- **候选池**：<id@provider fast=… reasoning=… ctx=…>（本地标 `[本地]`）

## 二、四档路由（结论）

| 能力档 | 角色 | 主选 | 兜底 | 依据 |
|--------|------|------|------|------|
| 检索 | T1 / T2 / T3 | <model@provider> | <model@provider>（远程） | 便宜快；**本地优先 + 远程兜底** |
| 分析写作 | T4 / T5 | <model@provider> | <…> | 强推理 + 长上下文 |
| 批判审计 | T6 / T7 / T9 / G14 | <model@provider> | <…> | 顶配防漏判（**不得为省钱降档**） |
| 主控 | T0 | 会话模型（**不参与路由**） | — | 稳定性建议：<model@provider>（改 `agent-default-model` 属主人动作） |
| 终检 | T8 | 不适用 | — | 主控亲执行，不 spawn |

> 路由粒度是**档位**（同档角色必然同模型）：改档位映射 = 改 `LUNHENG_<TIER>_MODEL`（跨 provider 另需 `LUNHENG_<TIER>_PROVIDER`）。

## 三、是否已启用（勾选一项）

- [ ] **已启用分档**：已设 `LUNHENG_*_MODEL`（跨 provider 另设 `_PROVIDER`），**已重启 DSH** → 派发按档位选 `subagent_retrieval/strong/audit`
- [ ] **未启用（全继承会话模型）**：在 `进展-主人版.md` 与播报中如实标注「未启用分层」，**不得声称已分层**
- 主人待执行的启用命令（host shell，需重启 DSH）：`<脚本给出的片段>`

## 四、回退记录（**每一级回退都必须留痕**）

| 时间 | 档位 | 现象 | 处置 |
|------|------|------|------|
| <HH:MM> | <retrieval> | <本地 provider 拒连 / 模型名不存在 / 超时> | <改用 fallback <model> / 设 LUNHENG_TIERING=off 全继承 / 回退标准 subagent> |
