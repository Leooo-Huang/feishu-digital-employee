import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig, probeLive, probeEvents, probeCron, summarize } from '../src/health.js';

test('checkConfig：env 缺则 ok=false 并给指引', () => {
  const r = checkConfig({});
  assert.equal(r.length, 2);
  assert.ok(r.every((c) => c.ok === false));
  assert.ok(r.every((c) => c.hint));
});

test('checkConfig：env 齐则 ok=true', () => {
  const r = checkConfig({ COLLECTOR_APP_TOKEN: 'a', KB_APP_TOKEN: 'b' });
  assert.ok(r.every((c) => c.ok === true));
});

test('probeLive：注入桩——用户 ready + 有知识空间', async () => {
  const run = async (argv) => {
    if (argv[1] === 'status') return { identities: { user: { status: 'ready' } } };
    return { items: [{ space_id: 'spc1' }] };
  };
  const r = await probeLive({}, { run });
  assert.ok(r.find((c) => c.item.includes('授权')).ok);
  assert.ok(r.find((c) => c.item.includes('知识空间')).ok);
});

test('probeLive：未授权 + 无知识空间 → ok=false 带指引', async () => {
  const run = async (argv) => (argv[1] === 'status' ? { identities: { user: { status: 'none' } } } : { items: [] });
  const r = await probeLive({}, { run });
  assert.equal(r.find((c) => c.item.includes('授权')).ok, false);
  const space = r.find((c) => c.item.includes('知识空间'));
  assert.equal(space.ok, false);
  assert.match(space.hint, /搭知识库/);
});

test('probeLive：探测抛错不崩，记为 ok=false', async () => {
  const run = async () => { throw new Error('network down'); };
  const r = await probeLive({}, { run });
  assert.ok(r.every((c) => c.ok === false));
});

test('probeEvents：bus 在线（真实结构 apps[].running）→ ok=true', async () => {
  const run = async () => ({ apps: [{ app_id: 'cli_x', status: 'running', running: true }] });
  const r = await probeEvents({}, { run });
  assert.equal(r[0].item, '事件订阅 daemon（event bus）');
  assert.ok(r[0].ok);
});

test('probeEvents：bus 未运行（not_running）→ ok=false 带 setup-events 指引', async () => {
  const run = async () => ({ apps: [{ app_id: 'cli_x', status: 'not_running', running: false }] });
  const r = await probeEvents({}, { run });
  assert.equal(r[0].ok, false);
  assert.match(r[0].hint, /setup-events --start/);
});

test('probeEvents：无 apps → ok=false', async () => {
  const r = await probeEvents({}, { run: async () => ({ apps: [] }) });
  assert.equal(r[0].ok, false);
});

test('probeEvents：探测抛错不崩，记为 ok=false', async () => {
  const r = await probeEvents({}, { run: async () => { throw new Error('event cmd missing'); } });
  assert.equal(r[0].ok, false);
  assert.match(r[0].hint, /探测失败/);
});

test('probeCron：crontab 含 tick/digest → 两项 ok=true', async () => {
  const listCrontab = async () => '# feishu-digital-employee:collector-tick\n*/30 * * * * cd /r && node skills/feishu-collector/bin/tick.js\n'
    + '# feishu-digital-employee:kb-weekly\n0 9 * * 1 cd /r && node skills/feishu-kb-maintainer/bin/digest.js --mode=report\n';
  const r = await probeCron({}, { listCrontab });
  assert.ok(r.find((c) => /tick/.test(c.item)).ok);
  assert.ok(r.find((c) => /digest/.test(c.item)).ok);
});

test('probeCron：crontab 无本项目任务 → ok=false 带 setup-cron 指引', async () => {
  const r = await probeCron({}, { listCrontab: async () => '0 0 * * * echo hi\n' });
  assert.ok(r.every((c) => c.ok === false));
  assert.match(r[0].hint, /setup-cron --install/);
});

test('probeCron：crontab 不可用（抛错）→ ok=false 容差，提示 systemd timer', async () => {
  const r = await probeCron({}, { listCrontab: async () => { throw new Error('no crontab'); } });
  assert.equal(r[0].ok, false);
  assert.match(r[0].hint, /systemd/);
});

test('summarize：缺失汇总', () => {
  assert.equal(summarize([{ ok: true }, { ok: true }]).allOk, true);
  const s = summarize([{ ok: true }, { ok: false, item: 'X' }]);
  assert.equal(s.allOk, false);
  assert.equal(s.missing.length, 1);
});
