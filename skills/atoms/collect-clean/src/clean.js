// 清洗归一化器：把人的脏输入归一化/校验。不合格返回 followup 追问话术。纯函数。
const toHalfWidth = (s) => String(s ?? '')
  .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/　/g, ' ');

export function cleanIdCard(raw) {
  const v = toHalfWidth(raw).replace(/\s/g, '').toUpperCase();
  if (/^\d{17}[\dX]$/.test(v)) return { ok: true, value: v };
  return { ok: false, followup: '这个身份证号看起来不对（应为 18 位），能再发一次完整号码吗？' };
}

export function cleanSize(raw) {
  const v = toHalfWidth(raw).trim().toUpperCase();
  const allow = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
  if (allow.includes(v)) return { ok: true, value: v };
  return { ok: false, followup: `尺码请从 ${allow.join('/')} 里选一个，你要哪个？` };
}

export function cleanEmail(raw) {
  const v = toHalfWidth(raw).trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: true, value: v };
  return { ok: false, followup: '邮箱格式好像不对，能再发一次吗？' };
}

export function cleanDate(raw) {
  const v = toHalfWidth(raw).trim();
  const m = v.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return { ok: false, followup: '日期没看懂，麻烦按 年-月-日 发我一下？' };
  const [, y, mo, d] = m;
  const yy = Number(y), mm = Number(mo), dd = Number(d);
  // 真实性校验：用 Date 回读，拒绝 13 月 / 2 月 30 日 等不存在的日期（#cleanDate）。
  const dt = new Date(yy, mm - 1, dd);
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) {
    return { ok: false, followup: `日期 ${yy}-${mo}-${d} 不存在，能再确认一下正确日期吗？` };
  }
  return { ok: true, value: `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` };
}
