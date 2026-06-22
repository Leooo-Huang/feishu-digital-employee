// 落点 → lark-cli 写命令 argv 生成。纯函数。
// 命令面经实测校准 (lark-cli 1.0.53)。
// 注意：value 应已由调用方(base-io)按字段类型整形成正确的 CellValue。
export function buildWriteCommand(loc, value) {
  switch (loc.kind) {
    case 'sheet':
      // sheets +cells-set --spreadsheet-token T (--sheet-id S | --sheet-name N) --range C5(无 sheet 前缀) --cells [[{value}]]
      return ['sheets', '+cells-set',
        '--spreadsheet-token', loc.token,
        ...(loc.sheetId ? ['--sheet-id', loc.sheetId] : ['--sheet-name', loc.sheetName || 'Sheet1']),
        '--range', loc.cell,
        '--cells', JSON.stringify([[{ value: String(value) }]]),
        '--format', 'json', '--as', 'user'];
    case 'base':
      // base +record-upsert --base-token .. --table-id .. --record-id .. --json '{field:value}'（--json 即字段映射，默认输出 json）
      return ['base', '+record-upsert',
        '--base-token', loc.appToken,
        '--table-id', loc.tableId,
        '--record-id', loc.recordId,
        '--json', JSON.stringify({ [loc.field]: value }),
        '--format', 'json', '--as', 'user'];
    case 'doc':
      // docs +update --command block_replace --block-id B --content <md> --doc-format markdown（不是 --text）
      return ['docs', '+update',
        '--doc', loc.token,
        '--command', 'block_replace',
        '--block-id', loc.blockId,
        '--content', String(value),
        '--doc-format', 'markdown',
        '--format', 'json', '--as', 'user'];
    default:
      throw new Error(`不支持的落点类型: ${loc.kind}`);
  }
}
