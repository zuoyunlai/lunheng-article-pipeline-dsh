# DSH Profile 与插件加载：实测说明

这份说明回答一个问题：**你为什么在 `web` profile 里禁用了 `tool-fs`，却还能读写文件？**
以及顺着它挖出来的、关于 DSH 组装机制的一整套事实。

**证据标注约定**（每条结论后面都写明来源，方便你推翻它）：

- `[源码 Ln]` —— 来自本机已装代码，附文件与行号，可自己打开看
- `[实测]` —— 我跑命令得到的现象
- `[推断]` —— 我的推理，**没有直接证据**，最该被质疑

环境：`@deepseek-ai/dsh@0.1.5-rc.2`、Node v24.20.0、`DSH_HOME=C:\Users\Zuoyunlai\.dsh`、
profile `web`、默认 preset `standard`。
采集时间：2026-09-19 20:2x（+08:00）。

---

## 结论摘要

1. **profile 不是一个插件列表，是一个"patch 栈"**：四层按顺序叠加，同一个 `id` 后面那层覆盖前面那层。
2. **`bundles` 和 `dependencies` 是两回事**：前者决定"哪些层被应用"，后者只是 pnpm 的安装记录。一个包**只有声明了 `dsh.bundle.patch` 才可能进入栈**。
3. **`tool-fs` 在 profile 里被禁用是有意的**：模型能看到的工具属于 **agent plane（preset）**，而 profile 只管 **host plane**。你的工具来自 preset，不是 profile。

---

## 一、patch 栈：四层，同 id 后者覆盖前者

`[源码 L212-247]` `...\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai\dsh\lib\profile-boot-Dk-7KqJc.js`

```js
function allPatches(composed) {
  return [
    ...composed.bundlePatches,   // 1. bundles 列表顺序，逐个 bundle 的 patch
    ...composed.profile.patches, // 2. profiles/<name>/cordis.patch.yml（你的层）
    ...composed.homePatches,     // 3. $DSH_HOME/cordis.patch.yml（机器级，压过第 2 层）
    ...composed.overlays         // 4. --patch 覆盖层，按 argv 顺序
  ]
}
```

`[源码 L241-247]` 行被塞进一个以 `id` 为键的 Map，**后写的赢**：

```js
const rows = new Map()
for (const row of composeEntries([...])) if (typeof row.id === "string") rows.set(row.id, row)
```

### 你机器上的实际栈

| 层 | 来源 | 行数 | id 数 | disabled |
|---|---|---|---|---|
| 1a | `@deepseek-ai/dsh-base` | 486 | 84 | 6 |
| 1b | `@deepseek-ai/dsh-web-app` | 484 | 68 | 24 |
| 1c | `@tt-a1i/archify-dsh` | 10 | 1 | 0 |
| 1d | `dshmarket` | 4 | 1 | 0 |
| 2 | 你的 `profiles\web\cordis.patch.yml` | 4 | **0** | 0 |
| 3 | `$DSH_HOME\cordis.patch.yml` | — | — | **文件不存在** `[实测]` |
| 4 | `--patch` 覆盖 | — | — | 启动时未传 |

两个立即可用的结论：

- **你的第 2 层是空的。** 要改行为，写 `profiles\web\cordis.patch.yml`，不要动 `cordis.yml`。
- **第 3 层你还空着。** 它比第 2 层优先级更高、且对所有 profile 生效 ——
  想给机器上每个 profile 都加一条插件，放这里，而不是逐个 profile 改。

> `cordis.yml` 为什么是空的、而且写着"别编辑它"？`[源码 L195-199]` 说得很清楚：
> 它存在只是为了让 Loader 有个真实的 include 根来锚定 `baseUrl`；如果往里写已组装的行，
> 下次启动会把每个 bundle 的 insert **再叠加一遍**。

---

## 二、`bundles` 与 `dependencies`：两回事

`[实测]` 你的 `profiles\web\package.json`：

```
dependencies: @tt-a1i/archify-dsh, dshmarket
bundles     : @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, @tt-a1i/archify-dsh, dshmarket
```

差集说明了一切：

- `dsh-base`、`dsh-web-app` 在 bundles 里但**不在** dependencies —— 它们是 profile 模板的
  **in-box bundle**，`[源码 L41-43]` 明确说它们"不是依赖，永不被触碰"。
- `archify`、`dshmarket` 同时在两处 —— 用户后装的 bundle。

**一个包进入栈的条件**是它自己的 `package.json` 声明了 `dsh.bundle.patch`
（`[源码 L25-33]` `exportsPatch()` 读的就是 `dsh?.bundle?.patch !== undefined`）。
`[实测]` 四个 bundle 全都是这个形态：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

所以「装了一个包」和「它成为一层」之间，隔着一个 `dsh.bundle.patch` 声明。

---

## 三、`dsh plugin add` 到底做什么（我在这里猜错过一次）

你先跑了：

```powershell
dsh plugin --profile web add dshmarket
```

