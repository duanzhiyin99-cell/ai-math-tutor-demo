# AI 数学学习助手 · MVP Demo

基于 **LLM API + 网页前端** 的可交互 Demo，实现「拍照识题 → 分步讲解 → 错因分析 → 同类题」完整闭环。

## 一、快速开始（零依赖，离线可跑）

要求：Node.js ≥ 18（自带 `fetch`）。

### 方式 A：macOS 双击启动（推荐）
直接双击 `prototype/start.command`，脚本会自动定位 Node.js、启动服务并打开浏览器。
（若双击提示无法执行，可在终端运行：`chmod +x start.command`，或直接在终端执行 `./start.command`）

### 方式 B：终端启动
```bash
cd prototype
node server.js
# 打开 http://localhost:8080
```

默认使用**内置规则引擎**（mock 模式），无需任何 API Key 即可体验全部功能：

- 📷 **拍照识题**：点击上传区选择/拖拽图片；未配置大模型时自动降级为手动输入，同时提供 6 道示例题（含 SVG 题图，模拟"拍照→识别"效果）；
- 📖 **分步讲解**：完整步骤 + 每步可展开"为什么" + 讲解深度三档（基础/标准/进阶）；
- ❌ **错因分析**：粘贴自己的过程/答案，定位错因（移项未变号/符号错误/计算失误等）并给出纠正；
- 📚 **同类题推荐**：自动生成 2–3 道同类题，点击即可继续讲解（错一练三）。

## 二、接入真实大模型（LLM API）

Demo 兼容 OpenAI Chat Completions 协议，可通过环境变量切换：

```bash
# 方式一：默认 OpenAI
LLM_API_KEY=sk-xxxx node server.js

# 方式二：自定义 Base URL / 模型（如 DeepSeek、智谱、Ollama 等）
LLM_BASE_URL=https://api.deepseek.com/v1 \
LLM_MODEL=deepseek-chat \
LLM_API_KEY=sk-xxxx node server.js
```

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `LLM_API_KEY` | 大模型 API Key；配置后自动启用 LLM 模式 | 空（mock） |
| `LLM_BASE_URL` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 模型名（解题 / 错因分析） | `gpt-4o-mini` |
| `VISION_API_KEY` | 视觉模型 Key（拍照识题用，缺省回退 `LLM_API_KEY`） | 空 |
| `VISION_BASE_URL` | 视觉模型接口地址（缺省回退 `LLM_BASE_URL`） | 空 |
| `VISION_MODEL` | 视觉模型名，如 `glm-4v-flash`、`qwen-vl-plus` | 空 |
| `PORT` | 服务端口 | `8080` |

> **拍照识题**需要支持图片输入的模型。已实测：`deepseek-chat` 可直接识别题目图片，因此默认无需额外配置。若想改用更便宜或更准的专用视觉模型（如智谱 `glm-4v-flash`、通义 `qwen-vl-plus`、OpenAI `gpt-4o-mini`），可单独配置 `VISION_*` 三项，与解题模型混用互不影响；识别失败时会提示手动输入，其他功能不受影响。

### 推荐：使用本地 `.env` 文件（密钥不入库）

在 `prototype/` 下创建 `.env`（已被 `.gitignore` 忽略，不会提交到仓库），服务器启动时会自动读取：

```bash
# prototype/.env
LLM_API_KEY=sk-xxxx
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
```

之后直接 `node server.js` 或双击 `start.command` 即可，无需在命令行重复配置环境变量。

> LLM 模式说明：
> - `/api/solve`、`/api/analyze` 调用大模型生成讲解/错因，返回结构化 JSON；调用失败时自动回退到内置引擎，保证演示不中断。
> - `/api/recognize` 在配置 API Key 后支持真实图片视觉识别（需模型支持图像输入）。

