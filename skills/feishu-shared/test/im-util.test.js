import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBotMentioned } from '../src/im-util.js';

const BOT = 'ou_bot';

test('配了 botId：精确命中 bot 的提及 → true', () => {
  assert.equal(isBotMentioned([{ id: { open_id: 'ou_bot' } }], BOT), true);
});
test('配了 botId：只 @ 别人 → false（不误判）', () => {
  assert.equal(isBotMentioned([{ id: { open_id: 'ou_other' } }], BOT), false);
});
test('未配 botId：有结构化提及 → true', () => {
  assert.equal(isBotMentioned([{ key: '@_user_1' }], undefined), true);
});
test('未配 botId：无结构化提及 → false（裸文本 @ 不再误判）', () => {
  assert.equal(isBotMentioned([], undefined), false);
  assert.equal(isBotMentioned(undefined, undefined), false);
});
test('兼容 open_id / id 扁平形态', () => {
  assert.equal(isBotMentioned([{ open_id: 'ou_bot' }], BOT), true);
  assert.equal(isBotMentioned([{ id: 'ou_bot' }], BOT), true);
});
