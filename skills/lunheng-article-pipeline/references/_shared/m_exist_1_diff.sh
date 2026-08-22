#!/usr/bin/env bash
# M-Exist-1 双向 diff 脚本（v2.2.0 新增，教训 #64）
# 借鉴 vincentjiang06 paper-writer objective/verify gate 理念，论衡化实现
# 形式合规 ≠ 存在性合规——comm -23/-13 是 LLM 无法伪造的硬证据
#
# ⚠️ 角色：v2.2.0 M 门的「主控 host shell 实战 dry-run 工具」+「备份实现」
# 主路径：论衡主控 T7 用 LLM 兜底读 _shared/M-Gate-Algorithm.md + final/ 文件推理执行
# 本脚本用于：① 主控 host shell 实战验证 ② 论衡工作区独立 dry-run ③ 备份实现
#
# ⚠️ Phase 0 同意关卡（教训 #51 金标准）
# 本脚本调用 shell 命令 = 论衡 agent 主控直接调用 = 触发 exec 工具 = 当前 15 项白名单 deny
# 实战使用方式：
#   1. 主控 host shell 跑（本会话直接 bash）—— 实战 dry-run 推荐
#   2. 主人手动跑 —— 主控把项目名告诉主人，主人复制粘贴跑
#   3. 主控不调用此脚本 —— 改走 LLM 兜底路径（推荐，零 exec 依赖）
#
# 用法：
#   bash m_exist_1_diff.sh <项目名> [--auto-detect-cwd]
# 退出码：
#   0 = 全部对齐
#   1 = 有漏引或孤儿
#   2 = 缺少必要文件（定稿.md / 证据包/）
#
# 输入（路径会自动检测，详见 _detect_workspace 函数）：
#   run/<项目名>/final/定稿.md
#   run/<项目名>/final/证据包/数据卡.md
#   run/<项目名>/final/证据包/案例卡*.md（如存在）
#   run/<项目名>/final/证据包/文献卡.md
#   run/<项目名>/final/证据包/先行者清单.md（如存在）
# 输出：
#   stdout 报告（漏引 + 孤儿清单）
#   /tmp/lunheng-m-exist-1.log 持久化日志

set -euo pipefail

# ===== 路径自动检测（v2.2.0 路径加固，教训 #66）=====
_detect_workspace() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # 优先级 1: 当前 cwd 已经是 workspace 根（论衡工作区 /home/zuoyunlai/.openclaw/workspace-paperwriter）
    if [[ -d "run" ]]; then
        echo "."
        return 0
    fi
    
    # 优先级 2: 当前 cwd 在 pipeline/_shared/（脚本本身所在目录）
    if [[ -d "../../run" ]]; then
        echo "../.."
        return 0
    fi
    
    # 优先级 3: 脚本所在目录的祖父级存在 run/
    if [[ -d "${script_dir}/../../run" ]]; then
        echo "${script_dir}/../.."
        return 0
    fi
    
    # 优先级 4: ClawHub 副本场景（脚本在 references/_shared/）
    if [[ -d "${script_dir}/../../../run" ]]; then
        echo "${script_dir}/../../.."
        return 0
    fi
    
    # 找不到
    echo ""
    return 1
}

WORKSPACE_ROOT="$(_detect_workspace || true)"
if [[ -z "$WORKSPACE_ROOT" ]]; then
    echo "ERROR: 无法定位 workspace 根目录（找不到 run/ 目录）" >&2
    echo "请在论衡工作区根目录（/home/zuoyunlai/.openclaw/workspace-paperwriter）或 pipeline/_shared/ 目录下运行" >&2
    exit 2
fi

cd "${WORKSPACE_ROOT}"

PROJECT_NAME="${1:-}"
if [[ -z "$PROJECT_NAME" ]]; then
    echo "用法：bash $0 <项目名>" >&2
    echo "当前工作区根：$(pwd)" >&2
    exit 2
fi

PROJECT_DIR="run/${PROJECT_NAME}/final"
DRAFT="${PROJECT_DIR}/定稿.md"
EVIDENCE="${PROJECT_DIR}/证据包"

# Step 0: 文件存在性校验
if [[ ! -f "$DRAFT" ]]; then
    echo "[M-Exist-1] ❌ 缺少 final/定稿.md（路径：$(pwd)/${DRAFT}）" >&2
    exit 2
fi
if [[ ! -d "$EVIDENCE" ]]; then
    echo "[M-Exist-1] ❌ 缺少 final/证据包/ 目录（路径：$(pwd)/${EVIDENCE}）" >&2
    exit 2
fi

LOG="/tmp/lunheng-m-exist-1.log"
exec > >(tee "$LOG") 2>&1

echo "=== M-Exist-1 文末「引用来源」双向 diff 报告（v2.2.0 备份实现）==="
echo "工作区根：$(pwd)"
echo "项目：${PROJECT_NAME}"
echo "生成时间：$(date +%Y-%m-%d\ %H:%M:%S)"
echo "⚠️ 主路径是 LLM 兜底执行（见 _shared/M-Gate-Algorithm.md），本脚本为实战 dry-run 工具"
echo ""

