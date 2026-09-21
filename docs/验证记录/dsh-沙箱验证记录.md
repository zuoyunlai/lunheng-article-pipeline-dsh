# DSH 权限边界验证记录

这份文件是第一次使用 DSH 时的一次实测记录。它不是教程，是一份**可被你独立复核的证据**：
下面每条结论都附了得出它的命令，你可以自己再跑一遍，看结果是否一致。

- 生成时间：2026-09-19 20:22:23（+08:00）
- 工作区：`E:\HERNESS`
- 沙箱模式：`workspace-write`
- Harness：`@deepseek-ai/dsh@0.1.5-rc.2`

---

## 一、环境事实（已用命令核对）

| 项 | 值 | 得出方式 |
|---|---|---|
| Node | `v24.20.0` | 裸执行 `node -v` |
| Node 路径 | `D:\Program Files\nodejs\node.exe` | `Get-Command node` |
| DSH 版本 | `0.1.5-rc.2` | 读 npx 缓存里的 `package.json` |
| 用户级技能 | 22 个 | `~\.dsh\skills` 目录数 |
| 项目级技能 | 1 个 | `E:\HERNESS\.dsh\skills` 目录数 |
| 工作区内文件 | 12517 个（递归） | `Get-ChildItem -Recurse` |

> 注意：`node -v` 这一条**只有裸执行才拿得到值**，原因见第四节。

---

## 二、权限边界：写工作区外会被拒

实测两笔写入：

```
工作区内  E:\HERNESS\.tmp-probe-a.txt   -> 成功
工作区外  E:\dsh-probe-b.txt            -> 被拒绝 UnauthorizedAccessException
```

复核方式：

```powershell
try { Set-Content 'E:\HERNESS\.probe-in.txt' 'x' -ErrorAction Stop; '工作区内: 成功' }
catch { '工作区内: 失败' }
try { Set-Content 'E:\probe-out.txt' 'x' -ErrorAction Stop; '工作区外: 成功' }
catch { "工作区外: 被拒绝 -> $($_.Exception.GetType().Name)" }
Test-Path 'E:\probe-out.txt'   # 应为 False：拒绝不是"提示"，是真的没写
```

**结论**：`workspace-write` 对工作区外是硬拒绝，不是弹窗确认。越界请求会被直接挡掉，
所以"agent 会不会偷偷改我的系统文件"这个担心在这一模式下不成立。

---

## 三、比边界更值得记住的：三层"假成功"

这次实测里出现过一次**命令自称成功、实际被拒**的完整链条。这是最有价值的部分。

起因是这一行：

```powershell
Set-Content -Path 'E:\dsh-sandbox-probe.txt' -Value '...' -Encoding utf8
Write-Host "写成功了 —— 说明边界没生效"
```

实际发生的事，逐层拆开：

1. **`Set-Content` 抛的是"非终止错误"**。默认情况下 PowerShell 报完错就继续往下执行，
   所以下一行的 `Write-Host` 照常跑了。
2. **那一行 `Write-Host` 是我写的**，它打印"写成功了"，而它根本没有检查任何东西。
   它只是在陈述一个我以为的事实。**脚本的自我陈述不是证据。**
3. **整个命令的退出码仍然是 0**，harness 因此没有标出 `[exit code: N]`。
   只看退出码的人会以为一切正常。

三层都指向"成功"，而真相是文件压根不存在：

```powershell
Test-Path 'E:\dsh-sandbox-probe.txt'   # False
```

### 我在这里犯的第二个错

我随后去查退出码，用了 `$LASTEXITCODE`。**这是错的**：
`$LASTEXITCODE` 只对原生可执行文件（.exe）有值，对 `Set-Content` 这类 PowerShell cmdlet 永远是空的。
我拿一个空值当"没问题"读，等于又犯了一次同样的错。

cmdlet 的正确判断依据是 `$?` 或者显式 `-ErrorAction Stop`：

```powershell
Set-Content 'E:\probe.txt' 'x' -ErrorAction SilentlyContinue
$?          # False —— 这才是判断依据
```

或者干脆让它抛出来，这样失败就无法被忽略：

```powershell
Set-Content 'E:\probe.txt' 'x' -ErrorAction Stop
```

### 提炼成规则

