// 通用访谈模板（原子，纯函数）。冷启动无文档时，书童按这套**通用、不绑定单一公司**的题库逐项发问，
// 答案写进对应知识库节点。问/收/确认由 feishu-init 大脑同步进行；写回用 feishu-shared/doc.appendDoc。
// 目标节点均取自 kb-scaffold 的标准树（保持一致）。

export const GENERIC_INTERVIEW = [
  { key: 'overview', 主题: '公司简介', 目标节点: '组织架构与成员',
    question: '用一两句话介绍下公司是做什么的？主要业务线 / 产品有哪些？' },
  { key: 'members', 主题: '成员名册', 目标节点: '组织架构与成员',
    question: '团队主要成员有哪些？请按「姓名 - 角色」列一下（用于后续 @ 与人名识别）。' },
  { key: 'projects', 主题: '在推项目', 目标节点: '项目空间',
    question: '当前在推进哪些项目？各自负责人是谁？' },
  { key: 'okr', 主题: '战略目标 / OKR', 目标节点: 'OKR / 战略目标',
    question: '本季度或本年度的战略目标 / OKR 是什么？' },
  { key: 'sop', 主题: '制度 / SOP / FAQ', 目标节点: '制度 / SOP / FAQ',
    question: '有哪些新人必须知道的制度、流程（SOP）或常见问题（FAQ）？' },
];

/** 取下一道未答题；全部答完返回 null。 */
export function nextQuestion(answeredKeys = [], template = GENERIC_INTERVIEW) {
  const done = new Set(answeredKeys);
  return template.find((q) => !done.has(q.key)) || null;
}

/** 访谈进度。 */
export function interviewProgress(answeredKeys = [], template = GENERIC_INTERVIEW) {
  const done = new Set(answeredKeys);
  const answered = template.filter((q) => done.has(q.key)).length;
  return { answered, total: template.length, complete: answered >= template.length };
}

/**
 * 把一条答案格式化成 KB 写入内容。空答案返回 null（跳过，不写——缺失不编造）。
 * @returns {{nodeTitle, content}|null}
 */
export function formatAnswerForKb(item, answer, nowIso) {
  const v = String(answer ?? '').trim();
  if (!v) return null;
  const stamp = nowIso ? `（${nowIso}）` : '';
  return { nodeTitle: item.目标节点, content: `## ${item.主题}${stamp}\n\n${v}\n` };
}
