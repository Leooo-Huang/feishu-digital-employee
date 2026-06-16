// lark-cli 薄封装：跨平台解析 + execFile 调用 + JSON 解析。
// Windows 下 lark-cli 是 .cmd shim，Node execFile 无法直接 spawn；
// 故优先用 `node <@larksuite/cli/scripts/run.js>` 直接跑 JS 入口（无 shell、无引号问题、三平台通用）。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
const pexec = promisify(execFile);

function resolveLark() {
  if (process.env.LARK_CLI_ENTRY) return { cmd: process.execPath, pre: [process.env.LARK_CLI_ENTRY] };
  if (process.env.LARK_CLI_BIN) return { cmd: process.env.LARK_CLI_BIN, pre: [] };
  const rel = join('node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const entry = join(dir, rel);
    if (existsSync(entry)) return { cmd: process.execPath, pre: [entry] };
  }
  return { cmd: 'lark-cli', pre: [] }; // 兜底（非 win32 PATH 可直接解析）
}
const { cmd: LARK_CMD, pre: LARK_PRE } = resolveLark();

/**
 * 调 lark-cli，返回 { stdout, stderr }；非零退出抛错并带 stderr。
 * @param argv string[]  例如 ['base','+record-list','--base-token','x']
 * @param opts.profile   指定 --profile（如 'qianhai'）
 */
export async function lark(argv, { profile } = {}) {
  const args = [...LARK_PRE, ...(profile ? ['--profile', profile] : []), ...argv];
  try {
    const { stdout, stderr } = await pexec(LARK_CMD, args, { maxBuffer: 16 * 1024 * 1024 });
    return { stdout, stderr };
  } catch (e) {
    throw new Error(`lark-cli ${argv.join(' ')} 失败: ${e.stderr || e.message}`);
  }
}

/** 调 lark-cli 并把 stdout 解析为 JSON（命令需带 --json/输出 JSON） */
export async function larkJson(argv, opts) {
  const { stdout } = await lark(argv, opts);
  return JSON.parse(stdout);
}
