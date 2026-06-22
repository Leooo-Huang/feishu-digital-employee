import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 在 import larkcli 之前设好 LARK_CLI_ENTRY，使 resolveLark() 指向测试桩。
const here = dirname(fileURLToPath(import.meta.url));
process.env.LARK_CLI_ENTRY = join(here, 'fixtures', 'fake-lark.js');
const { lark, larkJson } = await import('../src/larkcli.js');

test('larkJson：正常 JSON 解析', async () => {
  const r = await larkJson(['EMIT_JSON']);
  assert.equal(r.ok, true);
  assert.equal(r.v, 42);
});

test('larkJson：非 JSON 输出 → 抛带上下文的错误（#2）', async () => {
  await assert.rejects(() => larkJson(['EMIT_TEXT']), /非 JSON/);
});

test('larkJson：空输出 → 抛错（#2）', async () => {
  await assert.rejects(() => larkJson(['EMIT_EMPTY']), /输出为空/);
});

test('lark：exit 10 → 标记 confirmationRequired，不重试（#3）', async () => {
  await assert.rejects(() => lark(['EXIT_10']), (e) => e.code === 10 && e.confirmationRequired === true);
});

test('lark：非零退出 → 保留退出码（#3）', async () => {
  await assert.rejects(() => lark(['EXIT_NONZERO']), (e) => e.code === 2);
});

test('lark：超时 → 标记 timedOut（#1）', async () => {
  await assert.rejects(() => lark(['HANG'], { timeoutMs: 300 }), (e) => e.timedOut === true);
});
