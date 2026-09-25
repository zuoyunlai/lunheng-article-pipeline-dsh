// _lib/target-chars.mjs —— 目标字数解析（v18.12.3 新增：全量审计 L-56 同族发现的**静默跳过**缺陷）
//
// 为什么单独抽出来：`apply-revision-cycle.mjs` 与 `apply-compression-cycle.mjs` 各自内联了一份
//   `/(?:目标篇幅|篇幅)[^\n]*?(\d{4,5})/`。实测（2026-09-25）该正则在**四类完全合法的写法**上都返回 null：
//     · `目标篇幅：300 字`      —— 3 位数（3000 字档的轻量文章，SKILL.md 明确支持 ≥2000 字）
//     · `篇幅：800 字`          —— 同上
//     · `目标篇幅：12,000 字`   —— 千分位（人写大数的常见形态）
//     · `目标篇幅：1.2 万 字`   —— 中文数量级单位
//   而 `target === null` 的后果是 **`g5 = null` → G5 阻塞线整段判定被跳过**，脚本**不报错、exit 0**，
//   `recommendation` 变成「（未解析到目标字数，跳过 G5 判定）」。即：**闸门在最需要它的短稿档位上静默失效**，
//   而主控看到 exit 0 会认为「G5 已核」。故本模块的职责不只是「解析得更全」，还有**「解析不到必须说出来」**。
//
// 口径：
//   · 数值边界 `MIN_TARGET`–`MAX_TARGET`：低于该值不像「长文目标」，高于该值不像本包场景 →
//     一律视为**解析可疑**（返回 `value: null` + `suspect` 说明），由调用方提示人工确认，
//     而不是当成有效目标去判 G5（错误的目标会产出错误的 P0）。
//   · 允许的分隔与单位：半/全角冒号、千分位逗号、`万` / `千` / `k` / `K`。

export const MIN_TARGET = 300;
export const MAX_TARGET = 200000;

/** 匹配「目标篇幅 / 篇幅」行，并把数字（含千分位与数量级单位）抽出。 */
const LINE_RE = /(?:目标篇幅|篇幅)\s*[:：]\s*([^\n]{0,24})/;

/**
 * 解析任务简报里的目标字数。
 * @param {string} briefText 01-任务简报.md 的全文
 * @returns {{ value: number|null, raw: string|null, reason: string }}
 *   `value` 为 null 时**必须由调用方提示**（reason 说明为什么：没找到 / 数字不像目标值）。
 */
export function parseTargetChars(briefText) {
  const text = String(briefText || '');
  const m = text.match(LINE_RE);
  if (!m) return { value: null, raw: null, reason: '未找到「目标篇幅：」或「篇幅：」行' };

  const raw = m[1].trim();
  // 先判「万 / 千 / k」数量级，再剥千分位逗号（顺序不能反：`1.2 万` 里没有逗号，但 `12,000` 有）
  //   ⚠️ 不用 `\b?`：`\b` 是零宽断言，加量词是语法错误（本模块初版即踩，加载期直接 SyntaxError）
  const wan = raw.match(/(\d+(?:\.\d+)?)\s*(?:万|[wW])/)
  const qian = raw.match(/(\d+(?:\.\d+)?)\s*(?:千|[kK])/)
  const plain = raw.replace(/,/g, '').match(/\d+(?:\.\d+)?/)

  let value = null;
  if (wan) value = Math.round(Number(wan[1]) * 10000);
  else if (qian) value = Math.round(Number(qian[1]) * 1000);
  else if (plain) value = Math.round(Number(plain[0]));

  if (value === null || !Number.isFinite(value)) return { value: null, raw, reason: `「${raw}」里没有可识别的数字` };
  if (value < MIN_TARGET) return { value: null, raw, reason: `解析得 ${value}，低于下限 ${MIN_TARGET}——不像「长文目标」（是写错单位，还是把页码/条数写进了这行？）` };
  if (value > MAX_TARGET) return { value: null, raw, reason: `解析得 ${value}，高于上限 ${MAX_TARGET}——不像本包场景的目标字数` };
  return { value, raw, reason: '' };
}
