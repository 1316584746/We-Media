#!/usr/bin/env node
// 示例 MCP 服务（stdio）：提供一个「查资料」工具，用来演示 / 自测「扩展 → MCP 服务」和「工具增强」。
// 在应用里添加：命令 node，参数 scripts/sample-mcp-server.js（用绝对路径更稳）。
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const FACTS = {
  池上: '《池上》是白居易的五言绝句，写一个小孩撑着小船偷采白莲，回来时浮萍被船划开一道水痕，他却不懂得隐藏行踪。全诗充满童趣，场景是夏日的池塘、白莲、浮萍。',
  白居易: '白居易（772—846），字乐天，号香山居士，唐代现实主义诗人，诗风平易近人，代表作有《长恨歌》《琵琶行》。',
  静夜思: '《静夜思》是李白的五言绝句，写旅居他乡的人在月夜里思念故乡，意象是床前的月光、明月，情绪是思乡。',
};

const server = new McpServer({ name: 'sample-research', version: '1.0.0' });

server.tool(
  'lookup_background',
  '查询古诗词、人物或典故的背景资料。输入关键词（如诗名、作者名），返回简要的背景介绍。',
  { keyword: z.string().describe('要查询的关键词，如《池上》或 白居易') },
  async ({ keyword }) => {
    const hit = Object.entries(FACTS).find(([k]) => keyword.includes(k));
    return { content: [{ type: 'text', text: hit ? hit[1] : `没有找到「${keyword}」的资料。` }] };
  },
);

server.connect(new StdioServerTransport()).catch((e) => {
  console.error(e);
  process.exit(1);
});
