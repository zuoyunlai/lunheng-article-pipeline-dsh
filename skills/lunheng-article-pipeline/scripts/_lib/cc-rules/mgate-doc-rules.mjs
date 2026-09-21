// ⑳ M-Gate-Algorithm.md 自洽（节头项数 / 跳号 / 文档↔脚本 gate 标签）
// v18.3.1（审计 B2 阶段 3）：从 consistency-check.mjs 按规则族抽离，行为逐字等价（回归测试的
//   注入验证用例 + 真源仓库自跑兜底）。共享态（errors / 派生源 / 版本真源等）由主脚本构建 ctx 传入。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

// ⑳ M-Gate-Algorithm.md 自洽（v2.5.2-dsh.17 新增）
export function runMgateDocRules(ctx) {
  const { ROOT, REPO_ROOT, files, active, skillText, gateSrc, GATE_DERIVED, gateModMissing, checkGateCounts, SEMVER, normVer, pkgVer, inlineTagTargets, isArchive, UPSTREAM_SPEC_VERSIONS, walk, errors } = ctx;
//    教训：M-Form-10 / M-Exist-4 加进文档后，两个节头括注仍写「9 项」「3 项」——⑥b 当时只认
//    「（N 项）」紧邻写法，于是「（N 项，含 …）」被静默放过；文档自身就是 M 门口径真源，
//    它的自洽必须从**文档结构**派生（节头 ↔ 节内 ### 子节 ↔ 脚本 gate 标签），不能再靠文本模式扫。
{
  const gateRel = 'references/_shared/M-Gate-Algorithm.md';
  const gatePath = join(ROOT, gateRel);
  if (!existsSync(gatePath)) {
    errors.push(`[P1 M 门文档缺失] ${gateRel} 不存在——M 门定义真源丢失`);
  } else {
    const lines = readFileSync(gatePath, 'utf8').split('\n');
    const secs = new Map();   // kind → { headerLine, header, declared, subs: [{ id, line, n }] }
    let cur = null;
    lines.forEach((l, i) => {
      const h = l.match(/^## M-(Form|Exist|Integrity)\b/);
      if (h) {
        cur = h[1];   // 短名 Form/Exist/Integrity（节头写作「## M-Form 形式合规门」）
        secs.set(cur, { headerLine: i + 1, header: l, declared: null, subs: [] });
        const d = l.match(/（(\d+)\s*项(?:[，、；][^）]*)?）/);
        if (d) secs.get(cur).declared = Number(d[1]);
        return;
      }
      const s = l.match(/^### (M-(?:Form|Exist|Integrity)-\d+):/);
      if (s && cur && s[1].startsWith(`M-${cur}-`)) {
        secs.get(cur).subs.push({ id: s[1], line: i + 1, n: Number(s[1].split('-')[2]) });
      }
    });
    for (const kind of ['Form', 'Exist', 'Integrity']) {
      const sec = secs.get(kind);
      if (!sec) {
        errors.push(`[P1 M 门文档缺节] ${gateRel} 缺少「## M-${kind}」节`);
        continue;
      }
      const count = sec.subs.length;
      if (sec.declared === null) {
        errors.push(`[P1 M 门节头缺项数] ${gateRel}:${sec.headerLine} 「M-${kind}」节头未写「（N 项）」——项数口径无从派生`);
      } else if (sec.declared !== count) {
        errors.push(`[P1 M 门文档自洽] ${gateRel}:${sec.headerLine} 节头写 ${sec.declared} 项，节内 ### 子节实为 ${count} 项（${sec.subs.map((x) => x.id).join(' / ')}）`);
      }
      const nums = sec.subs.map((x) => x.n);
      const expect = nums.map((_, i) => i + 1);
      if (nums.length && JSON.stringify(nums) !== JSON.stringify(expect)) {
        errors.push(`[P1 M 门编号跳号] ${gateRel} 「M-${kind}」子节编号 ${nums.join(',')} 非 1..${count} 连续（应为 ${expect.join(',')}）`);
      }
      const scriptN = { Form: GATE_DERIVED.form, Exist: GATE_DERIVED.exist, Integrity: GATE_DERIVED.integ + 1 }[kind];
      if (count !== scriptN) {
        errors.push(`[P1 M 门文档↔脚本不一致] ${gateRel} 「M-${kind}」定义 ${count} 项，脚本侧实为 ${scriptN} 项（M-Integrity 含主控人工门 M-Integrity-2，故 = 脚本标签数 + 1）——加项/删项必须两边同步`);
      }
    }
  }
}

}