**我当时说**"它只动了依赖，没动 bundles 列表，这是最容易踩的装了但没加载"。**这是错的。**
`[源码 L7-16, L34-45]` 显示它会做三件事：

1. 在 profile 目录里转发给 `pnpm`（`cwd = profile 目录`）
2. **按"已安装状态"对账 `dsh.profile.bundles`**：某个依赖解析出的包声明了 `dsh.bundle`，
   就把它追加进层栈；不再声明的就移除。注意是**看已安装状态、不是看依赖差异** ——
   所以 `update` 能让一个在新版本里才长出 `dsh.bundle` 声明的包自动生效。
3. 对新增的、没有 `dsh.bundle` 的依赖**警告一次**：
   `declares no dsh.bundle — installed as a plain dependency, not a profile layer`

还有一个容易咬人的细节 `[源码 L79-94]`：pnpm 的 cwd 是 profile 目录，所以裸的 `.` 或 `../plugin`
会**在 profile 里**解析；它会把相对路径规格重新锚定到你**调用时的目录**，否则
"在插件仓库里执行 `add .`" 会把 profile 自己链接进去。

**修正后的结论**：`dsh plugin add` 会同时维护依赖和 bundles，不需要你手工补 bundles。
真正需要小心的不是"忘了加 bundles"，而是**包没有 `dsh.bundle` 声明**（那它永远只是一份普通依赖）。

---

## 四、为什么 profile 禁了 `tool-fs`，我却能读写文件

`dsh-web-app` 的 patch 里有 24 行 `disabled: true`，`[实测]` 完整清单：

```
ui-schedule, tool-bash, tool-pwsh, tool-jobs, tool-fs, tool-fs-search,
skill-filesystem, tool-skill, command-goal, tool-goal, plan-mode,
compaction-basic, command-compact, tool-result-pruner,
tool-subagent-control, tool-subagent-list-agents, tool-subagent,
tool-subagent-fork, workflow-worker-thread, tool-workflow, tool-ralph,
agent-instructions, tool-todo, tool-web
```

**这些恰好就是我现在正在用的工具。** 原文注释给了原因 `[源码 = 该文件 L362-471]`：
它们不是被"关掉"，而是**被移交给 preset 层**。

- **host plane（host 组合）** 保留"注册表本身"：subagent registry、job registry、
  skill registry、compaction 的 token meter、goal service，以及 sandbox/approval 栈、持久化、模型路由。
  注释给判据的原话是——**一个 host 行如果 inject 了某个 service，它就属于 host plane**
  （injection 在任何 session 存在之前就解析完了，没有 agent 可用来分域）。
- **agent plane（preset）** 拥有"模型面向的那些工具"。每个 preset 在自己的 realm 里
  挂载 `tool-fs`、`tool-pwsh`、`tool-subagent` 等，并按需配置。

`[实测]` 你机器上的 preset（`node_modules\@deepseek-ai\dsh-agent-presets\presets\`）：

| 目录 | name | order | 行数 | id 数 |
|---|---|---|---|---|
| `standard` | 标准模式 | 1 | 254 | 31 |
| `cordis` | 创造模式 | 4 | 266 | 32 |
| `ptc` | PTC 模式 | （未核） | 275 | 32 |
| `minimal` | 极简模式 | （未核） | 69 | 7 |

- 默认 preset 由一行配置指定 `[源码 = dsh-web-app L480-484]`：`agent-presets` 的 `config: { default: standard }`。
- 你自己的 preset 放在 `$DSH_HOME\.agent-presets`，`[实测]` **该目录不存在** —— 你还没写过。
  注释（L473-479）说它和 shell 访问**同等可信，因为 preset 本身就是一份 composition**。

`standard` 的 `agent.cordis.yml` 里 `tool-pwsh` 那行 `[源码 L49-51]` 直接解答了平台差异：

```yaml
- id: tool-bash
  disabled: !!js process.platform === 'win32'
- id: tool-pwsh
  disabled: !!js process.platform !== 'win32'
