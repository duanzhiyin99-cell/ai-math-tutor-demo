/**
 * AI 数学学习助手 —— MVP Demo 服务器
 * 零依赖：仅使用 Node.js 内置模块。
 *
 * 运行：
 *   node server.js                          # 默认 mock 模式（离线可跑）
 *   LLM_API_KEY=sk-xxx node server.js       # 自动切换到真实大模型（OpenAI 兼容协议）
 *   LLM_BASE_URL=https://... LLM_MODEL=gpt-4o-mini node server.js
 *
 * 接口：
 *   GET  /api/mode        → 当前模式（mock / llm）
 *   GET  /api/samples     → 示例题库
 *   POST /api/recognize   → 拍照识题（{ image?: base64, sampleId? }）
 *   POST /api/solve       → 分步讲解（{ problem, level }）
 *   POST /api/analyze     → 错因分析（{ problem, myWork, level }）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const MockEngine = require('./public/js/mockEngine.js');

/* 加载本地 .env（含密钥，勿提交到仓库；已配置的环境变量优先） */
(function loadEnvFile() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
})();

const PORT = process.env.PORT || 8080;
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const USE_LLM = !!LLM_API_KEY;

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

/* ---------------- 工具 ---------------- */
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 12 * 1024 * 1024) { req.destroy(); reject(new Error('请求体过大')); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  let filePath = path.normalize(path.join(PUBLIC, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (urlPath === '/' || urlPath === '') filePath = path.join(PUBLIC, 'index.html');
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------- 大模型调用（OpenAI 兼容） ---------------- */
async function llmChat(messages, { maxTokens = 1600, json = false } = {}) {
  const payload = {
    model: LLM_MODEL,
    messages,
    max_tokens: maxTokens
  };
  if (json) payload.response_format = { type: 'json_object' };
  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LLM API ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
}

function parseJSONFromLLM(text) {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM 未返回 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const LLM_SYSTEM = `你是一位专业的中国数学老师，面向中学生/大学生讲题。
要求：
1. 分步讲解必须完整，禁止跳步；每一步包含 title（步骤名）、body（这一步的数学表达式或操作）、why（这一步的依据/为什么）。
2. 输出 JSON 对象：{ "typeName": "题型名", "steps": [{ "title","body","why" }], "answer": "最终答案" }。
3. 答案与讲解用中文，公式用 LaTeX/文本形式（如 x^2、1/2、√3）。`;

async function solveViaLLM(problem, level) {
  const content = await llmChat([
    { role: 'system', content: LLM_SYSTEM },
    { role: 'user', content: `题目：${problem}\n讲解深度：${level || '标准'}。请输出 JSON。` }
  ], { json: true, maxTokens: 1800 });
  const data = parseJSONFromLLM(content);
  const steps = (data.steps || []).map((s, i) => ({
    title: s.title || `第 ${i + 1} 步`,
    body: s.body || '',
    why: s.why || ''
  }));
  return {
    type: 'llm',
    typeName: data.typeName || '数学题',
    answer: data.answer || '',
    steps,
    similar: [],
    problem,
    mode: 'llm'
  };
}

async function analyzeViaLLM(problem, myWork, level) {
  const content = await llmChat([
    { role: 'system', content: '你是一位擅长诊断学生错误的数学老师。请定位学生错误发生的步骤、错因类型（移项未变号/符号错误/计算失误/概念混淆/方法选择错误等），并给出纠正与建议。输出 JSON：{ "correct": boolean, "title": "错因标题", "errorType": "错因类型", "detail": "详细说明", "suggestion": "改进建议", "correctAnswer": "正确答案", "similar": [{ "problem": "同类题", "answer": "答案" }] }。' },
    { role: 'user', content: `题目：${problem}\n学生的过程/答案：\n${myWork}\n请输出 JSON。` }
  ], { json: true, maxTokens: 1200 });
  const data = parseJSONFromLLM(content);
  return {
    correct: !!data.correct,
    errorType: data.errorType || 'unknown',
    title: data.title || '错因分析',
    detail: data.detail || '',
    suggestion: data.suggestion || '',
    correctAnswer: data.correctAnswer || '',
    similar: [],
    mode: 'llm'
  };
}

/* ---------------- 拍照识题 ---------------- */
const SAMPLE_IMAGES = {};
MockEngine.SAMPLES.forEach((s) => { SAMPLE_IMAGES[s.img] = s.text; });

async function recognize({ image, sampleId, samplePath }) {
  // 1) 示例题：返回内置文本（模拟离线 OCR 效果）
  if (sampleId) {
    const s = MockEngine.SAMPLES.find((x) => x.id === sampleId);
    if (s) return { ok: true, text: s.text, mode: 'sample', source: '示例题' };
  }
  if (samplePath && SAMPLE_IMAGES[samplePath]) {
    return { ok: true, text: SAMPLE_IMAGES[samplePath], mode: 'sample', source: '示例题' };
  }
  // 2) 真实上传 + 已配置 LLM（vision）
  if (image && USE_LLM) {
    try {
      const content = await llmChat([
        { role: 'system', content: '你是一个数学 OCR 引擎。请把图片中的数学题完整、准确地转成纯文本（用 ^ 表示幂，/ 表示分数，保留等号）。只输出题目文本，不要解释。' },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }, { type: 'text', text: '请识别题目。' }] }
      ], { maxTokens: 800 });
      return { ok: true, text: content.trim(), mode: 'llm', source: '大模型视觉识别' };
    } catch (e) {
      return { ok: false, text: '', mode: 'error', message: '识别失败：' + e.message };
    }
  }
  // 3) 未配置 LLM：让用户手动输入（识别入口保留）
  return { ok: false, text: '', mode: 'manual', message: '未配置大模型 API（LLM_API_KEY），无法识别真实图片。可直接输入题目，或选择右侧示例题体验完整流程。' };
}

/* ---------------- 路由 ---------------- */
async function handleAPI(req, res, url) {
  if (url.pathname === '/api/mode') {
    return sendJSON(res, 200, { mode: USE_LLM ? 'llm' : 'mock', llmModel: LLM_MODEL, llmConfigured: USE_LLM, message: USE_LLM ? `已接入大模型：${LLM_MODEL}` : '当前为内置规则引擎模式（离线可跑）；配置 LLM_API_KEY 可切换真实大模型' });
  }
  if (url.pathname === '/api/samples') {
    return sendJSON(res, 200, { samples: MockEngine.SAMPLES });
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

  const body = JSON.parse((await readBody(req)) || '{}');

  if (url.pathname === '/api/recognize') {
    const r = await recognize(body);
    return sendJSON(res, 200, r);
  }

  if (url.pathname === '/api/solve') {
    const problem = String(body.problem || '').trim();
    const level = String(body.level || '标准');
    if (!problem) return sendJSON(res, 400, { error: '题目为空' });
    try {
      if (USE_LLM) {
        try { return sendJSON(res, 200, await solveViaLLM(problem, level)); }
        catch (e) { /* 回退到 mock */ }
      }
      const r = MockEngine.solve(problem);
      r.mode = 'mock';
      r.level = level;
      return sendJSON(res, 200, r);
    } catch (e) {
      return sendJSON(res, 200, { error: e.message, mode: USE_LLM ? 'llm' : 'mock' });
    }
  }

  if (url.pathname === '/api/analyze') {
    const problem = String(body.problem || '').trim();
    const myWork = String(body.myWork || '').trim();
    if (!problem || !myWork) return sendJSON(res, 400, { error: '题目或过程为空' });
    try {
      if (USE_LLM) {
        try { return sendJSON(res, 200, await analyzeViaLLM(problem, myWork, body.level)); }
        catch (e) { /* 回退到 mock */ }
      }
      const r = MockEngine.analyze(problem, myWork);
      r.mode = 'mock';
      return sendJSON(res, 200, r);
    } catch (e) {
      return sendJSON(res, 200, { error: e.message, mode: USE_LLM ? 'llm' : 'mock' });
    }
  }

  sendJSON(res, 404, { error: '接口不存在' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleAPI(req, res, url).catch((e) => sendJSON(res, 500, { error: '服务器错误: ' + e.message }));
    return;
  }
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  AI 数学学习助手 · MVP Demo');
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  模式: ${USE_LLM ? 'LLM (' + LLM_MODEL + ')' : '内置规则引擎（mock）'}`);
  if (!USE_LLM) console.log('  提示: 配置 LLM_API_KEY 可切换为真实大模型讲解');
  console.log('==============================================');
});
