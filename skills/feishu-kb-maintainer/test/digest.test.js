import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseMode } from '../bin/digest.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/digest.js');
// 空 token + 空群：digest 不发任何网络请求（gatherDigestMaterial 无 appToken 早返回、无群则不拉），可在测试机跑。
const HERMETIC_ENV = { ...process.env, KB_APP_TOKEN: '', KB_DIGEST_CHATS: '', LARK_PROFILE: '' };
function run(args) {
  const r = spawnSync('node', [BIN, ...args], { encoding: 'utf8', env: HERMETIC_ENV });
  return { ...r, json: JSON.parse(r.stdout) };
}

test('parseMode：缺省两者都做（向后兼容）', () => {
  assert.deepEqual(parseMode(['node', 'digest.js']), { chats: true, report: true });
});
test('parseMode：--mode=chats / --mode=report / 逗号组合', () => {
  assert.deepEqual(parseMode(['node', 'd', '--mode=chats']), { chats: true, report: false });
  assert.deepEqual(parseMode(['node', 'd', '--mode=report']), { chats: false, report: true });
  assert.deepEqual(parseMode(['node', 'd', '--mode=chats,report']), { chats: true, report: true });
});

test('digest --mode=chats：只出 chatPulls，digestMaterial 空', () => {
  const { json } = run(['--mode=chats']);
  assert.equal(json.modes.chats, true);
  assert.equal(json.modes.report, false);
  assert.deepEqual(json.digestMaterial, { doc: [], task: [], okr: [] });
});

test('digest --mode=report：只出 digestMaterial，chatPulls 空', () => {
  const { json } = run(['--mode=report']);
  assert.equal(json.modes.report, true);
  assert.equal(json.modes.chats, false);
  assert.deepEqual(json.chatPulls, []);
});

test('digest 默认：两者都做（向后兼容）', () => {
  const { json } = run([]);
  assert.equal(json.modes.chats, true);
  assert.equal(json.modes.report, true);
});

test('digest：KB_DIGEST_CHATS 空不产生空 chatId 拉取（修复 [""] bug）', () => {
  const { json } = run(['--mode=chats']);
  assert.deepEqual(json.chatPulls, []); // 空群 → 不拉，绝不出现 chatId='' 的批次
});
