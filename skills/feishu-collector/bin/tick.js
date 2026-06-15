#!/usr/bin/env node
// 心跳入口②：定时催办/收工检查。无状态——全部从 Base 读。
// 由各运行时调度器周期触发（OpenClaw cron / CC schedule / Hermes 外接 cron）。
// 用法: node bin/tick.js [--dry-run]
// 需环境: COLLECTOR_APP_TOKEN / COLLECTOR_TASKS_TABLE / COLLECTOR_SLOTS_TABLE
import { selectSlotsToNudge } from '../src/schedule.js';
import { querySlotsByStatus, updateSlotState } from '../src/base-io.js';
import { sendDM, sendGroup, buzz, pickMessageId } from '../src/messaging.js';
import { larkJson } from '../src/larkcli.js';

const DRY = process.argv.includes('--dry-run');
const profile = process.env.LARK_PROFILE;
const ctx = {
  appToken: process.env.COLLECTOR_APP_TOKEN,
  tasksTableId: process.env.COLLECTOR_TASKS_TABLE || '任务表',
  slotsTableId: process.env.COLLECTOR_SLOTS_TABLE || '槽位表',
  profile,
};

function nowDate() { return new Date(process.env.COLLECTOR_NOW || Date.now()); }

async function listCollectingTasks() {
  if (!ctx.appToken) { console.log('未配置 COLLECTOR_APP_TOKEN（dry 扫描跳过）'); return []; }
  const filter = { logic: 'and', conditions: [{ field: '状态', operator: 'is', value: ['收集中'] }] };
  const res = await larkJson(['base', '+record-search', '--base-token', ctx.appToken,
    '--table-id', ctx.tasksTableId, '--filter-json', JSON.stringify(filter), '--as', 'user'], { profile });
  return (res.records || res.items || []).map((r) => ({ task_id: r.record_id || r.id, ...(r.fields || r) }));
}

async function main() {
  const now = nowDate();
  const tasks = await listCollectingTasks();
  let nudged = 0;
  for (const task of tasks) {
    const openSlots = [];
    for (const st of ['待问', '已问', '清洗中', '待确认', '待澄清']) {
      openSlots.push(...await querySlotsByStatus(ctx, task.task_id, st));
    }
    const due = selectSlotsToNudge(openSlots, {
      deadline: task.截止时间, reminderIntervalH: Number(task.reminderIntervalH) || 24,
      maxAttempts: Number(task.maxAttempts) || 3,
    }, now);
    for (const slot of due) {
      nudged++;
      const msg = `提醒：还差你的「${slot.字段名}」没填，麻烦补一下～`;
      if (DRY) continue;
      const r = slot.责任人open_id ? await sendDM(slot.责任人open_id, msg, { profile })
                                  : await sendGroup(task.发起群chat_id, msg, { profile });
      if (slot.urgent && slot.责任人open_id) {
        const mid = pickMessageId(r);
        if (mid) await buzz(mid, [slot.责任人open_id], { profile });
      }
      await updateSlotState(ctx, slot.slot_id, {
        追问次数: (Number(slot.追问次数) || 0) + 1, 最近询问时间: now.toISOString(),
      });
    }
  }
  console.log(`扫描到 ${tasks.length} 个收集中任务，本轮需催办 ${nudged} 个槽位${DRY ? '（dry-run 未发送）' : ''}`);
}

main().catch((e) => { console.error('tick 失败：', e.message); process.exit(1); });
