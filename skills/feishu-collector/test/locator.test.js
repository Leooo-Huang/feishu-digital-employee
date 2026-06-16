import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWriteCommand } from '../src/locator.js';

test('sheet 落点 → cells-set：token/sheet/range 分开传，range 不带 sheet 前缀', () => {
  const argv = buildWriteCommand({ kind: 'sheet', token: 'shtcnX', sheetId: '0b', cell: 'C5' }, 'L');
  assert.equal(argv[0], 'sheets');
  assert.ok(argv.includes('+cells-set'));
  assert.equal(argv[argv.indexOf('--spreadsheet-token') + 1], 'shtcnX');
  assert.equal(argv[argv.indexOf('--sheet-id') + 1], '0b');
  assert.equal(argv[argv.indexOf('--range') + 1], 'C5'); // 无 sheet 前缀
  const cells = argv[argv.indexOf('--cells') + 1];
  assert.match(cells, /"value":"L"/);
});
test('sheet 落点 无 sheetId 时回退 --sheet-name', () => {
  const argv = buildWriteCommand({ kind: 'sheet', token: 'shtcnX', sheetName: '报名', cell: 'C5' }, 'L');
  assert.equal(argv[argv.indexOf('--sheet-name') + 1], '报名');
  assert.ok(!argv.includes('--sheet-id'));
});
test('base 落点 → base +record-upsert argv，字段在 --json 内', () => {
  const argv = buildWriteCommand(
    { kind: 'base', appToken: 'bascnX', tableId: 'tblX', recordId: 'recX', field: '尺码' }, 'L');
  assert.equal(argv[0], 'base');
  assert.ok(argv.includes('+record-upsert'));
  assert.ok(argv.includes('recX'));
  const json = argv[argv.indexOf('--json') + 1];
  assert.match(json, /尺码/);
  assert.match(json, /L/);
});
test('doc 落点 → docs +update argv', () => {
  const argv = buildWriteCommand({ kind: 'doc', token: 'docX', blockId: 'blkX' }, '完成');
  assert.equal(argv[0], 'docs');
  assert.ok(argv.includes('+update'));
  assert.ok(argv.includes('blkX'));
});
test('未知 kind 抛错', () => {
  assert.throws(() => buildWriteCommand({ kind: 'pdf' }, 'x'));
});
