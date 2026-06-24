import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCron, renderCrontab, mergeCrontab, CRON_MARKER } from '../src/cron.js';

const OPTS = { repoRoot: '/repo', nodePath: '/usr/bin/node', env: {} };

test('planCron：三条任务（tick/chats/weekly），绝对 node 路径 + cd repoRoot', () => {
  const e = planCron(OPTS);
  assert.equal(e.length, 3);
  assert.deepEqual(e.map((x) => x.id), ['collector-tick', 'kb-chats', 'kb-weekly']);
  assert.match(e[0].command, /^cd \/repo && \/usr\/bin\/node skills\/feishu-collector\/bin\/tick\.js/);
  assert.match(e[1].command, /digest\.js --mode=chats/);
  assert.match(e[1].command, /KB_DIGEST_WINDOW_H=6/);
  assert.match(e[2].command, /digest\.js --mode=report/);
  assert.match(e[2].command, /KB_DIGEST_WINDOW_H=168/);
  assert.equal(e[2].schedule, '0 9 * * 1');
});

test('planCron：profile 内联进命令；schedule/window 可被 env 覆盖', () => {
  const e = planCron({ repoRoot: '/repo', nodePath: '/n', profile: 'qianhai',
    env: { COLLECTOR_TICK_CRON: '*/15 * * * *', KB_CHATS_WINDOW_H: '12' } });
  assert.match(e[0].command, /LARK_PROFILE=qianhai /);
  assert.equal(e[0].schedule, '*/15 * * * *');
  assert.match(e[1].command, /KB_DIGEST_WINDOW_H=12/);
});

test('renderCrontab：marker 注释单独成行（cron 行内不可含 #）+ 调度行', () => {
  const txt = renderCrontab(planCron(OPTS));
  assert.match(txt, new RegExp(`${CRON_MARKER}:collector-tick`));
  // 调度行本身不含 marker 注释（# 不能跟在命令后）
  const lines = txt.split('\n');
  const schedLine = lines.find((l) => l.startsWith('*/30'));
  assert.ok(schedLine && !schedLine.includes('#'));
});

test('mergeCrontab：保留用户已有条目；不重复追加', () => {
  const existing = '# 我的任务\n0 0 * * * echo backup\n';
  const merged = mergeCrontab(existing, planCron(OPTS));
  assert.match(merged, /我的任务/);
  assert.match(merged, /echo backup/);
  assert.match(merged, /collector-tick/);
  // 本项目 marker 只出现一次（每 id）
  assert.equal((merged.match(/feishu-digital-employee:collector-tick/g) || []).length, 1);
});

test('mergeCrontab：替换旧块（改了 schedule 后重装，不残留旧行）', () => {
  const first = mergeCrontab('', planCron(OPTS));
  const changed = planCron({ ...OPTS, env: { COLLECTOR_TICK_CRON: '*/5 * * * *' } });
  const second = mergeCrontab(first, changed);
  assert.match(second, /\*\/5 \* \* \* \* cd \/repo/);
  assert.ok(!second.includes('*/30 * * * * cd /repo')); // 旧 tick 调度已被剔除
  assert.equal((second.match(/feishu-digital-employee:collector-tick/g) || []).length, 1);
});

test('mergeCrontab：幂等（重复合并结果稳定）', () => {
  const entries = planCron(OPTS);
  const once = mergeCrontab('0 0 * * * user\n', entries);
  const twice = mergeCrontab(once, entries);
  assert.equal(once, twice);
});
