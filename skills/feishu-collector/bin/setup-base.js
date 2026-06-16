#!/usr/bin/env node
// 一次性建状态库：在飞书多维表格创建「任务表 + 槽位表」。
// 命令面经实测校准 (lark-cli 1.0.53)：
//   base +base-create --name <库名> --table-name 任务表 --fields '<JSON>'  → 建库 + 首表(任务表)
//   base +table-create --base-token <t> --name 槽位表 --fields '<JSON>'    → 建第二表(槽位表)
//   字段 type 用字符串名：text|select|number|datetime；首个 field 为主字段；select 带 options。
// 有副作用(在飞书云端建 Base) → 由用户在场、user 身份已授权
//   base:table:create base:field:create base:field:read base:field:update base:view:write_only 时运行。
// 已有库时设环境变量 COLLECTOR_APP_TOKEN 复用，仅补建缺失的表（幂等）。
import { larkJson } from '../src/larkcli.js';

const profile = process.env.LARK_PROFILE; // 例如 'qianhai'；省略=默认 Leo
const sel = (...names) => ({ type: 'select', options: names.map((name) => ({ name })) });

// 首字段=主字段（文本）。字段集见 ../../docs 设计 §4 数据持久化模型。
const TASK_FIELDS = [
  { name: '标题', type: 'text' },
  { name: '状态', ...sel('草稿', '待确认', '收集中', '暂停', '已完成', '已取消') },
  { name: '场所', ...sel('群', '私信', '混合') },
  { name: '发起群chat_id', type: 'text' },
  { name: '发起人', type: 'text' },
  { name: '源文件', type: 'text' },
  { name: '目标文件', type: 'text' },
  { name: '截止时间', type: 'datetime' },
  { name: '催办策略', type: 'text' },
  { name: '原始指令', type: 'text' },
  { name: '收集计划摘要', type: 'text' },
  { name: 'maxAttempts', type: 'number' },
  { name: 'reminderIntervalH', type: 'number' },
  { name: 'created_at', type: 'datetime' },
  { name: 'updated_at', type: 'datetime' },
  { name: 'completed_at', type: 'datetime' },
];
const SLOT_FIELDS = [
  { name: '字段名', type: 'text' },
  { name: 'task_id', type: 'text' },
  { name: '对象', type: 'text' },
  { name: '责任人open_id', type: 'text' },
  { name: '责任人原文', type: 'text' },
  { name: '落点', type: 'text' },
  { name: '值', type: 'text' },
  { name: '状态', ...sel('待问', '已问', '收到原始', '清洗中', '待确认', '已填', '跳过', '不适用', '待澄清') },
  { name: '内容指纹', type: 'text' },
  { name: '追问次数', type: 'number' },
  { name: '最近询问时间', type: 'datetime' },
  { name: '来源', type: 'text' },
];

function pickAppToken(res) {
  return res?.app?.app_token || res?.app_token || res?.data?.app?.app_token || res?.token;
}

async function listTableNames(appToken) {
  const res = await larkJson(['base', '+table-list', '--base-token', appToken, '--format', 'json', '--as', 'user'],
    { profile }).catch(() => null);
  const arr = res?.items || res?.tables || res?.data?.items || [];
  return arr.map((t) => t.name || t.table_name);
}

async function createTable(appToken, name, fields) {
  await larkJson(['base', '+table-create', '--base-token', appToken, '--name', name,
    '--fields', JSON.stringify(fields), '--format', 'json', '--as', 'user'], { profile });
  console.log(`建表「${name}」ok`);
}

async function main() {
  let appToken = process.env.COLLECTOR_APP_TOKEN;
  if (!appToken) {
    console.log('创建状态库 Base（含首表「任务表」）…');
    const res = await larkJson(['base', '+base-create', '--name', 'feishu-collector-状态库',
      '--table-name', '任务表', '--fields', JSON.stringify(TASK_FIELDS),
      '--time-zone', 'Asia/Shanghai', '--format', 'json', '--as', 'user'], { profile });
    appToken = pickAppToken(res);
    if (!appToken) throw new Error(`未拿到 app_token：${JSON.stringify(res)}`);
    console.log('appToken =', appToken);
  } else {
    console.log('复用 COLLECTOR_APP_TOKEN =', appToken);
    if (!(await listTableNames(appToken)).includes('任务表')) await createTable(appToken, '任务表', TASK_FIELDS);
  }

  if (!(await listTableNames(appToken)).includes('槽位表')) await createTable(appToken, '槽位表', SLOT_FIELDS);
  else console.log('表「槽位表」已存在，跳过');

  console.log('\n请把以下写入运行环境（on-message/tick 用）：');
  console.log(`COLLECTOR_APP_TOKEN=${appToken}`);
  console.log('COLLECTOR_TASKS_TABLE=任务表');
  console.log('COLLECTOR_SLOTS_TABLE=槽位表');
}

main().catch((e) => { console.error('建表失败：', e.message); process.exit(1); });
