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

  function previewFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      uploadedImage = String(reader.result);
      els.imgPreview.src = uploadedImage;
      els.dropInner.classList.add('hidden');
      els.imgPreviewWrap.classList.remove('hidden');
      recognizeImage();
    };
    reader.readAsDataURL(file);
  }

  async function recognizeImage() {
    hint('正在识别题目…');
    try {
      // 传 base64（dataUrl），服务端只取逗号后的部分
      const b64 = uploadedImage ? uploadedImage.split(',')[1] : '';
      const r = await api('/api/recognize', { image: b64 });
      if (r.ok && r.text) {
        els.problemInput.value = r.text;
        hint('识别成功（' + (r.source || '识别') + '），请校对后开始讲解', 'ok');
      } else {
        hint(r.message || '未能自动识别，请手动输入题目', 'error');
        if (r.mode === 'manual') showToast('未配置 LLM API：请直接输入题目或使用示例题');
      }
    } catch (e) {
      hint('识别失败，请手动输入题目', 'error');
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
      const bodyHtml = s.body ? '<div class="step-expr">' + escapeHtml(s.body) + '</div>' : '';
      const whyHtml = s.why ? '<div class="step-why" data-why="' + i + '"><span class="why-label">为什么：</span>' + escapeHtml(s.why) + '</div>' : '';
      const btnHtml = s.why ? '<button class="step-why-btn" data-toggle="' + i + '">为什么 ▾</button>' : '';
      return '<div class="step">' +
        '<div class="step-head">' +
          '<div class="step-num">' + (i + 1) + '</div>' +
          '<div class="step-body"><div class="step-title">' + escapeHtml(s.title) + '</div>' + bodyHtml + btnHtml + '</div>' +
        '</div>' + whyHtml + '</div>';
    }).join('');

    // 答案折叠
    if (r.answer) {
      els.answerBox.innerHTML = escapeHtml(r.answer);
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
          '<div class="si-problem">' + escapeHtml(s.problem) + '</div>' +
          '<div class="si-answer">' + escapeHtml(s.answer || '') + '</div>' +
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
    html += '<div class="err-detail">' + escapeHtml(r.detail || '') + '</div>';
    if (r.correctAnswer) html += '<div class="err-answer">✅ 正确答案：' + escapeHtml(r.correctAnswer) + '</div>';
    if (r.suggestion) html += '<div class="err-suggest">💡 建议：' + escapeHtml(r.suggestion) + '</div>';
    html += '</div>';
    els.analyzeResult.innerHTML = html;

    // 若返回了同类题，渲染到同类题区
    if (r.similar && r.similar.length) {
      els.similarList.innerHTML = r.similar.map((s, i) =>
        '<div class="similar-item" data-i="' + i + '">' +
          '<div class="si-problem">' + escapeHtml(s.problem) + '</div>' +
          '<div class="si-answer">' + escapeHtml(s.answer || '') + '</div>' +
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
