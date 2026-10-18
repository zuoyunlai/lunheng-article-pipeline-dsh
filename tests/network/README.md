# 联网用例（默认不进 `npm test`）

本目录的文件**不叫** `*.test.mjs`——`npm test` 的 glob 是 `tests/**/*.test.mjs`，所以它们不会被默认执行。
这是 R6 的落地形态：**离线用例守 CI 稳定性，联网用例手动跑**。

## 为什么分开

`ref-verify.mjs` 会向 Crossref 发请求。把它放进默认套件会有两个后果：① 无网环境红；② 被测服务一抖动就红——
两者都会训练人「无视红灯」，而红灯一旦不被信，整个套件就失去意义（本仓既有判据：恒红 = 假绿的前身）。

## 怎么跑

```powershell
$env:REFVERIFY_ONLINE = '1'
node tests/network/ref-verify.online.mjs
```

需要能访问 `api.crossref.org`。用例覆盖：

1. **DOI 命中**：真实 DOI → `found`，且 `backfill` 给出卷/期/页（R3 的产出形态）。
2. **诚实降级**：断网 / 429 风暴下拿不到数据时，结果必须是 `unverified`（exit 3），**不得**变成 `not_found`。
3. **张冠李戴**：DOI 指向另一篇论文 → `partial` + `doi-title-mismatch`（对应 `run/AB-共锁-A` 的 P0-2 形态）。

> 边界：本用例**不**断言"某条中文文献应当 found"——中文期刊在 Crossref 的覆盖率本就低，
> 那种断言会把"覆盖不足"固化成"功能缺陷"（报告 §N2 已明确不采纳）。
