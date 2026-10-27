/**
 * app.js — AI 数学学习助手 MVP Demo 前端逻辑
 * 流程：拍照/示例题 → 确认题目 → 分步讲解 → 错因分析 → 同类题
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = async (url, body) => {
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return res.json();
  };

  const els = {
    modeBadge: $('modeBadge'),
    dropZone: $('dropZone'),
    fileInput: $('fileInput'),
    dropInner: $('dropInner'),
    imgPreviewWrap: $('imgPreviewWrap'),
    imgPreview: $('imgPreview'),
    removeImg: $('removeImg'),
    sampleChips: $('sampleChips'),
    problemInput: $('problemInput'),
    levelSeg: $('levelSeg'),
    solveBtn: $('solveBtn'),
    inputHint: $('inputHint'),
    resultCard: $('resultCard'),
    typeBadge: $('typeBadge'),
    problemBox: $('problemBox'),
    stepsWrap: $('stepsWrap'),
    answerToggle: $('answerToggle'),
    answerBox: $('answerBox'),
    myWorkInput: $('myWorkInput'),
    analyzeBtn: $('analyzeBtn'),
    analyzeResult: $('analyzeResult'),
    similarWrap: $('similarWrap'),
    similarList: $('similarList'),
    toast: $('toast')
  };

  let currentProblem = '';
  let currentSolution = null;
  let uploadedImage = null; // base64 data url
  let toastTimer = null;

  /* ---------- 工具 ---------- */
  function showToast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms || 2600);
  }
  function hint(msg, type) {
    els.inputHint.textContent = msg || '';
    els.inputHint.className = 'hint' + (type ? ' ' + type : '');
  }
  // 把大模型常见的 LaTeX / Markdown 写法转成干净的纯文本（仅用于展示）
  function formatMath(text) {
    let t = String(text == null ? '' : text);
    t = t.replace(/\\\[|\\\]|\\\(|\\\)|\$\$?/g, '');                       // 去掉 \[ \] \( \) $
    t = t.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)'); // \frac{a}{b} -> (a)/(b)
    t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');                    // \sqrt{x} -> √(x)
    t = t.replace(/\\times/g, '×').replace(/\\cdot/g, '·')
         .replace(/\\div/g, '÷').replace(/\\pm/g, '±')
         .replace(/\\le/g, '≤').replace(/\\ge/g, '≥')
         .replace(/\\neq/g, '≠').replace(/\\Delta/g, 'Δ')
         .replace(/\\pi/g, 'π').replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β');
    t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');    // 去掉 **粗体**
    t = t.replace(/^\s*#{1,6}\s*/gm, '');                                // 去掉 ### 标题
    return t.trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function getLevel() {
    const active = els.levelSeg.querySelector('.seg-btn.active');
    return active ? active.dataset.level : '标准';
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    const mode = await api('/api/mode').catch(() => ({ mode: 'mock' }));
    const badgeText = mode.mode === 'llm' ? '✨ 大模型模式 · ' + (mode.llmModel || '') : '⚙️ 规则引擎（离线）';
    els.modeBadge.textContent = badgeText;
    els.modeBadge.title = mode.message || '';

    // 拍照识题可用性提示
    const dzSub = els.dropZone.querySelector('.dz-sub');
    if (dzSub) {
      if (mode.visionConfigured) {
        dzSub.textContent = '已启用视觉模型：' + mode.visionModel + '（上传图片自动识别题目）';
      } else if (mode.llmConfigured) {
        dzSub.textContent = '上传后用「' + mode.llmModel + '」识别题目，识别结果可手动校对';
      } else {
        dzSub.textContent = '支持 jpg / png / webp ≤ 10MB；离线模式请手动输入题目或选择示例题';
      }
    }

    const data = await api('/api/samples').catch(() => ({ samples: [] }));
    const samples = data.samples || [];
    els.sampleChips.innerHTML = samples.map((s) =>
      '<button class="chip" data-sample="' + s.id + '">' + escapeHtml(s.label) + '</button>'
    ).join('');
    els.sampleChips.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => loadSample(samples.find((s) => s.id === chip.dataset.sample)));
    });
  }

  async function loadSample(sample) {
    if (!sample) return;
    els.problemInput.value = sample.text;
    els.problemInput.focus();
    hint('已载入示例题：' + sample.label + '，可直接开始讲解', 'ok');
    showToast('示例题已载入');
  }

  /* ---------- 拍照上传 ---------- */
  function setupUpload() {
    els.dropZone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files[0];
      if (file) previewFile(file);
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.remove('dragover'); })
    );
    els.dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) previewFile(file);
    });
    els.removeImg.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadedImage = null;
      els.imgPreviewWrap.classList.add('hidden');
      els.dropInner.classList.remove('hidden');
      els.fileInput.value = '';
    });
  }

  // 压缩图片：长边最大 1600px，统一转成 JPEG（解决手机照片过大、HEIC/PNG 格式问题）
  function compressImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1600;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function previewFile(file) {
    if (file.size > 20 * 1024 * 1024) {
      hint('图片超过 20MB，请压缩或换一张再上传', 'error');
      showToast('图片太大，请换一张或先压缩');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      compressImage(String(reader.result)).then((dataUrl) => {
        uploadedImage = dataUrl;
        els.imgPreview.src = dataUrl;
        els.dropInner.classList.add('hidden');
        els.imgPreviewWrap.classList.remove('hidden');
        recognizeImage();
      });
    };
    reader.onerror = () => hint('读取图片失败，请重试', 'error');
    reader.readAsDataURL(file);
  }

  async function recognizeImage() {
    hint('正在识别题目…（大图首次识别可能需要几秒）');
    try {
      const m = (uploadedImage || '').match(/^data:([^;]+);/);
      const mime = m ? m[1] : 'image/jpeg';
      if (mime.indexOf('heic') >= 0 || mime.indexOf('heif') >= 0) {
        hint('当前浏览器无法解码 HEIC 格式。请改用截图上传，或在手机“设置 → 相机 → 格式”中选择“兼容性最佳”（JPEG）', 'error');
        return;
      }
      const b64 = uploadedImage ? uploadedImage.split(',')[1] : '';
      const r = await api('/api/recognize', { image: b64, mime });
      if (r.ok && r.text) {
        els.problemInput.value = r.text;
        hint('识别成功（' + (r.source || '识别') + '），请校对后开始讲解', 'ok');
      } else {
        hint(r.message || r.error || '未能自动识别，请手动输入题目', 'error');
        if (r.mode === 'manual') showToast('未配置 LLM API：请直接输入题目或使用示例题');
        if (r.mode === 'error') showToast('识别失败：可直接输入题目，或换一张更清晰的图片');
      }
    } catch (e) {
      hint('识别请求失败（可能图片过大或网络中断），请压缩后重试，或直接手动输入题目', 'error');
    }
  }

  /* ---------- 讲解深度选择 ---------- */
  els.levelSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    els.levelSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });

  /* ---------- 开始讲解 ---------- */
  els.solveBtn.addEventListener('click', solveCurrent);

  async function solveCurrent() {
    const problem = els.problemInput.value.trim();
    if (!problem) { hint('请先输入或上传题目', 'error'); return; }
    currentProblem = problem;
    currentSolution = null;
    els.analyzeResult.innerHTML = '';
    els.myWorkInput.value = '';
    els.answerBox.classList.add('hidden');
    els.similarWrap.classList.add('hidden');

    els.solveBtn.disabled = true;
    els.solveBtn.textContent = '⏳ 正在生成讲解…';
    hint('正在生成分步讲解…');
    showLoading();

    try {
      const r = await api('/api/solve', { problem, level: getLevel() });
      if (r.error) {
        hint(r.error, 'error');
        renderErrorState(r.error);
        window.scrollTo({ top: els.resultCard.offsetTop - 80, behavior: 'smooth' });
        return;
      }
      currentSolution = r;
      renderSolution(r);
      hint('讲解生成完成', 'ok');
    } catch (e) {
      hint('生成失败，请重试', 'error');
    } finally {
      els.solveBtn.disabled = false;
      els.solveBtn.textContent = '🚀 开始讲解';
    }
  }

  function showLoading() {
    els.resultCard.classList.remove('hidden');
    els.typeBadge.textContent = '生成中…';
    els.problemBox.innerHTML = '<div class="plabel">题目</div>' + escapeHtml(currentProblem);
    els.stepsWrap.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    window.scrollTo({ top: els.resultCard.offsetTop - 80, behavior: 'smooth' });
  }

  function renderErrorState(msg) {
    els.typeBadge.textContent = '未生成解析';
    els.stepsWrap.innerHTML =
      '<div class="err-card wrong">' +
        '<span class="err-type">未生成解析</span>' +
        '<div class="err-detail">' + escapeHtml(msg) + '</div>' +
        '<div class="err-suggest">💡 当前为离线演示模式。可尝试：① 选择上方示例题体验完整流程；② 修改题目格式（如用 ^ 表示幂、x^2 表示平方）；③ 配置 LLM_API_KEY 后即可由真实大模型解答任意题目。</div>' +
      '</div>';
    showToast('未生成解析：当前题型不在离线引擎支持范围');
  }

  /* ---------- 渲染讲解 ---------- */
  function renderSolution(r) {
    els.resultCard.classList.remove('hidden');
    els.typeBadge.textContent = r.typeName || '数学题';
    els.problemBox.innerHTML = '<div class="plabel">题目</div>' + escapeHtml(r.problem || currentProblem);

    const steps = r.steps || [];
    els.stepsWrap.innerHTML = steps.map((s, i) => {
      const bodyHtml = s.body ? '<div class="step-expr">' + escapeHtml(formatMath(s.body)) + '</div>' : '';
      const whyHtml = s.why ? '<div class="step-why" data-why="' + i + '"><span class="why-label">为什么：</span>' + escapeHtml(formatMath(s.why)) + '</div>' : '';
      const btnHtml = s.why ? '<button class="step-why-btn" data-toggle="' + i + '">为什么 ▾</button>' : '';
      return '<div class="step">' +
        '<div class="step-head">' +
          '<div class="step-num">' + (i + 1) + '</div>' +
          '<div class="step-body"><div class="step-title">' + escapeHtml(formatMath(s.title)) + '</div>' + bodyHtml + btnHtml + '</div>' +
        '</div>' + whyHtml + '</div>';
    }).join('');

    // 答案折叠
    if (r.answer) {
      els.answerBox.innerHTML = escapeHtml(formatMath(r.answer));
      els.answerBox.classList.add('hidden');
      els.answerToggle.classList.remove('hidden');
    } else {
      els.answerToggle.classList.add('hidden');
      els.answerBox.classList.add('hidden');
    }

    // 同类题
    if (r.similar && r.similar.length) {
      els.similarList.innerHTML = r.similar.map((s, i) =>
        '<div class="similar-item" data-i="' + i + '">' +
          '<div class="si-problem">' + escapeHtml(formatMath(s.problem)) + '</div>' +
          '<div class="si-answer">' + escapeHtml(formatMath(s.answer || '')) + '</div>' +
          '<span class="si-go">讲解 ›</span>' +
        '</div>'
      ).join('');
      els.similarWrap.classList.remove('hidden');
    } else {
      els.similarWrap.classList.add('hidden');
    }

    // 步骤"为什么"展开
    els.stepsWrap.querySelectorAll('.step-why-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = btn.dataset.toggle;
        const why = els.stepsWrap.querySelector('.step-why[data-why="' + idx + '"]');
        if (why) {
          const isOpen = why.classList.toggle('open');
          btn.textContent = isOpen ? '为什么 ▴' : '为什么 ▾';
        }
      });
    });
  }

  /* ---------- 答案折叠 ---------- */
  els.answerToggle.addEventListener('click', () => {
    const isHidden = els.answerBox.classList.toggle('hidden');
    els.answerToggle.textContent = isHidden ? '💡 展开答案（先自己想一想，再对答案）' : '🙈 收起答案';
  });

  /* ---------- 错因分析 ---------- */
  els.analyzeBtn.addEventListener('click', async () => {
    const myWork = els.myWorkInput.value.trim();
    if (!currentProblem) { showToast('请先生成讲解'); return; }
    if (!myWork) { showToast('请先输入你的过程或答案'); return; }

    els.analyzeBtn.disabled = true;
    els.analyzeBtn.textContent = '⏳ 分析中…';
    els.analyzeResult.innerHTML = '<div class="skeleton" style="height:64px"></div>';
    try {
      const r = await api('/api/analyze', { problem: currentProblem, myWork, level: getLevel() });
      renderAnalyze(r);
    } catch (e) {
      els.analyzeResult.innerHTML = '<div class="hint error">分析失败，请重试</div>';
    } finally {
      els.analyzeBtn.disabled = false;
      els.analyzeBtn.textContent = '🔍 分析错因';
    }
  });

  function renderAnalyze(r) {
    if (r.error) {
      els.analyzeResult.innerHTML = '<div class="hint error">' + escapeHtml(r.error) + '</div>';
      return;
    }
    const cls = r.correct ? 'right' : 'wrong';
    const title = r.title || '错因分析';
    let html = '<div class="err-card ' + cls + '">';
    html += '<span class="err-type">' + escapeHtml(title) + '</span>';
    html += '<div class="err-detail">' + escapeHtml(formatMath(r.detail || '')) + '</div>';
    if (r.correctAnswer) html += '<div class="err-answer">✅ 正确答案：' + escapeHtml(formatMath(r.correctAnswer)) + '</div>';
    if (r.suggestion) html += '<div class="err-suggest">💡 建议：' + escapeHtml(formatMath(r.suggestion)) + '</div>';
    html += '</div>';
    els.analyzeResult.innerHTML = html;

    // 若返回了同类题，渲染到同类题区
    if (r.similar && r.similar.length) {
      els.similarList.innerHTML = r.similar.map((s, i) =>
        '<div class="similar-item" data-i="' + i + '">' +
          '<div class="si-problem">' + escapeHtml(formatMath(s.problem)) + '</div>' +
          '<div class="si-answer">' + escapeHtml(formatMath(s.answer || '')) + '</div>' +
          '<span class="si-go">讲解 ›</span>' +
        '</div>'
      ).join('');
      els.similarWrap.classList.remove('hidden');
    }
  }

  /* ---------- 同类题点击 → 重新讲解 ---------- */
  els.similarList.addEventListener('click', (e) => {
    const item = e.target.closest('.similar-item');
    if (!item || !currentSolution || !currentSolution.similar) return;
    const s = currentSolution.similar[Number(item.dataset.i)];
    if (!s) return;
    els.problemInput.value = s.problem;
    els.myWorkInput.value = '';
    els.analyzeResult.innerHTML = '';
    showToast('已加载同类题，正在讲解…');
    solveCurrent();
  });

  /* ---------- 启动 ---------- */
  setupUpload();
  init();
})();
