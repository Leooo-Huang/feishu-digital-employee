#!/usr/bin/env node
// 一次性建表：在飞书多维表格里创建「任务表」+「槽位表」（字段见设计 §2）。
// 有副作用（在飞书云端建 Base）→ 由用户在场时运行。
// ⚠️ 首次运行前确认 `base +base-create`/`+field-create` 的精确旗标与字段 type 码
//   （Base 字段类型：1=文本 2=数字 3=单选 5=日期 7=复选 11=人员，以实测为准）。
import { larkJson } from '../src/larkcli.js';

const profile = process.env.LARK_PROFILE; // 例如 'qianhai'；省略=默认 Leo

const TASK_FIELDS = [
  ['标题', 1], ['状态', 3], ['场所', 3], ['发起群chat_id', 1], ['发起人', 1],
  ['源文件', 1], ['目标文件', 1], ['截止时间', 5], ['催办策略', 1],
  ['原始指令', 1], ['收集计划摘要', 1], ['maxAttempts', 2], ['reminderIntervalH', 2],
];
const SLOT_FIELDS = [
  ['task_id', 1], ['字段名', 1], ['对象', 1], ['责任人open_id', 1], ['责任人原文', 1],
  ['落点', 1], ['值', 1], ['状态', 3], ['内容指纹', 1],
  ['追问次数', 2], ['最近询问时间', 5], ['来源', 1],
];

async function createTable(appToken, name, fields) {
  // 注：如 lark base 无单独 table-create，可在 +base-create 时带首表，或用 base.tables 子命令。
  const t = await larkJson(['base', '+field-list', '--base-token', appToken, '--table-id', name, '--as', 'user', '--json'], { profile })
    .catch(() => null);
  if (t) { console.log(`表 ${name} 已存在，跳过建表`); return name; }
  throw new Error(`请用 lark-cli 在 base ${appToken} 下建表「${name}」并加字段：`
    + fields.map((f) => `${f[0]}(type ${f[1]})`).join(', '));
}

async function main() {
  console.log('在飞书创建 Base（任务表/槽位表）…');
  const base = await larkJson(['base', '+base-create', '--name', 'feishu-collector-状态库', '--as', 'user', '--json'], { profile });
  const appToken = base.app?.app_token || base.app_token || base.token;
  if (!appToken) throw new Error(`未拿到 app_token：${JSON.stringify(base)}`);
  console.log('appToken =', appToken);
  await createTable(appToken, '任务表', TASK_FIELDS);
  await createTable(appToken, '槽位表', SLOT_FIELDS);
  console.log('\n请把以下写入运行环境（on-message/tick 用）：');
  console.log(`COLLECTOR_APP_TOKEN=${appToken}`);
  console.log('COLLECTOR_TASKS_TABLE=任务表');
  console.log('COLLECTOR_SLOTS_TABLE=槽位表');
}

main().catch((e) => { console.error('建表失败：', e.message); process.exit(1); });
