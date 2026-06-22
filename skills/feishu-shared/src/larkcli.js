// lark-cli 薄封装：跨平台解析 + execFile 调用 + JSON 解析。
// Windows 下 lark-cli 是 .cmd shim，Node execFile 无法直接 spawn；
// 故优先用 `node <@larksuite/cli/scripts/run.js>` 直接跑 JS 入口（无 shell、无引号问题、三平台通用）。
//
// 健壮性（Phase B #1-3）：
//   #1 超时：execFile 带 timeout + killSignal，避免飞书卡住时常驻进程/cron 永久挂起。
//   #2 JSON.parse 守护：larkJson 对空/非 JSON（markdown/告警）输出抛带上下文的错误，不裸崩。
//   #3 退出码：保留 e.code；识别 exit 10（high-risk-write 二次确认），并支持幂等读的有限重试。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
const pexec = promisify(execFile);

// 默认超时 60s，可用 LARK_CLI_TIMEOUT_MS 覆盖。
const DEFAULT_TIMEOUT_MS = Number(process.env.LARK_CLI_TIMEOUT_MS) || 60_000;

function resolveLark() {
  if (process.env.LARK_CLI_ENTRY) return { cmd: process.execPath, pre: [process.env.LARK_CLI_ENTRY] };
  if (process.env.LARK_CLI_BIN) return { cmd: process.env.LARK_CLI_BIN, pre: [] };
  const rel = join('node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const entry = join(dir, rel);
    if (existsSync(entry)) return { cmd: process.execPath, pre: [entry] };
  }
  // 兜底：非 win32 PATH 可直接解析 lark-cli；win32 上 .cmd shim 无法被 execFile 直接 spawn，明确报错（P2）。
  if (process.platform === 'win32') {
    throw new Error('未找到 lark-cli 的 JS 入口（@larksuite/cli/scripts/run.js）。Windows 下请设置 LARK_CLI_ENTRY 指向 run.js，或 LARK_CLI_BIN 指向可执行文件。');
  }
  return { cmd: 'lark-cli', pre: [] };
}
const { cmd: LARK_CMD, pre: LARK_PRE } = resolveLark();

/**
 * 调 lark-cli，返回 { stdout, stderr }。
 * @param argv string[]  例如 ['base','+record-list','--base-token','x']
 * @param opts.profile    指定 --profile（如 'qianhai'）
 * @param opts.timeoutMs  覆盖默认超时
 * @param opts.retries    瞬时失败（超时/无退出码）重试次数；默认 0。仅对幂等读使用，写操作切勿设置。
 * 失败抛错：保留 e.code（退出码）；exit 10 标记 confirmationRequired；超时标记 timedOut。
 */
export async function lark(argv, { profile, timeoutMs, retries = 0 } = {}) {
  const args = [...LARK_PRE, ...(profile ? ['--profile', profile] : []), ...argv];
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr } = await pexec(LARK_CMD, args, {
        maxBuffer: 16 * 1024 * 1024, timeout, killSignal: 'SIGTERM',
      });
      return { stdout, stderr };
    } catch (e) {
      lastErr = e;
      const code = e.code;
      const timedOut = e.killed === true || e.signal === 'SIGTERM' || /timed?\s*out/i.test(e.message || '');
      // exit 10 = high-risk-write 二次确认：绝不重试，原样上抛并明确标记。
      if (code === 10) {
        const err = new Error(`lark-cli ${argv.join(' ')} 需要二次确认 (exit 10, high-risk-write)：${e.stderr || e.message}`);
        err.code = 10; err.confirmationRequired = true; err.stderr = e.stderr;
        throw err;
      }
      // 仅对瞬时故障（超时 / 无退出码的进程级错误）重试，且不在最后一次。
      if (attempt < retries && (timedOut || code === undefined || code === null)) continue;
      const err = new Error(`lark-cli ${argv.join(' ')} ${timedOut ? `超时 (${timeout}ms)` : '失败'}: ${e.stderr || e.message}`);
      if (code !== undefined && code !== null) err.code = code;
      err.timedOut = timedOut; err.stderr = e.stderr;
      throw err;
    }
  }
  throw lastErr;
}

/** 调 lark-cli 并把 stdout 解析为 JSON。空/非 JSON 输出抛带上下文的错误（#2）。 */
export async function larkJson(argv, opts) {
  const { stdout } = await lark(argv, opts);
  const s = String(stdout ?? '').trim();
  if (!s) throw new Error(`lark-cli ${argv.join(' ')} 输出为空，无法解析为 JSON`);
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`lark-cli ${argv.join(' ')} 输出非 JSON（前 300 字符）：${s.slice(0, 300)}`);
  }
}
