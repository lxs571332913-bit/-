// Vercel Serverless 入口：所有 /api/* 请求经 vercel.json 的 rewrites 转发到这里
// 逻辑全部在 server.js 中（导出的 handler），这里只做转发
import handler from '../server.js';

export default handler;