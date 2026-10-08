# 沿革外移 — `maintainers.md`（2026-10-08 · 审计优化方向 6 落地 · 批 B）

> **为什么有这份文件**：`repo-hygiene-check` 规则⑨ 对技能目录内 ≥12 KB 的 `.md` 设**逐文件棘轮**；
> 而 `maintainers.md` 的余量已降到 **60 B**（等价「不可再写」）。审计优化方向 6 的判据是
> **「沿革外移 ≠ 删除」**：把**已完成、已修复的成因叙事**搬出正文，正文只留**判据级结论**与指针。
>
> **搬运纪律（本次遵守）**：
> ① **只搬沿革叙事，不搬判据**——凡「下次该怎么判 / 该跑什么」的句子一律留在正文；
> ② **不动任何标题**（一致性规则 ㉗ 的锚点由标题派生，改标题会让引用它的文档断链）；
> ③ **逐字搬运**（不改写、不摘要），保证追溯性不降级；
> ④ 搬完**重跑** `consistency-check` / 全量套 / `repo-hygiene-check`，并**按实测重设棘轮**。

---

## 一、原 `maintainers.md` §六：CI `loader-smoke` 的上游缺陷（**v18.12.1 已修**）

> 正文保留的判据：**CI 里任何一个 job 长期必红，本身就是缺陷**——要么修到绿，要么删掉并写明「为什么不跑这一层」。
> 以下为成因叙事原文（已修，留作复发参照）：

- **现状**：`ci.yml` 的 `loader-smoke` **全绿**。此前**每次必红**（`publish.yml` 的 `gates` 不含它，故不影响发布，但仓面 CI 徽章一直红）。
- **成因（三步都验过）**：① 该 job 走的官方 `dsh-plugin-guide verify` 的 `pack / install / dump-config` **全过**，只倒在自己的 `headless-smoke`；② 错误是 `dsh: user patch-layer watching requires the Cordis HMR service`（栈顶 `dsh-app-boot/lib/index.js:1112`）——是 **DSH 启动失败**，与本包代码无关；③ 根因：`dsh plugin … add` 生成的 profile manifest 写 `"dsh": { "profile": { "patchReload": "live" } }`（`DEFAULT_PROFILE_PATCH_RELOAD = "live"`），而 `profile-boot` 在 `patchReload === "live"` 时调 `watchUserPatches()`，该函数拿不到 `ctx.get('hmr')` 就抛错 → headless 必红。本机用 `dsh plugin --profile smoke add @deepseek-ai/dsh-base` 复现了同一 manifest 形态。
- **修法（v18.12.0 采取的是 ③）**：把 `ci.yml` 里 pin 的 dsh 由 **0.1.5-rc.2 → 0.1.7-rc.2**。**逐版核对过 `@deepseek-ai/dsh-app-boot`**：0.1.5-rc.2 与 rc.3 都仍有 `DEFAULT_PROFILE_PATCH_RELOAD = "live"` 与那条 HMR 守卫；**0.1.7-rc.2 里两者都已不存在**，且内置 `headless` profile（`bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]` + `headless-runner`）。改后 CI 全绿（`loader-smoke in 50s ✓`）。
- **另两条处方（未采用，留给上游）**：① profile manifest 的 `dsh.profile.patchReload` 设 `"startup"`（需改 profile 生成侧，本包够不到）；② 上游把「`patchReload === "live"` 且无 HMR」改为降级而非抛错。
- **教训（判据级）**：本 job 红了**四个版本周期**而无人修，原因是「它在发布门之外」+「报错栈指向 dsh 自己」→ 容易被读成「环境问题，与我无关」。可行判据：**CI 里任何一个 job 长期必红，本身就是缺陷**——要么修到绿，要么删掉并写明「为什么不跑这一层」。

---

## 二、原 `maintainers.md` §三：历史更正与早年误述（原文详注已聚合）

- 历史更正：v18.0.5 修「verify job 不存在」误述；v18.0.1 补 patch 自注册行（v18.0.0 缺陷）；v18.2.4 实证 `disabled` 行级门控；v18.2.6 更正 `!!js` 执行面计数（3→6 处）。

## 三、原 `maintainers.md` §四：`latest` dist-tag 人工兜底命令的退役缘由
- 上述兜底人工命令（`npm dist-tag add <pkg>@<ver> latest --registry=https://registry.npmjs.org`）自 v18.62.10 起**永久退役**——`latest` 改由 OIDC 维护。
  > 正文保留的**现行程序**（不随沿革外移）：OIDC 前移的判读（`✓ latest 已前移` = 无须手工动作）、warning 情形的处置、
  > 以及人工兜底路径的两条坑（`--registry` 不能省、顺序不能颠倒）——它们**不是历史**，是万一 OIDC 不可用时的操作步骤。

## 四、原 `maintainers.md` §三：历史审计与修订方案指针

- 全量审计（v18.7.1 综合评分 7.6/10）与修订方案：`audits/全量审计报告-v18.7.1.md`、`docs/审计与修订记录/论衡插件-修订方案-v18.7.2.md`。

---

*搬运时间：2026-10-08 · 搬运依据：主人批准「批 A + 批 B」· 正文对应位置已留指针*