- **不要用"脚本打印了什么"判断成功**，用文件是否存在、内容是否正确判断。
- **不要只看退出码**。退出码 0 和"事情做成了"是两回事。
- **不做静默失败的检查**：`-ErrorAction SilentlyContinue` 加上不读 `$?`，等于把失败藏起来。

---

## 四、这个沙箱的一个真实怪癖：子进程输出拿不到

实测发现：在这个受限会话里，**PowerShell 无法捕获任何子进程的输出**，
但裸执行同一个程序是正常的。

```
node -v                     -> v24.20.0     （裸执行，输出直接到控制台，成功）
$out = & node -v            -> 空            （赋值捕获）
$(node -v)                  -> 空            （子表达式捕获）
node -v | Out-String        -> 报错           Program 'node.exe' failed to run: Access is denied
$a = cmd /c "echo hi"       -> 空            （不是 node 特有的，任何子进程都一样）
node -v > file 2>&1         -> 空            （PowerShell 的 > 本质是管道）
Get-Content x | ConvertFrom-Json  -> 正常     （cmdlet 之间的管道不受影响）
```

最直白的一条证据，直接报出了拒绝原因：

```
Program 'node.exe' failed to run: Access is denied
    + FullyQualifiedErrorId : NativeCommandFailed
```

**已确认的行为**：捕获子进程输出需要创建管道，而受限模式禁止管道，
于是子进程根本无法以"被捕获"的方式启动；cmdlet 之间的管道不受影响。

> 机制说明属于推断（管道被禁），但**上面的现象是实测的**，且 `Access is denied` 是解释的来源。
> 影响：不要在这个会话里让脚本"把某个 exe 的输出存进变量"。
> 需要输出就裸执行，或者让程序自己写文件，再用 `Get-Content`（cmdlet）读。

---

## 五、请你亲自核对

这是这次实测的目的：**别信我的结论，自己验一遍。**

1. 用编辑器打开这个文件，确认它确实存在、内容和你看到的一致。
2. 在你自己的 PowerShell 里跑这两条，看和我上面写的是否一致：

```powershell
node -v
Get-ChildItem 'E:\HERNESS\.dsh\skills' -Directory | Measure-Object | Select-Object -ExpandProperty Count
```

预期分别是 `v24.20.0` 和 `1`。如果对不上，说明这份记录有错——**那就是发现了一个真问题**，
而不是"文档和实际有点出入，算了"。

3. **一个我给出预测的实验**（注意：这里我原先写的是"亲眼看到它被拒"，那是错的，见下方更正）：

```powershell
Set-Content 'E:\i-should-not-exist.txt' 'x' -ErrorAction Stop
Test-Path 'E:\i-should-not-exist.txt'
Remove-Item 'E:\i-should-not-exist.txt'   # 记得自己收尾
```

**我的预测：它会成功**，即 `Test-Path` 返回 `True`。

理由：沙箱约束的是 **DSH 派出去执行工具调用的那个进程**，也就是我。你的交互式
PowerShell 是另一个进程，不受它管。所以第二节里"`E:\dsh-probe-b.txt` 被拒绝"
是**我的**结果，不是**你的**能力——把它当成你能观察到的东西，是我把两者的身份搞混了。

**更正**：本节初稿写的是"亲眼看到它被拒"，这是想当然。如果你的实测结果是成功，
说明我这条更正对了；如果它真的被拒了，那说明限制比我认为的更宽（可能是 ACL 层面），
这本身就是值得记录的新发现。

> 结论：**权限边界的意义是"限制 agent"，不是"限制你"。**

---

## 六、这次实测暴露的、关于我自己的事实

值得单独记一笔，因为它决定了你该怎么用我：

- 我说"已完成"**不构成证据**。第三节那个 `Write-Host "写成功了"` 就是我自己写的。
- 我会用错工具（`$LASTEXITCODE` 查 cmdlet）。
- 我可能在**没有意识到**的情况下把空值当成正常值（第四节，我第一条命令里
  `node:` 后面是空的，我差点当成"node 没装"，其实是被沙箱挡了）。
- 我不只会在**小事**上想当然，还会把自己的处境当成你的处境
  （第五节初稿："亲眼看到它被拒"——我是被限制的那个，你不是）。

所以正确的用法是：**要我给出可复核的产物，而不是要我给出结论。**
上面每一条都附了命令，就是为了让你能推翻我。
