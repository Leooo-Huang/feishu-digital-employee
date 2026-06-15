// 落点 → lark-cli 写命令 argv 生成。纯函数。
// 命令名依据 docs/pipeline/env-capabilities.yaml（2026-06-16 实测）。
// 注意：value 应已由调用方(base-io)按字段类型整形成正确的 CellValue。
export function buildWriteCommand(loc, value) {
  switch (loc.kind) {
    case 'sheet':
      // sheets +cells-set --range 'SheetId!C5' --cells '[[{"value":"L"}]]'
      // TODO(集成): spreadsheet token 旗标名待 `sheets +cells-set --help` 全量确认（见 yaml TODO）
      return ['sheets', '+cells-set',
        '--spreadsheet-token', loc.token,
        '--range', `${loc.sheetId}!${loc.cell}`,
        '--cells', JSON.stringify([[{ value: String(value) }]]),
        '--as', 'user', '--json'];
    case 'base':
      // base +record-upsert --base-token .. --table-id .. --record-id .. --json '{field:value}'
      return ['base', '+record-upsert',
        '--base-token', loc.appToken,
        '--table-id', loc.tableId,
        '--record-id', loc.recordId,
        '--json', JSON.stringify({ [loc.field]: value }),
        '--as', 'user', '--json'];
    case 'doc':
      // docs +update（写文档；实际 selector/block-id 用法见 `lark-cli skills read lark-doc`）
      return ['docs', '+update',
        '--doc', loc.token,
        '--block-id', loc.blockId,
        '--text', String(value),
        '--as', 'user'];
    default:
      throw new Error(`不支持的落点类型: ${loc.kind}`);
  }
}