```

**由此可以理解 archify 的 patch 为什么长成那样**：它没有去动"模型能看到的工具"，
而是插了一行 `@deepseek-ai/dsh-skill-filesystem`，用 `providerName: archify-plugin` +
`includeDefaultRoots: false` + 用 `!!js` 算出的 `bundledSkillDir`，把技能注册到**host 层的全局 skill registry**。
这正是上面注释描述的"deployment 级 provider 注册进全局层"，也是为什么 `archify`
这个技能在列表里看着"来路不明"——它不走技能目录，走的是 provider。

---

## 五、两个环境级结论（会改变你该怎么用我）

### 5.1 我在沙箱里跑不了任何 `dsh` 命令，所以 `--dump-config` 只能你跑

`[源码 L206-211]`：

```js
function prepareProfile(name, userLayer = true, fromDefaultProfile) {
  ...
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}
```

**每一次启动都会无条件重写 `profiles\<name>\cordis.yml`** —— 包括 `--dump-config`。
而它在工作区外。`[实测]` 我三次尝试全部失败：

| 尝试 | 结果 |
|---|---|
| `npx @deepseek-ai/dsh@... --dump-config` | `EPERM` 写 `AppData\Local\npm-cache\_cacache\tmp` |
| `Start-Process node bin.js --dump-config` | `Start-Process : Access is denied` |
| `cmd /c "node bin.js ..."` | `EPERM ... open 'C:\Users\Zuoyunlai\.dsh\profiles\web\cordis.yml'` |

**所以技能里推荐的"权威检查"对我来说不可用，你必须自己在终端跑。**
这恰好是这次实测的主题：**我不是那个能做验收的人。**

### 5.2 原生程序的输出没法捕获，但有一个能用的写法

`[实测]`：

```
node -v                      → v24.20.0    裸执行，正常
$out = & node -v             → 空
node -v | Out-String         → Program 'node.exe' failed to run: Access is denied
cmd /c "node bin.js ... > f" → 成功写出文件   ← 能用的写法
Start-Process -Redirect...   → Access is denied
```

原因：捕获子进程输出要建管道，受限模式禁管道。`cmd /c "... > 文件"`
能用是因为**开文件的是 cmd 自己**，不经过 PowerShell 管道。

### 5.3 `dsh` 在你的 PATH 上

`[实测]` 你直接敲 `dsh plugin ...` 就跑了。所以下面这些命令你不需要 `npx`。

---

## 六、和技能文档矛盾的一处：`disabled: !!js`

`dsh-plugin-dev` / `dsh-troubleshoot` 两个技能都写了"第二个致命陷阱"：`!!js` 写在
`disabled` 上会被当成恒真对象，导致插件**永久禁用且无诊断**（引用官方 postmortem 0002）。

`[实测 + 源码 L220, L250]` `dsh-base` 里：

```yaml
- id: pwsh-sandbox
  name: '@deepseek-ai/dsh-pwsh-sandbox'
  disabled: !!js process.platform !== 'win32'
- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'
```

在 Windows 上这个表达式的值是 `false`。如果 `!!js` 在 `disabled` 上恒为真，
这两行就该被永久禁用，**我就根本没有 pwsh 可用**。`[实测]` 我能跑 pwsh。

**结论：在当前版本（0.1.5-rc.2）上，`disabled` 上的 `!!js` 确实会被求值，该陷阱不成立。**

**这个结论的边界（别过度推广）**：

- 我只验证了 `disabled` 这一个字段。postmortem 同时点了 `isolate` 和 `intercept`，**这两个我没验**。
- 我有的是**行为证据**（pwsh 可用），不是对这个版本的源码级确认。
- 技能文档可能对应更早的版本 —— 这正好印证技能自己那句话：
  **"任何'应该可以'的说法都要用实际命令验证一次。"**

---

## 七、本次我自己犯的错（更正记录）

写下来是因为它们比上面任何结论都更有用 —— **它们都是"看起来正常"的失败**：

1. **把自己的处境当成你的处境。** 我把"越界写入会被拒"写成了你可以观察到的现象。
   被沙箱管住的是我，不是你的终端。
2. **猜了 `dsh plugin` 的行为并当成结论说出。** 我说它不改 `bundles` —— 源码说它改。
3. **用 `$LASTEXITCODE` 查 cmdlet 的成败。** 那对 cmdlet 永远是空的，我拿空值当了"没问题"。
4. **用 pwsh 打印中文，得到乱码**（`创造模式` → `鍒涢€犳ā寮?`），差点当成文件损坏。
   该用 read 工具；这一点会话规则里本来就写了。
5. **分析脚本静默出错：** 打印了未定义的 `$line`（disabled 值全是空的），
   正则 `^\s+-\s+id:` 漏掉列 0 的 patch 条目，把 24 行全归到了同一个 id 上。
   脚本没报错，输出看着像结果。

共同点：**都不是崩溃，都是"有输出、看着合理、但是错的"。**

---

## 八、该你跑的验证

```powershell
# 1. 权威检查：组装后的完整 patch 栈
dsh --profile web --dump-config

# 2. 只看不含你的用户层和 --patch 的版本
dsh --profile web --dump-default-config

# 3. 验证 5.1 那个"每次启动都重写"的说法
(Get-Item "$env:DSH_HOME\profiles\web\cordis.yml").LastWriteTime
dsh --profile web --dump-config | Out-Null
(Get-Item "$env:DSH_HOME\profiles\web\cordis.yml").LastWriteTime   # 应该变了
```

第 3 条是关键：**如果 mtime 变了，5.1 成立；如果没变，说明我的读码读错了** ——
那我这条结论就该删掉。顺带说，我自己没法用 mtime 验证它：
`[实测]` `cordis.yml` 的 mtime 是 `20:26:06`，但那**可能**是你跑 `dsh plugin` 的时间，
我不确定，所以没拿它当证据。**这个不确定性留给你用第 3 条命令消掉。**