## 三、接口文档

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/mode` | — | `{ mode: "mock"\|"llm", llmModel }` |
| GET | `/api/samples` | — | `{ samples: [{ id, label, text, img }] }` |
| POST | `/api/recognize` | `{ image?: base64, sampleId? }` | `{ ok, text, mode, source? , message? }` |
| POST | `/api/solve` | `{ problem, level }` | `{ typeName, steps:[{title,body,why}], answer, similar }` |
| POST | `/api/analyze` | `{ problem, myWork, level }` | `{ correct, errorType, title, detail, suggestion, correctAnswer, similar }` |

## 四、项目结构

```
prototype/
├── server.js                     # 零依赖 Node 服务（静态 + API + LLM 接入）
├── README.md
├── public/
│   ├── index.html                # 单页前端（高保真原型）
│   ├── css/style.css
│   └── js/
│       ├── app.js                # 前端交互逻辑
│       └── mockEngine.js         # 内置规则引擎（离线解题/错因/同类题）
└── public/assets/sample-problems/   # 示例题 SVG 题图
```

## 五、与文档的对应关系

- 页面与交互流程对应 `docs/04-原型说明/01-原型说明.md` 中的低保真/高保真原型；
- 功能范围对应 PRD（`docs/02-竞品分析与PRD/02-PRD.md`）的 F1 拍照识题 / F2 分步讲解 / F3 错因分析 / F4 同类题 / F5 答案折叠；
- 评估指标（满意度/正确率等）与内测方案见 `docs/03-验证与迭代/`。

## 六、如何让别人通过链接访问（部署）

Demo 是零依赖 Node 服务，已内置 `package.json`（`npm start` = `node server.js`），可部署到任意 Node ≥ 18 的平台。部署时**不要提交 `.env`**，改为在平台上配置环境变量：

| 环境变量 | 说明 | 必须 |
| --- | --- | --- |
| `LLM_API_KEY` | 大模型 Key（如 DeepSeek） | 是 |
| `LLM_BASE_URL` | OpenAI 兼容接口地址 | 是 |
| `LLM_MODEL` | 模型名（如 deepseek-chat） | 是 |
| `PORT` | 端口（多数平台自动注入） | 平台决定 |

> 服务器已默认监听所有网卡（`server.listen(PORT)`），拿到平台分配的 URL 即可访问。

### 方式 A：临时分享（最快，适合演示几小时~几天）
用内网穿透把本机 8080 暴露成公网链接，需要保持终端/软件运行：

```bash
# 任选其一（需先安装）
cloudflared tunnel --url http://localhost:8080     # 免费、无需账号，得到 trycloudflare.com 随机链接
ngrok http 8080                                    # 需要注册一个免费 authtoken
```

### 方式 B：免费云平台长期部署（国内访问推荐 Zeabur，免绑卡）

> Render 新账号需绑定信用卡验证，没有外币卡时可改用 **Zeabur**（免费方案无需绑卡、有中文界面、国内访问 *.zeabur.app 较稳）。仓库根目录已放 `package.json`，任意平台直接以仓库根目录部署即可，无需设置子目录。

**Zeabur 部署步骤：**
1. 打开 zeabur.com 注册（可用 GitHub 账号一键登录），默认 Free 方案，无需绑卡；
2. 新建项目 → 添加服务 → 选择「部署来自 Git 仓库」→ 连接并选择 `ai-math-tutor-demo` 仓库；
3. 服务类型选 Node.js（自动识别根目录 package.json）；
4. 在服务「变量」里添加 3 个环境变量：`LLM_API_KEY`、`LLM_BASE_URL=https://api.deepseek.com`、`LLM_MODEL=deepseek-chat`；
5. 部署完成后得到 `https://xxxx.zeabur.app` 公网链接。

（如仍想用 Render，需准备一张外币信用卡/虚拟卡完成身份验证。）
1. 把项目推到 GitHub（注意 `.env` 已在 `.gitignore`，不会上传）；
2. 在 [render.com](https://render.com) 新建 **Web Service**，连接仓库，目录选 `prototype`；
3. Build Command 留空，Start Command 填 `npm start`，Node 版本选 18+；
4. 在 Environment 里填上表 3 个环境变量；
5. 部署完成后得到 `https://xxxx.onrender.com` 公网链接，分享给别人即可。

### ⚠️ 安全与成本提醒
- 公网部署后，**任何拿到链接的人都能消耗你的大模型额度**。建议：演示结束后关闭服务，或部署时换一个低额度/限流 Key；也可在服务器加简单限流。
- 请勿把 `.env` / Key 提交到 GitHub。
