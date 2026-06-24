// 引导意图分类（纯函数）。把用户文本归到一条 init 流程。
// 顺序有讲究：更专指的关键词先判，"你好/开始"等宽泛词兜底到 welcome。
export function classifyInit(text = '') {
  const t = String(text).trim().toLowerCase();
  if (!t) return 'welcome';
  if (/体检|检查配置|诊断|健康检查|检查一下配置/.test(t)) return 'health';
  if (/搭知识库|搭建知识库|建知识库|初始化知识库|骨架|scaffold|初始化/.test(t)) return 'scaffold';
  if (/访谈|采访|问我|提问收集|主动问|interview/.test(t)) return 'interview';
  if (/导入|上传资料|上传文件|导资料|import/.test(t)) return 'import';
  if (/帮助|help|菜单|menu|能做什么|有什么功能|功能列表|怎么用|你会什么/.test(t)) return 'help';
  if (/^(你好|您好|hi|hello|在吗|开始|start|嗨)/.test(t) || /你是谁|介绍下你/.test(t)) return 'welcome';
  return 'unknown';
}

// 从飞书事件对象识别 EventKey（对标 kb-maintainer/on-event.js）。
// 显式 key 字段优先；入群事件结构与消息事件差异大且结构推断有歧义，故只认显式 key，不做结构兜底。
export function eventKeyOf(ev = {}) {
  return ev.event_key || ev.key || ev.header?.event_type || ev.schema_key
    || (ev.event?.message || ev.message ? 'im.message.receive_v1' : null);
}

// 事件 → init 意图。bot 入群（首次接触）触发欢迎；其余引导事件暂无 → null（交文本分类/忽略）。
export function classifyEvent(eventKey) {
  if (eventKey === 'im.chat.member.bot.added_v1') return 'welcome';
  return null;
}
