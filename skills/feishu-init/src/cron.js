// cron 定时任务编排（问题3）。把三条周期心跳（收集催办 / 群聊拉取 / 周报）配成系统 crontab。
//
// 为什么用系统 crontab（不是 `hermes cron create`）：实测项目无 hermes cron 子命令；
//   README/各 SKILL 的约定就是"外接系统 cron / systemd timer"（collector tick 每30分、digest 外接 cron）。
//
// cron 环境坑（已规避）：
//   ① cron 的 PATH 极简（/usr/bin:/bin），`node` 可能找不到 → 用**绝对 node 路径**（process.execPath）。
//   ② cron 调度行不能写 `#` 行内注释（会传给 shell）→ 注释单独成行（marker 行）。
//   ③ 命令经 /bin/sh 执行，故 `KEY=val cmd` 内联 env 可行；但**密钥**（KB_APP_TOKEN 等）不写进 crontab，
//      交 crontab 头或 systemd EnvironmentFile 提供（避免密钥落进可被覆盖/版本化的 crontab）。
//
// 纯函数（planCron/renderCrontab/mergeCrontab）可单测；安装 I/O 在 bin/init.js 注入真实 crontab 读写。

// marker：用于幂等识别"本项目的" crontab 块（合并时按此剔除旧块、保留用户其它条目）。
export const CRON_MARKER = '# feishu-digital-employee';

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function logPath(id) { return `/tmp/feishu-${id}.log`; } // /tmp 必存在且可写；cron 不会替你建目录

/**
 * 纯函数：产出三条 cron 任务计划。
 * @param opts.repoRoot  仓库根（cron 命令先 cd 进去，相对路径才成立）
 * @param opts.nodePath  node 绝对路径（默认 process.execPath，规避 cron PATH 极简）
 * @param opts.profile   LARK_PROFILE（非密钥，可内联进命令）
 * @param opts.env       读取调度/窗口覆盖项（默认 process.env）
 * @returns Array<{id, schedule, desc, command}>
 */
export function planCron({ repoRoot, nodePath = process.execPath, profile, env = process.env } = {}) {
  const root = repoRoot || process.cwd();
  const prof = profile || env.LARK_PROFILE;
  const profInline = prof ? `LARK_PROFILE=${prof} ` : '';
  const chatsWindow = env.KB_CHATS_WINDOW_H || '6';
  const weeklyWindow = env.KB_WEEKLY_WINDOW_H || '168';
  const mk = (id, schedule, rel, args, desc, extraEnv = '') => ({
    id, schedule, desc,
    command: `cd ${root} && ${profInline}${extraEnv}${nodePath} ${rel}${args ? ' ' + args : ''} >> ${logPath(id)} 2>&1`,
  });
  return [
    mk('collector-tick', env.COLLECTOR_TICK_CRON || '*/30 * * * *',
      'skills/feishu-collector/bin/tick.js', '', '收集线催办心跳：遍历进行中任务，未交项发提醒（每30分钟）'),
    mk('kb-chats', env.KB_CHATS_CRON || '0 */6 * * *',
      'skills/feishu-kb-maintainer/bin/digest.js', '--mode=chats', '群聊定时拉取沉淀（KB_DIGEST_CHATS 指定的群，每6小时）',
      `KB_DIGEST_WINDOW_H=${chatsWindow} `),
    mk('kb-weekly', env.KB_WEEKLY_CRON || '0 9 * * 1',
      'skills/feishu-kb-maintainer/bin/digest.js', '--mode=report', '周报素材汇总（每周一 09:00）',
      `KB_DIGEST_WINDOW_H=${weeklyWindow} `),
  ];
}

/** 纯函数：渲染单个任务为 crontab 块（marker 注释行 + 调度行）。 */
export function renderEntry(e) {
  return `${CRON_MARKER}:${e.id}  ${e.desc}\n${e.schedule} ${e.command}`;
}

/** 纯函数：渲染全部任务为可粘贴的 crontab 文本（块间空行）。 */
export function renderCrontab(entries) {
  return entries.map(renderEntry).join('\n\n') + '\n';
}

/**
 * 纯函数：幂等合并。保留用户已有（非本项目）条目；按 marker 剔除本项目旧块，再追加最新块。
 * 幂等：mergeCrontab(mergeCrontab(x, e), e) === mergeCrontab(x, e)（重复安装结果稳定）。
 */
export function mergeCrontab(existingText = '', entries = []) {
  const lines = String(existingText).split('\n');
  const markerRe = new RegExp(`^${escapeRe(CRON_MARKER)}:`);
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (markerRe.test(lines[i])) {
      // 命中本项目 marker：跳过 marker 行 + 其后连续的调度命令行（非空、非下一个 marker）。
      i++;
      while (i < lines.length && lines[i].trim() && !markerRe.test(lines[i])) i++;
      i--; // 抵消 for 的 ++，让下一轮重新判定当前行
      continue;
    }
    kept.push(lines[i]);
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop(); // 去尾部空行
  const block = renderCrontab(entries).replace(/\n$/, '');
  const head = kept.length ? `${kept.join('\n')}\n\n` : '';
  return `${head}${block}\n`;
}
