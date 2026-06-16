// 原生 Task I/O：task 域。命令面经实测校准 (lark-cli 1.0.53)：
//   task +create --summary <标题> [--description <来源回链>] [--assignee ou_xxx] [--due <ISO|date:YYYY-MM-DD|relative:+2d>]
//       [--tasklist-id <清单>] [--idempotency-key <key>] --as user --format json   建原生 Task。
//   task +update --task-id <id> [--summary|--description|--due ..] --as user --format json   改任务属性。
//   task +reminder --task-id <id> --set <15m|1h|1d> --as user --format json   设提醒（相对触发分钟）。
//   task +get-my-tasks [--complete true|false] [--query <kw>] [--page-all] --as user --format json   取我的任务（镜像源）。
//   task +search --assignee ou,.. | --creator ou,.. | --query <kw> [--completed] --as user --format json   搜任务。
// ⚠️ 响应路径待真机校准：task 创建返回的 task_guid 字段路径以实测为准（task.guid / data.task.guid）。
import { larkJson } from './larkcli.js';

function pickTaskId(res) {
  const t = res?.task || res?.data?.task || res;
  return t?.guid || t?.task_id || t?.id || res?.guid || res?.task_id;
}
function pickTasks(res) {
  return res?.items || res?.tasks || res?.data?.items || res?.data?.tasks || [];
}

/**
 * 建原生 Task（行动项）。来源会议/消息回链写进 description。
 * @param fields { summary, description?, assigneeOpenId?, due?, tasklistId?, idempotencyKey? }
 * @returns task_guid
 */
export async function createTask(fields, { profile } = {}) {
  const argv = ['task', '+create', '--summary', fields.summary, '--as', 'user', '--format', 'json'];
  if (fields.description) argv.push('--description', fields.description);
  if (fields.assigneeOpenId) argv.push('--assignee', fields.assigneeOpenId);
  if (fields.due) argv.push('--due', fields.due);
  if (fields.tasklistId) argv.push('--tasklist-id', fields.tasklistId);
  if (fields.idempotencyKey) argv.push('--idempotency-key', fields.idempotencyKey);
  const res = await larkJson(argv, { profile });
  return pickTaskId(res);
}

/** 改任务属性（截止/标题/描述）。patch = { summary?, description?, due? } */
export async function updateTask(taskId, patch, { profile } = {}) {
  const argv = ['task', '+update', '--task-id', taskId, '--as', 'user', '--format', 'json'];
  if (patch.summary) argv.push('--summary', patch.summary);
  if (patch.description) argv.push('--description', patch.description);
  if (patch.due) argv.push('--due', patch.due);
  return larkJson(argv, { profile });
}

/** 给任务设相对提醒（如临近截止前 1h） */
export async function setReminder(taskId, fire, { profile } = {}) {
  return larkJson(['task', '+reminder', '--task-id', taskId, '--set', fire,
    '--as', 'user', '--format', 'json'], { profile });
}

/** 取「我的任务」用于文档侧只读镜像（公司待办看板 / 项目待办汇总）。 */
export async function listMyTasks({ complete, query } = {}, { profile } = {}) {
  const argv = ['task', '+get-my-tasks', '--page-all', '--as', 'user', '--format', 'json'];
  if (complete === true) argv.push('--complete', 'true');
  if (complete === false) argv.push('--complete', 'false');
  if (query) argv.push('--query', query);
  const res = await larkJson(argv, { profile });
  return pickTasks(res);
}

/** 按负责人/创建者/关键词搜任务（镜像与查重用）。 */
export async function searchTasks({ assignee, creator, query, completed } = {}, { profile } = {}) {
  const argv = ['task', '+search', '--page-all', '--as', 'user', '--format', 'json'];
  if (assignee?.length) argv.push('--assignee', assignee.join(','));
  if (creator?.length) argv.push('--creator', creator.join(','));
  if (query) argv.push('--query', query);
  if (completed === true) argv.push('--completed');
  const res = await larkJson(argv, { profile });
  return pickTasks(res);
}
