#!/usr/bin/env node
// 心跳入口②：定时催办 + 收工汇报。无状态——全部从 Base 读。
// 由各运行时调度器周期触发（OpenClaw cron / CC schedule / Hermes 外接 cron）。
// 用法: node bin/tick.js [--dry-run]
// 需环境: COLLECTOR_APP_TOKEN / COLLECTOR_TASKS_TABLE / COLLECTOR_SLOTS_TABLE
import { selectSlotsToNudge } from '../../atoms/collect-nudge/src/schedule.js';
import { queryTasksByStatus, querySlotsByTask, updateSlotState, updateTaskState } from '../../atoms/collect-store/src/base-io.js';
import { planWrapup } from '../../atoms/collect-wrapup/src/wrapup.js';
import { sendGroup, sendGroupMention, buzz, pickMessageId } from '../../feishu-shared/src/message.js';

const DRY = process.argv.includes('--dry-run');
const profile = process.env.LARK_PROFILE;
const MAX_URGENT = Number(process.env.COLLECTOR_MAX_URGENT) || 3; // 每槽加急次数上限（防扰民）
const ctx = {
  appToken: process.env.COLLECTOR_APP_TOKEN,
  tasksTableId: process.env.COLLECTOR_TASKS_TABLE || '任务表',
  slotsTableId: process.env.COLLECTOR_SLOTS_TABLE || '槽位表',
  profile,
};

function nowDate() { return new Date(process.env.COLLECTOR_NOW || Date.now()); }

async function nudgeSlot(task, slot, now) {
  const chatId = task.发起群chat_id;
  if (!chatId) { console.error(`任务 ${task.task_id} 缺 发起群chat_id，跳过槽位 ${slot.slot_id}`); return false; }
  const attempt = (Number(slot.追问次数) || 0) + 1;
  // 催办统一在发起群里公开 @ 责任人；无责任人（开放式/全群认领）发群内普通提醒。
  const hasAssignee = !!slot.责任人open_id;
  const msg = hasAssignee
    ? `提醒：还差你的「${slot.字段名}」没填，麻烦补一下～`
    : `提醒：还差「${slot.字段名}」没填，有同学认领一下～`;
  if (DRY) return true;
  // 加急上限（防扰民）：仅在 urgent、有责任人且加急次数未达上限时升级加急。
  const urgeCount = Number(slot.加急次数) || 0;
  const willUrge = slot.urgent && hasAssignee && urgeCount < MAX_URGENT;
  // 幂等顺序（#9）：先记一次"已催"（追问次数+最近询问时间[+加急次数]），再发送。
  // 即便发送后崩溃，下轮也不会用同一 attempt 重复公开 @；宁可漏一次也不刷屏。
  const patch = { 追问次数: attempt, 最近询问时间: now.toISOString() };
  if (willUrge) patch.加急次数 = urgeCount + 1;
  await updateSlotState(ctx, slot.slot_id, patch);
  const idempotencyKey = `${slot.slot_id}#${attempt}`;
  const r = hasAssignee
    ? await sendGroupMention(chatId, msg, [slot.责任人open_id], { profile, idempotencyKey })
    : await sendGroup(chatId, msg, { profile, idempotencyKey });
  // 临近截止升级加急：作用于刚发出的群催办消息，@到责任人（bot 为发送者、责任人在群内）。
  if (willUrge) {
    const mid = pickMessageId(r);
    if (mid) await buzz(mid, [slot.责任人open_id], { profile });
  }
  return true;
}

async function wrapupTask(task, plan, now) {
  const chatId = task.发起群chat_id;
  if (!chatId) { console.error(`任务 ${task.task_id} 缺 发起群chat_id，无法发收工汇报`); return false; }
  if (DRY) return true;
  // 先群发完成汇报（任务级 idempotency-key，崩溃重放 1h 内不重复发），再置「已完成」（下轮不再扫描）。
  await sendGroup(chatId, plan.report, { profile, idempotencyKey: `wrapup#${task.task_id}` });
  await updateTaskState(ctx, task.task_id, { 状态: '已完成', completed_at: now.toISOString() });
  return true;
}

async function main() {
  const now = nowDate();
  if (!ctx.appToken) {
    console.log('未配置 COLLECTOR_APP_TOKEN（dry 扫描跳过）');
    console.log(`扫描到 0 个收集中任务，催办 0 个槽位、收工 0 个任务、失败 0 个${DRY ? '（dry-run 未发送）' : ''}`);
    return;
  }
  const tasks = await queryTasksByStatus(ctx, '收集中');
  let nudged = 0, wrapped = 0, failed = 0;
  for (const task of tasks) {
    // #8 逐任务隔离：单个任务出错不影响其他任务。
    try {
      const allSlots = await querySlotsByTask(ctx, task.task_id); // 一次取全槽（消 N+1）
      // 1) 催办：selectSlotsToNudge 内部按 NUDGE_STATES 过滤未终结且应催的槽位。
      const due = selectSlotsToNudge(allSlots, {
        deadline: task.截止时间, reminderIntervalH: Number(task.reminderIntervalH) || 24,
        maxAttempts: Number(task.maxAttempts) || 3,
      }, now);
      for (const slot of due) {
        try { if (await nudgeSlot(task, slot, now)) nudged++; }
        catch (e) { failed++; console.error(`催办槽位 ${slot.slot_id} 失败（跳过，不影响其他）：${e.message}`); }
      }
      // 2) 收工汇报：到期或全部终结 → 群发完成汇报（含未交名单）+ 置「已完成」（契约 #10）。
      const plan = planWrapup(task, allSlots, now);
      if (plan.shouldWrap) {
        try { if (await wrapupTask(task, plan, now)) wrapped++; }
        catch (e) { failed++; console.error(`任务 ${task.task_id} 收工失败（跳过）：${e.message}`); }
      }
    } catch (e) {
      failed++;
      console.error(`处理任务 ${task.task_id} 失败（跳过，不影响其他任务）：${e.message}`);
    }
  }
  console.log(`扫描到 ${tasks.length} 个收集中任务，催办 ${nudged} 个槽位、收工 ${wrapped} 个任务、失败 ${failed} 个${DRY ? '（dry-run 未发送）' : ''}`);
}

main().catch((e) => { console.error('tick 失败：', e.message); process.exit(1); });
