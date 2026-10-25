# OpenViking 记忆服务故障核查报告（embedding 凭据 401）

- 核查日期：2026-10-25 16:36–16:50（Asia/Shanghai）
- 核查人：主控（DSH 会话 `session-da8d4449`）
- 触发点：v19.27.12 发版交付时，两条长期记忆写入连续返回「写入未被确认」；随后 `mnemon_recall` 返回 401
- 核查方式：只读诊断 + 3 次最小写入探针（全部已清理，见 §8）
- 结论一句话：**OpenViking 服务活着、文本能写、但服务端 embedding 凭据全部 401 失效 → 向量索引建不起来 → 检索全废、写入被误报失败、健康检查假绿**

---

## 1. 故障现象（按发现顺序）

1. 交付报告里写长期记忆，`mnemon_runtime_memory`（`target=memory`）连续两次失败，错误原文：

   ```
   OpenViking write was not verified at viking://user/default/memories/events/20261025083335-e-herness-…_context-f9fbe9e6-….md;
   remote content may remain. Inspect this URI before retrying.
   content API did not confirm this exact memory and completed indexing
   ```

2. 查该 URI：**文件存在且内容正确**（正是那条待写记忆）。也就是说「失败」是误报，写其实是成功的。

3. `mnemon_recall`（smart 模式）返回：

   ```
   unavailable: default: unavailable: Upstream model authentication failed (HTTP 401):
   The API key doesn't exist. Request id: 0217929172071315c037dcb8e3ed606fc7cba25b86789db816e00
   ```

4. 换 `mode="keyword"`（自认为最不依赖模型的降级路）——**同样 401**。

5. MCP `search`（list 模式）直接报 `UNAUTHENTICATED: Upstream model authentication failed (HTTP 401)`；
   而 `grep` / `read` / `list`（纯文本面）**正常工作**，实测能命中记忆原文。

---

## 2. 根因证据（决定性）

绕过插件，用 `<用户主目录>/.openviking/ovcli.conf` 里的 `url` + `api_key` 直连服务端写入一条诊断文案：

```
POST {url}/api/v1/content/write
{ "uri": "viking://user/default/memories/events/<ts>-ovdiag-z9q1_context.md",
  "content": "…", "mode": "create", "wait": true, "timeout": 60 }
```

HTTP **200**，返回体关键字段：

```json
"written_bytes": 94, "content_updated": true, "context_type": "memory",
"mode": "create",
"semantic_status": "skipped",
"vector_status": "failed",                       ← 决定性
"queue_status": {
  "Semantic":  { "processed": 0, "error_count": 0, "errors": [] },
  "Embedding": { "processed": 0, "error_count": 2, "errors": [
     "Failed to generate embedding: All credentials failed:
        - agentplan: auth - Volcengine embedding failed: Error code: 401 -
          {'error': {'code': 'AuthenticationError', 'message': \"The API key doesn't exist.\", 'type': 'Unauthorized'}}, request_id: ToB-direct,OpenViking_Service,openviking-service_cn-beijing
        - codeplan:  auth - …同一 401…
        - volcengine: auth - …同一 401…" ] } }
```

随即 `GET /api/v1/content/read?uri=…` 返回的正是写入原文（一字不差）。

**判定：**

| 层 | 状态 | 依据 |
| --- | --- | --- |
| 本机配置文件 key | **正常** | 同一把 key 能建会话、写文件、读回、`fs/ls`（200） |
| 服务可达性 | **正常** | `/api/v1/system/status` → `{"initialized":true,"user":"default"}` |
| 文本存储 | **正常** | `content_updated: true`，读回内容一致 |
| **服务端 embedding 凭据** | **全失效** | 三档凭据 agentplan / codeplan / volcengine **全部** 401 `The API key doesn't exist` |
| 向量索引 | **未建立** | `vector_status: "failed"`，`Embedding.error_count: 2` |

即：坏的是 **OpenViking 云端服务（`openviking-service_cn-beijing`）调用火山 embedding 的那把钥匙**，与本地 DSH、本机 key、插件版本都无关。

---

## 3. 派生出来的三个"假象"

### 3.1 写入被误报失败（内容其实已落盘）

插件 `<DSH profile>/node_modules/dsh-mnemon-provider-openviking/lib/index.js` 的 `remember()` 在写入后做严格确认：

