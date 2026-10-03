// ⑫ E 族「单源不变量」机检（v18.18.10）
//   审计 E 族统一处理法要「该事实只允许出现在真源一处，其余必须是指针」——但**对 17 组异质散文
//   事实不可判定**，硬做只能退化成字面禁令，而字面禁令在本仓**必然误报**（文档规范要求更正记录
//   写出旧值：`07卡` 写「无 M-Form-12」、期刊文档写「原写 25 个，真源实为 28」都属正当）。
//   故本规则只做两类**可判定**检查，均为正向存在性或可派生数值、没有绕过口：
//     ① **E-14 数值派生**：真源自称的规模 == 它自己的表行数（「按磁盘表行数导出规模」的题面本身）
//     ② **E-8 / E-14 锚点在场**：新名字（`MC-` 三标签）与新指针（「规模真源 = 期刊数据库.md」）
//        必须在场——单侧回退会让锚点消失
//   边界：E 族**语义半边**（取哪一侧是否正确）没有门，也不假装有；详见模块头注释。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  deriveJournalCounts,
  declaredJournalCounts,
  MC_LABEL_ANCHORS,
  JOURNAL_POINTER_ANCHORS,
} from '../e-family-invariants.mjs' // E 族：可派生的单源不变量（见模块头，为什么不做字面禁令）

export function run(ctx) {
  const { fail, note, ROOT } = ctx
  const S = (p) => join(ROOT, 'skills', 'lunheng-article-pipeline', p)
  // ① 期刊规模：自称 vs 表行数
  try {
    const db = readFileSync(S('references/_shared/期刊数据库.md'), 'utf8')
    const derived = deriveJournalCounts(db)
    const declared = declaredJournalCounts(db)
    for (const k of ['zh', 'en']) {
      const label = k === 'zh' ? '中文' : '英文'
      if (derived[k] === null || declared[k] === null) {
        fail('e-family', `期刊库${label}规模：真源里「表行数」或「章节标题自称」有一侧读不到（派生 ${derived[k]} / 自称 ${declared[k]}）——解析器与文档形状脱节`)
      } else if (derived[k] !== declared[k]) {
        fail('e-family', `期刊库${label}规模不自洽：章节标题自称 ${declared[k]}，而表实有 ${derived[k]} 行——加减期刊后忘了改标题（E-14 的原病就是这个）`)
      }
    }
    note(`⑫① 期刊库规模真源自洽：中文 ${derived.zh} 行 / 英文 ${derived.en} 行（与章节标题自称一致）`)
  } catch (e) {
    fail('e-family', `⑫① 期刊规模核对无法执行：${e.message}`)
  }
  // ② 锚点在场（E-8 新名字 / E-14 新指针）
  const anchors = [
    { file: MC_LABEL_ANCHORS.file, miss: MC_LABEL_ANCHORS.labels.filter((n) => !MC_LABEL_ANCHORS.definitionRe(n).test(readFileSync(S(MC_LABEL_ANCHORS.file), 'utf8'))), what: 'MC- 命名空间三标签的**定义项**（E-8）' },
    ...JOURNAL_POINTER_ANCHORS.map((a) => ({
      file: a.file,
      miss: a.must.test(readFileSync(S(a.file), 'utf8')) ? [] : ['「规模真源 = 期刊数据库.md」指针'],
      what: '期刊规模指针（E-14）',
    })),
  ]
  for (const a of anchors) {
    if (a.miss.length) {
      fail('e-family', `${a.file} 缺 ${a.what}：${a.miss.join('、')}——单侧回退（改回旧名 / 改回硬编码数字）会让锚点消失，故此处正向要求它在场`)
    }
  }
  note(`⑫② E 族锚点在场：MC- 三标签 + ${JOURNAL_POINTER_ANCHORS.length} 处期刊规模指针均在场`)
}
