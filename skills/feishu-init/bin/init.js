#!/usr/bin/env node
// 心跳入口（编排器·书童引导）：把一条"引导类"消息分类，产出工作上下文给宿主 LLM。
// 用法: node bin/init.js --text "你好"  | node bin/init.js --event '<事件JSON>'
import { classifyInit } from '../src/intent.js';
import { welcomeText, capabilityMenuText, coldStartChoiceText, healthReportText } from '../src/cards.js';
import { checkConfig } from '../../feishu-shared/src/health.js';

function readInput() {
  const ti = process.argv.indexOf('--text');
  if (ti >= 0) return process.argv[ti + 1] || '';
  const ei = process.argv.indexOf('--event');
  if (ei >= 0) {
    try {
      const ev = JSON.parse(process.argv[ei + 1] || '{}');
      const m = ev.event?.message || ev.message || {};
      try { return JSON.parse(m.content || '{}').text || ''; } catch { return m.content || ''; }
    } catch { return ''; }
  }
  return '';
}

function main() {
  const text = readInput();
  const intent = classifyInit(text);
  const out = { intent };
  switch (intent) {
    case 'welcome': out.reply = welcomeText(); break;
    case 'help': out.reply = capabilityMenuText(); break;
    case 'health': {
      out.checklist = checkConfig();
      out.reply = healthReportText(out.checklist);
      out.hint = '需要活体探测（授权/知识空间）再调 feishu-shared/health.probeLive(ctx)，把结果并进 checklist。';
      break;
    }
    case 'scaffold':
      out.reply = coldStartChoiceText();
      out.hint = '流程4：kb-scaffold.planScaffold(已存在节点标题)→createTree 建骨架（幂等）；再据用户回复进 interview / import。';
      break;
    case 'interview':
      out.hint = '流程5-访谈：kb-interview.nextQuestion 逐题问 → 收答 → formatAnswerForKb → doc.appendDoc 写进目标节点 → kb-route.recordRoute 留痕（空答案跳过、缺失不编造）。';
      break;
    case 'import':
      out.hint = '流程5-导入：提示用户发资料 → file 解析（本地转在线）→ kb-extract 归类 → kb-route.decideRoute 去重 → doc 写进骨架对应节点 → recordRoute。';
      break;
    default:
      out.reply = capabilityMenuText();
      out.hint = '意图不明：回退到能力菜单，别让用户撞到沉默。';
  }
  console.log(JSON.stringify(out, null, 2));
}

main();
