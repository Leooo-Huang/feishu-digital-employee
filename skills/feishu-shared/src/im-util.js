// IM 事件工具。
// isBotMentioned：判定一条消息是否 @ 了 bot。精确匹配 bot 自身 open_id；
// 未配置 botId 时退化为"消息含结构化 @ 提及"，不再用裸文本 /@/ 正则
// （后者会把 @别人、邮箱、纯文本里的 @ 误判为 @机器人）。
export function isBotMentioned(mentions, botId) {
  const list = Array.isArray(mentions) ? mentions : [];
  if (botId) return list.some((x) => (x?.id?.open_id || x?.open_id || x?.id) === botId);
  return list.length > 0;
}
