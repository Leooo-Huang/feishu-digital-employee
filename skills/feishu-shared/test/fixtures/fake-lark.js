// 测试桩：按 argv 标记模拟 lark-cli 的各种输出/退出，供 larkcli.test.js 经 LARK_CLI_ENTRY 调用。
const marker = process.argv.find((a) => /^(EMIT_JSON|EMIT_TEXT|EMIT_EMPTY|EXIT_NONZERO|EXIT_10|HANG)$/.test(a));
switch (marker) {
  case 'EMIT_JSON': process.stdout.write('{"ok":true,"v":42}'); break;
  case 'EMIT_TEXT': process.stdout.write('这不是 JSON\n# 一段 markdown'); break;
  case 'EMIT_EMPTY': break; // 空输出
  case 'EXIT_NONZERO': process.stderr.write('boom'); process.exit(2); break;
  case 'EXIT_10': process.stderr.write('confirmation_required'); process.exit(10); break;
  case 'HANG': setInterval(() => {}, 1000); break; // 永不退出 → 触发超时
  default: process.stdout.write('{}');
}