# Step 1: 提取正文所有编号
grep -oE '\[D[0-9]+\]|\[C[0-9]+\]|\[C-主[0-9]+\]|\[L[0-9]+\]|\[先[0-9]+\]' "$DRAFT" | sort -u > /tmp/lunheng-intext.txt
echo "=== 正文引用编号（$(wc -l < /tmp/lunheng-intext.txt) 条）==="
cat /tmp/lunheng-intext.txt

# Step 2: 提取文末四节每节的编号（4 节完整性前置）
if ! grep -q '^## 数据来源\|^## 案例来源\|^## 参考文献\|^## 先行者文献' "$DRAFT"; then
    echo ""
    echo "[M-Form-2] ⚠️  文末四节不完整（数据来源/案例来源/参考文献/先行者文献）"
fi

# Step 3: 逐节提取
awk '/^## 数据来源/,/^## 案例来源/' "$DRAFT" 2>/dev/null | grep -oE '\[D[0-9]+\]' | sort -u > /tmp/lunheng-data.txt
awk '/^## 案例来源/,/^## 参考文献/' "$DRAFT" 2>/dev/null | grep -oE '\[C[0-9]+\]|\[C-主[0-9]+\]' | sort -u > /tmp/lunheng-case.txt
awk '/^## 参考文献/,/^## 先行者/' "$DRAFT" 2>/dev/null | grep -oE '\[L[0-9]+\]' | sort -u > /tmp/lunheng-ref.txt

# 「先行者文献」是最后一节，awk 需读到文件末尾
if grep -q '^## 先行者文献' "$DRAFT"; then
    awk '/^## 先行者文献/{flag=1;next} flag' "$DRAFT" | grep -oE '\[先[0-9]+\]' | sort -u > /tmp/lunheng-xian.txt
else
    : > /tmp/lunheng-xian.txt
fi

echo ""
echo "=== 文末四节编号分布 ==="
echo "数据来源：$(wc -l < /tmp/lunheng-data.txt) 条"
echo "案例来源：$(wc -l < /tmp/lunheng-case.txt) 条"
echo "参考文献：$(wc -l < /tmp/lunheng-ref.txt) 条"
echo "先行者文献：$(wc -l < /tmp/lunheng-xian.txt) 条"

# Step 4: 合并文末全集
cat /tmp/lunheng-data.txt /tmp/lunheng-case.txt /tmp/lunheng-ref.txt /tmp/lunheng-xian.txt | sort -u > /tmp/lunheng-all-refs.txt
echo ""
echo "=== 文末四节全集（$(wc -l < /tmp/lunheng-all-refs.txt) 条）==="

# Step 5: 双向 diff
echo ""
echo "=== 漏引（正文有但文末无）→ P1 必补 ==="
LEAKED=$(comm -23 /tmp/lunheng-intext.txt /tmp/lunheng-all-refs.txt || true)
if [[ -n "$LEAKED" ]]; then
    echo "$LEAKED"
    LEAK_COUNT=$(echo "$LEAKED" | wc -l)
else
    echo "（空）"
    LEAK_COUNT=0
fi

echo ""
echo "=== 孤儿（文末有但正文未引用）→ P1 必删 ==="
ORPHAN=$(comm -13 /tmp/lunheng-intext.txt /tmp/lunheng-all-refs.txt || true)
if [[ -n "$ORPHAN" ]]; then
    echo "$ORPHAN"
    ORPHAN_COUNT=$(echo "$ORPHAN" | wc -l)
else
    echo "（空）"
    ORPHAN_COUNT=0
fi

# Step 6: 主人洞察特例校验
echo ""
echo "=== 主人洞察 [C-主xx] 特例校验 ==="
ZHU_REFS=$(grep -E '\[C-主[0-9]+\]' /tmp/lunheng-intext.txt || true)
if [[ -n "$ZHU_REFS" ]]; then
    echo "正文引用 [C-主xx]：$(echo "$ZHU_REFS" | wc -l) 条"
    echo "⚠️  [C-主xx] 应在文末「案例来源」节留 1 条「主人深度洞察」说明 + 任务简报出处行号"
    ZHU_IN_CASE=$(grep -c 'C-主' /tmp/lunheng-case.txt || echo 0)
    echo "文末「案例来源」节含 C-主 数：$ZHU_IN_CASE"
else
    echo "（本次无 [C-主xx]）"
fi

# Step 7: 退出码判定
echo ""
echo "=== 退出码判定 ==="
if [[ $LEAK_COUNT -gt 0 || $ORPHAN_COUNT -gt 0 ]]; then
    echo "[M-Exist-1] ❌ 失败：漏引 $LEAK_COUNT 条 / 孤儿 $ORPHAN_COUNT 条"
    exit 1
else
    echo "[M-Exist-1] ✅ 通过"
    exit 0
fi
