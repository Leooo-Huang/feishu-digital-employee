// 任务/槽位状态机。纯函数：给定当前态+事件 → 下一态，非法组合抛错。
export const SLOT_STATES = ['待问','已问','收到原始','清洗中','待确认','已填','跳过','不适用','待澄清'];
export const TASK_STATES = ['草稿','待确认','收集中','暂停','已完成','已取消'];

// 槽位迁移表：当前态 -> { 事件: 下一态 }
const SLOT_TRANSITIONS = {
  '待问':    { ask_sent: '已问', deadline_passed: '跳过', mark_na: '不适用', need_clarify: '待澄清' },
  '已问':    { answer_received: '收到原始', deadline_passed: '跳过', mark_na: '不适用' },
  '收到原始': { start_clean: '清洗中' },
  '清洗中':  { clean_failed: '清洗中', clean_ok: '待确认', deadline_passed: '跳过' },
  '待确认':  { confirmed: '已填', rejected: '清洗中', deadline_passed: '跳过' },
  '待澄清':  { resolved: '待问', mark_na: '不适用' },
  '已填':    { reopen: '清洗中' },   // 改答
  '跳过':    { reopen: '待问' },     // 迟交补收
};

/** 给定当前态 + 事件，返回下一态；非法组合抛错 */
export function nextSlotState(current, event) {
  const row = SLOT_TRANSITIONS[current];
  if (!row || !(event in row)) {
    throw new Error(`非法槽位状态迁移: ${current} --${event}-->`);
  }
  return row[event];
}
