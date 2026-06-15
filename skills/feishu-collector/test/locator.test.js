import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWriteCommand } from '../src/locator.js';

test('sheet 落点 → sheets +cells-set argv，值在 --cells JSON 内', () => {
  const argv = buildWriteCommand({ kind: 'sheet', token: 'shtcnX', sheetId: '0b', cell: 'C5' }, 'L');
  assert.equal(argv[0], 'sheets');
  assert.ok(argv.includes('+cells-set'));
  assert.ok(argv.includes('shtcnX'));
  const range = argv[argv.indexOf('--range') + 1];
  assert.match(range, /0b!C5/);
  const cells = argv[argv.indexOf('--cells') + 1];
  assert.match(cells, /"value":"L"/);
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
