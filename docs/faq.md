# FAQ

## 为什么 dshmarket 里显示「安装完成但校验失败 / 入口产物缺失」？

这是 dshmarket 的**误报**。它的校验器只认 JS 入口（`main` / `exports` / 兜底 `index.js`），而本插件是**纯 bundle 插件**——入口是 `package.json` 里 `dsh.bundle.patch` 指向的 YAML 补丁 `cordis.patch.yml`，不含 JS 代码。实测技能可正常加载（`dsh --dump-config` 可见 `skill-filesystem-lunheng` 行，headless 会话技能目录能列出本技能）。下次启动不会失败。

## 版本号为什么是 2.2.8-dsh.1？

`-dsh.N` 标记第 N 次 DSH 适配，对应 OpenClaw 正典 2.2.8。DSH 版与 OpenClaw 版分离维护，版本号不共享；正典升级时 DSH 版跟随同步（见 `CONTRIBUTING.md`）。

## 和 OpenClaw 原版的关系？

OpenClaw 原版在 `github.com/zuoyunlai/lunheng-article-pipeline`，本仓库（`lunheng-article-pipeline-dsh`）是其 DSH 端口。维护与同步流程见 `CONTRIBUTING.md`。

## 封面为什么没有文生图？

DSH 无内置图像生成工具，封面降级为 SVG 矢量风（本地，程序化）或主人投喂图片。

## 为什么 T6 案例检索员「任何量级必 spawn」？

为保证三角验证可审计——即使主题「无需案例」，T6 也会显式产出 [C-空] 空卡声明无案例需求，避免留下「到底查没查案例」的模糊地带（教训 #56）。
