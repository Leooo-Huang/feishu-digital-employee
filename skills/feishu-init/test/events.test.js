import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_EVENTS, resolveHandler, consumeArgv, planEvents, dispatchLine,
} from '../src/events.js';

test('REQUIRED_EVENTS：4 个事件，授权类型与 handler 正确', () => {
  assert.equal(REQUIRED_EVENTS.length, 4);
  const byKey = Object.fromEntries(REQUIRED_EVENTS.map((e) => [e.key, e]));
  // minutes/vc 是 user 授权（不订阅就收不到妙记事件——问题2根因）
  assert.equal(byKey['minutes.minute.generated_v1'].as, 'user');
  assert.equal(byKey['vc.note.generated_v1'].as, 'user');
  // im 类是 bot 授权
  assert.equal(byKey['im.message.receive_v1'].as, 'bot');
  assert.equal(byKey['im.chat.member.bot.added_v1'].as, 'bot');
  // bot 入群 → init（冷启动），接迭代A
  assert.deepEqual(byKey['im.chat.member.bot.added_v1'].handlers, ['init']);
  // im.message 双消费者：kb 沉淀 + collector 收集
  assert.deepEqual(byKey['im.message.receive_v1'].handlers, ['kb', 'collector']);
});

test('consumeArgv：构造 event consume 命令；带 profile 作全局前置', () => {
  const evt = REQUIRED_EVENTS[0];
  assert.deepEqual(consumeArgv(evt), ['event', 'consume', 'minutes.minute.generated_v1', '--as', 'user', '--quiet']);
  assert.deepEqual(consumeArgv(evt, { profile: 'qianhai' }),
    ['--profile', 'qianhai', 'event', 'consume', 'minutes.minute.generated_v1', '--as', 'user', '--quiet']);
});

test('resolveHandler：已知 id 解析为绝对路径；未知 id 抛错', () => {
  assert.match(resolveHandler('kb'), /feishu-kb-maintainer\/bin\/on-event\.js$/);
  assert.match(resolveHandler('collector'), /feishu-collector\/bin\/on-message\.js$/);
  assert.match(resolveHandler('init'), /feishu-init\/bin\/init\.js$/);
  assert.throws(() => resolveHandler('nope'), /未知 handler/);
});

test('planEvents：展开成可读计划（consume 命令 + handler 路径）', () => {
  const plan = planEvents();
  assert.equal(plan.length, 4);
  assert.match(plan[0].consume, /event consume minutes\.minute\.generated_v1 --as user --quiet/);
  assert.ok(plan.find((p) => p.key === 'im.message.receive_v1').handlers.length === 2);
});

test('dispatchLine：一行事件 spawn 全部 handler，参数为 --event <line>（注入 spawnFn）', () => {
  const calls = [];
  const spawnFn = (cmd, args) => { calls.push({ cmd, args }); return { on() {}, killed: false }; };
  const evt = { key: 'im.message.receive_v1', as: 'bot', handlers: ['kb', 'collector'] };
  const line = '{"header":{"event_type":"im.message.receive_v1"}}';
  const procs = dispatchLine(line, evt, { spawnFn });
  assert.equal(procs.length, 2); // 两个 handler 各 spawn 一次
  assert.equal(calls.length, 2);
  // 每个调用都是 node <handler> --event <line>
  for (const c of calls) {
    assert.equal(c.cmd, process.execPath);
    assert.equal(c.args[1], '--event');
    assert.equal(c.args[2], line);
  }
  assert.match(calls[0].args[0], /on-event\.js$/);
  assert.match(calls[1].args[0], /on-message\.js$/);
});

test('dispatchLine：空行跳过、不 spawn', () => {
  let spawned = 0;
  const spawnFn = () => { spawned++; return { on() {} }; };
  const evt = REQUIRED_EVENTS[0];
  assert.deepEqual(dispatchLine('   ', evt, { spawnFn }), []);
  assert.deepEqual(dispatchLine('', evt, { spawnFn }), []);
  assert.equal(spawned, 0);
});