```js
if (written?.uri !== uri || written.content_updated !== true || written.written_bytes !== writtenBytes
    || written.mode !== "create" || written.context_type !== "memory"
    || written.vector_status !== "complete"                     // ← 恒为 "failed"
    || !["complete","skipped"].includes(String(written.semantic_status))
    || queueFailed(written.queue_status)) throw new Error("content API did not confirm this exact memory and completed indexing");
```

只要 `vector_status !== "complete"` 就一定抛错，于是**每一次本该成功的写入都被判失败**。这解释了：
- 为什么失败提示里带「remote content may remain」——插件自己也不确定；
- 为什么"失败"的记忆文件其实都在盘上。

### 3.2 健康检查假绿

- MCP `health` → `OpenViking is healthy (service initialized, user: default)`
- `mnemon_status` → `healthy: true`，同时 `aggregate.totalInsights: 0`、`spaces: 0`

两个健康信号都只查"服务初始化了没有"，不查"索引能不能用"。真实状态是：**索引里 0 条可检索项**，而磁盘上有 183 个记忆文件。这一格是最容易骗过人的地方——绿着，但记忆检索实际上是死的。

### 3.3 检索全废，只剩文本面

| 能力 | 实测 | 原因 |
| --- | --- | --- |
| `mnemon_recall` smart | 401 | 需要上游模型 |
| `mnemon_recall` keyword | 401 | 服务端仍走 semantic 通路 |
| MCP `search` / `find` | 401 `UNAUTHENTICATED` | 向量检索 |
| MCP `grep` / `read` / `list` | ✅ 正常 | 纯文本，不走向量 |

含义：**历史记忆事实上不可"语义召回"**，只能靠关键词逐文件 grep。对本项目（论衡大量跨会话记忆）影响显著：`mnemon_recall` 返回"无证据"时，不能理解为"没记过"，而应理解为"检索不可用"。

---

## 4. 数据现状：183 个文件，只有 60 条记忆

对 `viking://user/default/memories/events` 做 `fs/ls`（`output=original`，`node_limit=2000`）后按「文件名去掉时间戳与 UUID」归并：

- 文件 **183** 个，合计 **139 KB**
- 不同内容 **60** 条 ⇒ **冗余 123 个（占 67%）**

重复最重的几组：

| 份数 | 大小 | 记忆 |
| --- | --- | --- |
| **26×** | 404 B | `e-herness-是论衡运行工作区-run-项目-下是交付证据-final-定稿-md-证据包`（工作区声明） |
| **25×** | 704 B | `chart-tool-quirk-windows-svg-urls-returned-via-t…` |
| 8× | 752 B | `lunheng-article-pipeline-dsh-v18-10-0-发布教训-2026-…` |
| 6× ×5 组 | ~800 B | 发布流 / 发布卡点 / 版本级联 bump / loader-smoke / openclaw 环境 / destructive-write bak / 假绿陷阱 等 |

按日期分布可见两次成因：

```
0926  43    0927  46    0928  23    0929  22      ← 四次批量重导（同一批 20 余条被反复导入）
1005   8    1006   2    1007   1    1008   2 …     ← 之后是零散的"失败→重试"累积
1020   5    1021   8    1022   5    1023   3    1024   5    1025   3
```

**机理**：写入被判失败 → 调用方（人/agent）重试 → 又写成一个新文件（`content/write` 的 `mode:create` 不按内容去重，URI 里带时间戳与 UUID）→ 冗余随时间线性累积。这些副本都没有向量，既不参与检索、又占着存储。

---

## 5. 附带发现：运行时热记忆已到 98.3%

核查期间为验证写入通路，加了一条探针条目再删掉，两次调用返回的用量：

- 加之前 → 加之后：`entryCount 17`、`used 10157 / limit 10240 B`（**99.2%**）
- 删探针后：`entryCount 16`、`used 10068 / 10240 B`（**98.3%**）

含义与风险：热记忆接近上限会触发"把已提交条目归档进 Memory Space"，而**归档走的正是上面这条已坏的写入链**——于是每次 `add` 都可能变成「先归档（失败）→ 整个调用报错」，形成 §4 里那种"失败→重试"的循环。这也是我这次两次写记忆失败的近因。

---

## 6. 影响评估

