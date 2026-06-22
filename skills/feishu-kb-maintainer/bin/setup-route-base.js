#!/usr/bin/env node
// 一次性建状态库：在飞书多维表格创建「路由幂等表」。真建表，禁止让用户手动建。
// 命令面经实测校准 (lark-cli 1.0.53)：
//   base +base-create --name <库名> --table-name 路由幂等表 --fields '<JSON>'
//       --time-zone Asia/Shanghai --format json --as user   → 建库 + 首表(路由幂等表)。
//   字段 type 用字符串名：text|select|number|datetime；首个 field 为主字段；select 带 options:[{name}]。
//   已有库时设环境变量 KB_APP_TOKEN 复用，仅补建缺失的表（幂等）。
// 有副作用(在飞书云端建 Base) → 由用户在场、user 身份已授权 base 建表/字段权限时运行。
import { larkJson } from '../../feishu-shared/src/larkcli.js';

const profile = process.env.LARK_PROFILE; // 例如 'qianhai'；省略=默认 Leo
const sel = (...names) => ({ type: 'select', options: names.map((name) => ({ name })) });

// 字段集见设计 §4.1 路由幂等表。首字段=主字段（source_type，select）。
const ROUTE_FIELDS = [
  { name: 'source_type', ...sel('meeting', 'chat', 'comment', 'manual') },
  { name: 'source_id', type: 'text' },
  { name: 'source_meta', type: 'text' },
  { name: 'target_kind', ...sel('doc', 'task', 'okr', 'comment') },
  { name: 'target_id', type: 'text' },
  { name: 'target_locator', type: 'text' },
  { name: 'content_hash', type: 'text' },
  { name: 'target_content_hash', type: 'text' }, // 覆盖保护(#11)：上次写入目标的内容指纹，用于检测人工改动
  { name: 'status', ...sel('written', 'updated', 'skipped', 'conflict') },
  { name: 'last_synced_at', type: 'datetime' },
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
  let appToken = process.env.KB_APP_TOKEN;
  if (!appToken) {
    console.log('创建状态库 Base（含首表「路由幂等表」）…');
    const res = await larkJson(['base', '+base-create', '--name', 'feishu-kb-maintainer-状态库',
      '--table-name', '路由幂等表', '--fields', JSON.stringify(ROUTE_FIELDS),
      '--time-zone', 'Asia/Shanghai', '--format', 'json', '--as', 'user'], { profile });
    appToken = pickAppToken(res);
    if (!appToken) throw new Error(`未拿到 app_token：${JSON.stringify(res)}`);
    console.log('appToken =', appToken);
  } else {
    console.log('复用 KB_APP_TOKEN =', appToken);
    if (!(await listTableNames(appToken)).includes('路由幂等表')) await createTable(appToken, '路由幂等表', ROUTE_FIELDS);
    else console.log('表「路由幂等表」已存在，跳过');
  }

  console.log('\n请把以下写入运行环境（on-event/digest 用）：');
  console.log(`KB_APP_TOKEN=${appToken}`);
  console.log('KB_ROUTE_TABLE=路由幂等表');
}

main().catch((e) => { console.error('建表失败：', e.message); process.exit(1); });