| 面 | 影响 | 严重度 |
| --- | --- | --- |
| 跨会话记忆召回 | 完全不可用（仅剩 grep） | **高**——历史经验等于读不出来 |
| 记忆写入 | 内容能存，但每次报错并诱发重试 | **高**——数据噪声持续增长 |
| 健康监控 | 假绿，无法发现本故障 | 中——问题会被长期掩盖 |
| 热记忆容量 | 98.3%，逼近归档阈值 | 中——会放大上面的写入失败 |
| 其它 OpenViking 能力（session/messages/commit/skills） | 未受影响 | 低 |

---

## 7. 修复建议

### 7.1 主人侧（本机无法修，必须服务端）

1. 到 VikingDB / 方舟控制台，为 `openviking-service_cn-beijing` 这套 OpenViking 服务**续上有效的 embedding 凭据**（返回体显示它会依次尝试 `agentplan` / `codeplan` / `volcengine` 三档，三档全部 401 说明不是单点过期，而是整体未授权/未配置）。
2. 修好后跑一次验收（判据见 §7.4）：`vector_status` 必须回到 `complete`，`Embedding.error_count` 必须为 0。
3. 对存量：跑一次去重（123 个冗余），并对已写入但未向量化的 183 个文件做一次重建索引。

### 7.2 上游插件侧（可提 issue）

`dsh-mnemon-provider-openviking` 的 `remember()` 把 `vector_status === "complete"` 当作写入成功的**硬条件**，导致"文本已落盘"被报成"什么都没存"。建议改为：

- 文本确认（`content_updated` / `written_bytes` / 读回一致）→ 判 **已存储**；
- `vector_status !== "complete"` → 降级为**警告**并在回执里带 `vectorStatus: "failed"` 与原因，而不是抛失败；
- 否则调用方看到的永远是失败，只会做无意义的重试（本例已产生 123 个冗余）。

### 7.3 本机可立即做（风险低）

1. **热记忆瘦身**：16 条 / 98.3%，先合并同类项，给归档留出空间。
2. **去重脚本**（等 §7.1 修好再跑，避免又触发失败链）：按内容哈希分组，每组保留最早一份，其余 `forget`。
3. **自查习惯**：`mnemon_recall` 返回"无证据"时，先看是否 401，不要把"检索不可用"读成"没记过"；需要记忆内容时改用 `grep`。

### 7.4 验收判据（复现方法）

直连服务端写一条探针，看返回体：

```js
// 端点与 key 取自 <用户主目录>/.openviking/ovcli.conf
POST {url}/api/v1/content/write
{ uri: "viking://user/default/memories/events/<ts>-ovdiag_context.md",
  content: "<任意一句>", mode: "create", wait: true, timeout: 60 }
```

| 字段 | 健康 | 本次实测 |
| --- | --- | --- |
| `content_updated` | `true` | `true` ✅ |
| `semantic_status` | `complete` / `skipped` | `skipped` ✅ |
| **`vector_status`** | **`complete`** | **`failed`** ❌ |
| `queue_status.Embedding.error_count` | `0` | `2` ❌ |
| `queue_status.Embedding.errors[0]` | （空） | `401 The API key doesn't exist`（agentplan / codeplan / volcengine 三档）❌ |

---

## 8. 本次核查的痕迹清理

| 动作 | 结果 |
| --- | --- |
| 写 1 条诊断探针（`…-ovdiag-z9q1_context.md`） | 已 `forget` 删除 |
| 2 条"失败"的记忆写入实际产生的文件（内容 = 工作区声明，与既有 24 份重复） | 已 `forget` 删除（183 个文件是清理后的数字） |
| 热记忆里新增的探针条目（`ZZPROBE9 …`） | 已 `remove`，回到 16 条 / 10068 B |
| 临时诊断脚本（`_audit_tmp/ov-diag.mjs`、`count*.mjs`、`sys.mjs`） | 已删除 |
| `run/<项目>`、仓库源码、版本号 | **未触碰**（本报告是唯一新增文件） |

**未做（需主人决定）**：123 个冗余文件的批量去重、热记忆瘦身、向上游提 issue。

---

## 9. 一句话给未来的自己

> 记忆写入报「未被确认」时，先直连 `content/write` 看 `vector_status`：
> 只要它是 `failed`，问题在服务端 embedding 凭据，**不要再重试写入**（只会多造副本）。
