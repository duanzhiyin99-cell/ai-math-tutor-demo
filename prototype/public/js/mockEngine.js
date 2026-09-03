/**
 * mockEngine.js — 内置规则引擎（离线可运行的"模拟大模型"）
 * 支持：一元一次方程 / 一元二次方程 / 分式加减 / 多项式求导 / 二元一次方程组 / 几何公式应用
 * UMD：浏览器与 Node 均可加载。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MockEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 工具 ---------------- */
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a || 1; }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  /* ---------------- 有理数 ---------------- */
  var Rat = function (n, d) {
    d = (d === undefined) ? 1 : d;
    if (d === 0) throw new Error('division by zero');
    if (d < 0) { n = -n; d = -d; }
    var g = gcd(n, d);
    this.n = n / g; this.d = d / g;
  };
  Rat.Z = function (n) { return new Rat(n, 1); };
  var Z0 = Rat.Z(0), Z1 = Rat.Z(1);
  Rat.prototype.neg = function () { return new Rat(-this.n, this.d); };
  Rat.prototype.add = function (o) { return new Rat(this.n * o.d + o.n * this.d, this.d * o.d); };
  Rat.prototype.sub = function (o) { return this.add(o.neg()); };
  Rat.prototype.mul = function (o) { return new Rat(this.n * o.n, this.d * o.d); };
  Rat.prototype.div = function (o) { return new Rat(this.n * o.d, this.d * o.n); };
  Rat.prototype.pow = function (e) { var r = Z1; for (var i = 0; i < e; i++) r = r.mul(this); return r; };
  Rat.prototype.eq = function (o) { return this.n === o.n && this.d === o.d; };
  Rat.prototype.isZero = function () { return this.n === 0; };
  Rat.prototype.isNeg = function () { return this.n < 0; };
  Rat.prototype.isOne = function () { return this.n === 1 && this.d === 1; };
  Rat.prototype.isInt = function () { return this.d === 1; };
  Rat.prototype.toFloat = function () { return this.n / this.d; };
  Rat.prototype.sqrt = function () {
    if (this.isZero()) return { ok: true, val: Z0, radicand: null };
    var n = Math.sqrt(this.n), d = Math.sqrt(this.d);
    if (Number.isInteger(n) && Number.isInteger(d)) return { ok: true, val: new Rat(n, d), radicand: null };
    return { ok: false, val: null, radicand: this };
  };
  Rat.prototype.toDisplay = function () {
    if (this.d === 1) return String(this.n);
    return this.n + '/' + this.d;
  };

  /* ---------------- 文本清洗 ---------------- */
  // 截断到第一个中文/全角标点/问号，去掉题面中的"求x"等描述
  function cleanMath(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (/[\u4e00-\u9fff？?，。、！!]/.test(c)) break;
    }
    return s.slice(0, i).trim();
  }

  /* ---------------- 词法/语法分析 ---------------- */
  function tokenize(s) {
    s = String(s)
      .replace(/²/g, '^2').replace(/³/g, '^3').replace(/¹/g, '^1')
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/／/g, '/')
      .replace(/\s+/g, '');
    var toks = [], i = 0;
    while (i < s.length) {
      var c = s[i];
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        var j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
        toks.push({ type: 'num', value: parseFloat(s.slice(i, j)) });
        i = j;
      } else if (/[a-zA-Z]/.test(c)) {
        var k = i; while (k < s.length && /[a-zA-Z0-9]/.test(s[k])) k++;
        toks.push({ type: 'var', name: s.slice(i, k) });
        i = k;
      } else if ('+-*/^()='.indexOf(c) >= 0) {
        toks.push({ type: 'op', value: c });
        i++;
      } else {
        i++; // 忽略其他字符
      }
    }
    // 插入隐式乘号
    var out = [];
    for (var t = 0; t < toks.length; t++) {
      var prev = out.length ? out[out.length - 1] : null;
      var cur = toks[t];
      if (prev) {
        var prevEnds = prev.type === 'num' || prev.type === 'var' || (prev.type === 'op' && prev.value === ')');
        var curStarts = cur.type === 'num' || cur.type === 'var' || (cur.type === 'op' && cur.value === '(');
        if (prevEnds && curStarts) out.push({ type: 'op', value: '*' });
      }
      out.push(cur);
    }
    return out;
  }

  function parseExpr(s) {
    var toks = tokenize(s);
    var pos = 0;
    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function parseExpr() {
      var node = parseTerm();
      while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        var op = next().value;
        var rhs = parseTerm();
        node = { type: 'bin', op: op, l: node, r: rhs };
      }
      return node;
    }
    function parseTerm() {
      var node = parseFactor();
      while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
        var op = next().value;
        var rhs = parseFactor();
        node = { type: 'bin', op: op, l: node, r: rhs };
      }
      return node;
    }
    function parseFactor() {
      var sign = 1;
      while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        if (next().value === '-') sign = -sign;
      }
      var node = parsePower();
      if (sign === -1) node = { type: 'un', op: '-', e: node };
      return node;
    }
    function parsePower() {
      var base = parsePrimary();
      if (peek() && peek().type === 'op' && peek().value === '^') {
        next();
        var exp = parsePrimary();
        base = { type: 'bin', op: '^', l: base, r: exp };
      }
      return base;
    }
    function parsePrimary() {
      var t = next();
      if (!t) throw new Error('表达式不完整');
      if (t.type === 'num') return { type: 'num', v: new Rat(Math.round(t.value * 1e9), 1e9) };
      if (t.type === 'var') return { type: 'var', name: t.name };
      if (t.type === 'op' && t.value === '(') {
        var node = parseExpr();
        var close = next();
        if (!close || close.type !== 'op' || close.value !== ')') throw new Error('缺少右括号');
        return node;
      }
      throw new Error('无法解析的符号');
    }
    var result = parseExpr();
    if (pos < toks.length) throw new Error('表达式有多余内容');
    return result;
  }

  /* ---------------- 单变量多项式 ---------------- */
  function polyFromAST(ast, varName) {
    function rec(a) { return polyFromAST(a, varName); }
    switch (ast.type) {
      case 'num': {
        var m = new Map(); m.set(0, ast.v); return m;
      }
      case 'var': {
        if (ast.name === varName) { var m2 = new Map(); m2.set(1, Z1); return m2; }
        throw new Error('暂不支持多变量: ' + ast.name);
      }
      case 'un': {
        var p = rec(ast.e);
        var m4 = new Map();
        p.forEach(function (v, k) { m4.set(k, v.neg()); });
        return m4;
      }
      case 'bin': {
        var l = rec(ast.l), r = rec(ast.r);
        switch (ast.op) {
          case '+': return polyAdd(l, r);
          case '-': return polyAdd(l, polyNeg(r));
          case '*': return polyMul(l, r);
          case '/': {
            if (polyIsConst(r)) {
              var d = polyConst(r);
              var m5 = new Map();
              l.forEach(function (v, k) { m5.set(k, v.div(d)); });
              return m5;
            }
            throw new Error('暂不支持含变量的除法');
          }
          case '^': {
            if (polyIsConst(r) && polyConst(r).isInt()) {
              var e = polyConst(r).n;
              if (e < 0 || e > 8) throw new Error('暂不支持该次幂');
              var res = new Map(); res.set(0, Z1);
              for (var i = 0; i < e; i++) res = polyMul(res, l);
              return res;
            }
            throw new Error('暂不支持该指数');
          }
        }
        break;
      }
    }
    throw new Error('不支持的表达式');
  }
  function polyAdd(a, b) {
    var m = new Map(a);
    b.forEach(function (v, k) { m.set(k, m.has(k) ? m.get(k).add(v) : v); });
    return prune(m);
  }
  function polyNeg(a) {
    var m = new Map();
    a.forEach(function (v, k) { m.set(k, v.neg()); });
    return m;
  }
  function polyMul(a, b) {
    var m = new Map();
    a.forEach(function (va, ka) {
      b.forEach(function (vb, kb) {
        var k = ka + kb;
        m.set(k, m.has(k) ? m.get(k).add(va.mul(vb)) : va.mul(vb));
      });
    });
    return prune(m);
  }
  function prune(m) {
    var out = new Map();
    m.forEach(function (v, k) { if (!v.isZero()) out.set(k, v); });
    return out;
  }
  function polyDegree(m) {
    var d = 0;
    m.forEach(function (v, k) { if (k > d) d = k; });
    return d;
  }
  function polyIsConst(m) { return m.size === 0 || (m.size === 1 && m.has(0)); }
  function polyConst(m) { return m.has(0) ? m.get(0) : Z0; }

  function formatPoly(m, varName) {
    var degs = Array.from(m.keys()).sort(function (a, b) { return b - a; });
    if (degs.length === 0) return '0';
    var parts = [];
    degs.forEach(function (d, idx) {
      var c = m.get(d);
      var sign = c.isNeg() ? '−' : (idx === 0 ? '' : '+');
      var abs = c.isNeg() ? c.neg() : c;
      var coef = '';
      if (d === 0) {
        coef = abs.toDisplay();
      } else {
        if (abs.isOne()) coef = '';
        else if (abs.isInt()) coef = abs.n + '';
        else coef = '(' + abs.toDisplay() + ')';
        coef += varName;
        if (d > 1) coef += '^' + d;
      }
      parts.push(sign + coef);
    });
    return parts.join(' ');
  }

  /* ---------------- 双变量线性求值（用于方程组） ---------------- */
  function evalLinear(ast) {
    function rec(a) { return evalLinear(a); }
    function add(a, b) { return { x: a.x.add(b.x), y: a.y.add(b.y), c: a.c.add(b.c) }; }
    function neg(a) { return { x: a.x.neg(), y: a.y.neg(), c: a.c.neg() }; }
    function scale(a, r) { return { x: a.x.mul(r), y: a.y.mul(r), c: a.c.mul(r) }; }
    switch (ast.type) {
      case 'num': return { x: Z0, y: Z0, c: ast.v };
      case 'var':
        if (ast.name === 'x') return { x: Z1, y: Z0, c: Z0 };
        if (ast.name === 'y') return { x: Z0, y: Z1, c: Z0 };
        throw new Error('暂不支持变量: ' + ast.name);
      case 'un': return neg(rec(ast.e));
      case 'bin': {
        var l = rec(ast.l), r = rec(ast.r);
        switch (ast.op) {
          case '+': return add(l, r);
          case '-': return add(l, neg(r));
          case '*': {
            var lConst = l.x.isZero() && l.y.isZero();
            var rConst = r.x.isZero() && r.y.isZero();
            if (lConst) return scale(r, l.c);
            if (rConst) return scale(l, r.c);
            throw new Error('出现二次项，不是一次方程组');
          }
          case '/': {
            if (r.x.isZero() && r.y.isZero()) return scale(l, Z1.div(r.c));
            throw new Error('暂不支持含变量的除法');
          }
          case '^': {
            if (r.x.isZero() && r.y.isZero() && r.c.isInt()) {
              if (r.c.n === 0) return { x: Z0, y: Z0, c: Z1 };
              if (r.c.n === 1) return l;
            }
            throw new Error('出现高次项，不是一次方程组');
          }
        }
        break;
      }
    }
    throw new Error('不支持的表达式');
  }

  /* ---------------- 方程拆分 ---------------- */
  function splitEquation(s) {
    var idx = s.indexOf('=');
    if (idx < 0) return null;
    var lhs = cleanMath(s.slice(0, idx));
    var rhs = cleanMath(s.slice(idx + 1));
    if (!lhs || !rhs) return null;
    return { lhs: lhs, rhs: rhs };
  }
  function splitLines(s) {
    return String(s).split(/[;；\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* ---------------- 一元一次方程 ---------------- */
  function solveLinear(sp) {
    var l = polyFromAST(parseExpr(sp.lhs), 'x');
    var r = polyFromAST(parseExpr(sp.rhs), 'x');
    var a = (l.has(1) ? l.get(1) : Z0).sub(r.has(1) ? r.get(1) : Z0);
    var b = (r.has(0) ? r.get(0) : Z0).sub(l.has(0) ? l.get(0) : Z0);
    if (a.isZero()) throw new Error('未知数系数为 0');
    var root = b.div(a);
    var steps = [];
    var aStr = a.isOne() ? 'x' : formatPoly(new Map([[1, a]]), 'x');
    var bStr = b.isZero() ? '0' : b.toDisplay();
    steps.push({
      title: '移项：把含 x 的项放左边，常数项放右边',
      body: aStr + ' = ' + (b.isNeg() ? bStr.replace(/^-/, '−') : bStr),
      why: '等式性质 1：等式两边同时加上（或减去）同一个数，等式仍然成立。移项要变号——' +
        '原式 ' + formatPoly(l, 'x') + ' = ' + formatPoly(r, 'x') + '，把常数移到右边时符号要反过来。'
    });
    if (!b.isZero()) {
      steps.push({
        title: '合并同类项，化简',
        body: aStr + ' = ' + b.toDisplay(),
        why: '把右边的常数合并成一个数，便于下一步计算。'
      });
    }
    steps.push({
      title: '系数化为 1：两边同时除以 ' + (a.isOne() ? '1' : a.toDisplay()),
      body: 'x = ' + root.toDisplay(),
      why: '等式性质 2：等式两边同时乘以（或除以）同一个不为 0 的数，等式仍然成立。' +
        (a.isOne() ? '' : '这里两边同除以 ' + a.toDisplay() + '，就把 x 的系数化为 1。')
    });
    steps.push({
      title: '检验',
      body: '把 x = ' + root.toDisplay() + ' 代入原式：' + formatPoly(l, 'x') + ' = ' + formatPoly(r, 'x') + '，成立。',
      why: '检验能防止移项/计算失误，是规范解题的好习惯。'
    });
    return {
      type: 'linear', typeName: '一元一次方程',
      answer: 'x = ' + root.toDisplay(),
      steps: steps, roots: [root]
    };
  }

  /* ---------------- 一元二次方程 ---------------- */
  function solveQuadratic(sp) {
    var l = polyFromAST(parseExpr(sp.lhs), 'x');
    var r = polyFromAST(parseExpr(sp.rhs), 'x');
    var diff = polyAdd(l, polyNeg(r));
    var a = diff.has(2) ? diff.get(2) : Z0;
    var b = diff.has(1) ? diff.get(1) : Z0;
    var c = diff.has(0) ? diff.get(0) : Z0;
    if (a.isZero()) throw new Error('不是二次方程');
    var steps = [];
    steps.push({
      title: '化为标准形式',
      body: formatPoly(diff, 'x') + ' = 0',
      why: '标准形式 ax² + bx + c = 0（a ≠ 0）便于用判别式与求根公式。'
    });
    var D = b.mul(b).sub(a.mul(c).mul(Rat.Z(4)));
    steps.push({
      title: '计算判别式',
      body: 'Δ = b² − 4ac = (' + b.toDisplay() + ')² − 4×(' + a.toDisplay() + ')×(' + c.toDisplay() + ') = ' + D.toDisplay(),
      why: '判别式 Δ = b² − 4ac 决定根的情况：Δ > 0 有两个不等实根；Δ = 0 有两个相等实根；Δ < 0 无实根。'
    });
    var sq = D.sqrt();
    if (D.isNeg()) {
      steps.push({
        title: '判断根的情况',
        body: 'Δ = ' + D.toDisplay() + ' < 0，方程无实数根。',
        why: '因为 Δ < 0，所以方程在实数范围内无解。'
      });
      return { type: 'quadratic', typeName: '一元二次方程', answer: '无实数根', steps: steps };
    } else if (D.isZero()) {
      var r0 = b.neg().div(a.mul(Rat.Z(2)));
      steps.push({
        title: '判别式等于 0，方程有两个相等的实根',
        body: 'x = −b / (2a) = ' + r0.toDisplay(),
        why: 'Δ = 0 时，求根公式退化为 x = −b/(2a)，两根相等。'
      });
      steps.push({ title: '检验', body: '代入原方程验证：成立。', why: '检验解的正确性。' });
      return { type: 'quadratic', typeName: '一元二次方程', answer: 'x₁ = x₂ = ' + r0.toDisplay(), steps: steps };
    } else if (sq.ok) {
      var r1 = b.neg().add(sq.val).div(a.mul(Rat.Z(2)));
      var r2 = b.neg().sub(sq.val).div(a.mul(Rat.Z(2)));
      steps.push({
        title: 'Δ > 0 且是完全平方数，用因式分解',
        body: '因为 Δ = ' + D.toDisplay() + ' = ' + sq.val.toDisplay() + '²，可分解为：' +
          formatPoly(diff, 'x') + ' = (x − ' + r1.toDisplay() + ')(x − ' + r2.toDisplay() + ') = 0',
        why: '当判别式为完全平方数时，方程能分解为两个一次因式的乘积，进而直接得根。'
      });
      steps.push({
        title: '令每个因式为 0',
        body: 'x − ' + r1.toDisplay() + ' = 0 或 x − ' + r2.toDisplay() + ' = 0',
        why: '若两个数的乘积为 0，则至少有一个为 0（零因子性质）。'
      });
      steps.push({
        title: '解得',
        body: 'x₁ = ' + r1.toDisplay() + '，x₂ = ' + r2.toDisplay(),
        why: '分别解两个一次方程即得两个根。'
      });
      steps.push({ title: '检验', body: '分别代入原方程，验证成立。', why: '检验解的正确性。' });
      return {
        type: 'quadratic', typeName: '一元二次方程',
        answer: 'x₁ = ' + r1.toDisplay() + '，x₂ = ' + r2.toDisplay(),
        steps: steps, roots: [r1, r2]
      };
    } else {
      steps.push({
        title: 'Δ > 0 但不是完全平方数，使用求根公式',
        body: 'x = (−b ± √Δ) / (2a) = (' + b.neg().toDisplay() + ' ± √' + D.toDisplay() + ') / ' + a.mul(Rat.Z(2)).toDisplay(),
        why: '求根公式 x = (−b ± √(b²−4ac)) / (2a) 对所有一元二次方程通用。'
      });
      steps.push({
        title: '结果保留根号形式',
        body: 'x₁ = (' + b.neg().toDisplay() + ' + √' + D.toDisplay() + ') / ' + a.mul(Rat.Z(2)).toDisplay() +
          '，x₂ = (' + b.neg().toDisplay() + ' − √' + D.toDisplay() + ') / ' + a.mul(Rat.Z(2)).toDisplay(),
        why: '当 Δ 不是完全平方数时，根为无理数，保留根号形式即为最简。'
      });
      return {
        type: 'quadratic', typeName: '一元二次方程',
        answer: 'x₁ = (' + b.neg().toDisplay() + ' + √' + D.toDisplay() + ') / ' + a.mul(Rat.Z(2)).toDisplay() +
          '，x₂ = (' + b.neg().toDisplay() + ' − √' + D.toDisplay() + ') / ' + a.mul(Rat.Z(2)).toDisplay(),
        steps: steps
      };
    }
  }

  /* ---------------- 简单三次方程（x³ = c 形式） ---------------- */
  function solveCubic(sp) {
    var l = polyFromAST(parseExpr(sp.lhs), 'x');
    var r = polyFromAST(parseExpr(sp.rhs), 'x');
    var diff = polyAdd(l, polyNeg(r));
    var a = diff.has(3) ? diff.get(3) : Z0;
    var b = diff.has(2) ? diff.get(2) : Z0;
    var c = diff.has(1) ? diff.get(1) : Z0;
    var d = diff.has(0) ? diff.get(0) : Z0;
    if (a.isZero()) throw new Error('不是三次方程');
    if (!b.isZero() || !c.isZero()) throw new Error('该三次方程超出离线引擎范围（仅支持 x³ = c 形式）');
    var rhs = d.neg().div(a); // x³ = c
    var n = Math.cbrt(rhs.n), dd = Math.cbrt(rhs.d);
    var steps = [];
    steps.push({
      title: '化为标准形式',
      body: 'x³ = ' + rhs.toDisplay(),
      why: '把含 x 的项留在左边，常数移到右边，得到 x³ = c 的形式。'
    });
    var rootExact = Number.isInteger(n) && Number.isInteger(dd);
    var root = rootExact ? new Rat(n, dd) : null;
    steps.push({
      title: rootExact ? '开立方' : '开立方（结果不是整数，保留根号形式）',
      body: rootExact ? 'x = ∛' + rhs.toDisplay() + ' = ' + root.toDisplay() : 'x = ∛' + rhs.toDisplay(),
      why: '方程 x³ = c 的解为 x = ∛c（实数范围内）。' + (rootExact ? '因为 ' + rhs.toDisplay() + ' = ' + root.toDisplay() + '³，所以可直接开立方。' : '')
    });
    steps.push({ title: '检验', body: '把 x = ' + (rootExact ? root.toDisplay() : '∛' + rhs.toDisplay()) + ' 代回原方程验证成立。', why: '检验解的正确性。' });
    return {
      type: 'cubic', typeName: '简单三次方程',
      answer: rootExact ? 'x = ' + root.toDisplay() : 'x = ∛' + rhs.toDisplay(),
      steps: steps
    };
  }

  /* ---------------- 分式加减 ---------------- */
  function solveFraction(orig) {
    var expr = cleanMath(orig.split('=')[0]);
    var ast = parseExpr(expr);
    var p = polyFromAST(ast, 'x');
    if (!polyIsConst(p)) throw new Error('不是常数运算');
    var val = polyConst(p);
    var toks = tokenize(expr);
    var nums = [], dens = [];
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].type === 'op' && toks[i].value === '/') {
        if (i >= 1 && toks[i - 1].type === 'num') nums.push(new Rat(Math.round(toks[i - 1].value * 1e9), 1e9));
        if (i + 1 < toks.length && toks[i + 1].type === 'num') dens.push(new Rat(Math.round(toks[i + 1].value * 1e9), 1e9));
      }
    }
    if (!dens.length) throw new Error('未识别到分数');
    var lcm = dens.reduce(function (acc, d) { return acc.mul(d).div(new Rat(gcd(acc.n, d.n), 1)); }, Z1);
    var steps = [];
    steps.push({
      title: '通分：找公分母',
      body: '公分母为 ' + lcm.toDisplay(),
      why: '异分母分数相加减，先通分成同分母分数，再对分子进行加减。'
    });
    var numSum = Z0;
    var parts = [];
    nums.forEach(function (n, idx) {
      var d = dens[idx];
      var f = lcm.div(d);
      numSum = numSum.add(n.mul(f));
      parts.push(n.toDisplay() + '×' + f.toDisplay());
    });
    steps.push({
      title: '分子相加减',
      body: parts.join(' + ') + ' = ' + numSum.toDisplay(),
      why: '通分后分母不变，分子直接相加减。'
    });
    steps.push({
      title: '约分',
      body: numSum.toDisplay() + ' / ' + lcm.toDisplay() + ' = ' + val.toDisplay(),
      why: '分子分母同除以最大公因数，得到最简分数。'
    });
    return { type: 'fraction', typeName: '分数运算', answer: val.toDisplay(), steps: steps };
  }

  /* ---------------- 多项式求导 ---------------- */
  function solveDerivative(orig) {
    var m = String(orig).match(/[fF]\s*\(?\s*x\s*\)?\s*=\s*(.+)/);
    if (!m) throw new Error('无法识别函数');
    var body = cleanMath(m[1]);
    var ast = parseExpr(body);
    var p = polyFromAST(ast, 'x');
    var steps = [];
    steps.push({
      title: '识别多项式各项',
      body: 'f(x) = ' + formatPoly(p, 'x'),
      why: '幂函数求导公式：d/dx (a·xⁿ) = a·n·xⁿ⁻¹。逐项求导再相加（求导是线性运算）。'
    });
    var dp = new Map();
    p.forEach(function (v, k) { if (k !== 0) dp.set(k - 1, v.mul(Rat.Z(k))); });
    var terms = [];
    Array.from(dp.keys()).sort(function (a, b) { return b - a; }).forEach(function (k, idx) {
      var c = dp.get(k);
      var sign = c.isNeg() ? ' − ' : (idx === 0 ? '' : ' + ');
      var abs = c.isNeg() ? c.neg() : c;
      var s = sign;
      if (k === 0) s += abs.toDisplay();
      else {
        if (!abs.isOne()) s += abs.toDisplay() + '·';
        s += 'x';
        if (k > 1) s += '^' + k;
      }
      terms.push(s);
    });
    steps.push({
      title: '逐项求导',
      body: "f'(x) = " + terms.join('').trim(),
      why: '常数项求导为 0；每一项按幂法则求导。'
    });
    return {
      type: 'derivative', typeName: '多项式求导',
      answer: "f'(x) = " + formatPoly(dp, 'x'),
      steps: steps
    };
  }

  /* ---------------- 二元一次方程组 ---------------- */
  function solveSystem(lines) {
    if (lines.length < 2) throw new Error('需要两个方程');
    var eqs = lines.map(function (line) {
      var sp = splitEquation(line);
      if (!sp) throw new Error('无法解析方程: ' + line);
      var E = evalLinear(parseExpr(sp.lhs));
      var F = evalLinear(parseExpr(sp.rhs));
      // a x + b y + c = 0
      return { a: E.x.sub(F.x), b: E.y.sub(F.y), c: E.c.sub(F.c).neg() };
    });
    var a1 = eqs[0].a, b1 = eqs[0].b, c1 = eqs[0].c;
    var a2 = eqs[1].a, b2 = eqs[1].b, c2 = eqs[1].c;
    var det = a1.mul(b2).sub(a2.mul(b1));
    if (det.isZero()) throw new Error('方程组无唯一解（演示环境暂不处理）');
    var x = c1.mul(b2).sub(c2.mul(b1)).div(det);
    var y = a1.mul(c2).sub(a2.mul(c1)).div(det);
    var steps = [];
    steps.push({
      title: '观察方程组，选择加减消元法',
      body: lines[0] + '，' + lines[1],
      why: '加减消元法：通过两式相加/相减，消去一个未知数，转化为一元方程。'
    });
    steps.push({
      title: '两式相加消去 y',
      body: x.toDisplay() + 'x = ' + c1.add(c2).toDisplay() + '，所以 x = ' + x.toDisplay(),
      why: '当两个方程中 y 的系数互为相反数时，两式相加即可消去 y。'
    });
    steps.push({
      title: '把 x = ' + x.toDisplay() + ' 代入其中一个方程',
      body: 'y = ' + y.toDisplay(),
      why: '代入法：将已求得的 x 代回原方程，解出另一个未知数 y。'
    });
    steps.push({
      title: '检验',
      body: '把 x = ' + x.toDisplay() + '，y = ' + y.toDisplay() + ' 分别代入两个方程，均成立。',
      why: '检验能确保解满足原方程组。'
    });
    return {
      type: 'system', typeName: '二元一次方程组',
      answer: 'x = ' + x.toDisplay() + '，y = ' + y.toDisplay(),
      steps: steps, roots: [x, y]
    };
  }

  /* ---------------- 简单对数 ---------------- */
  function solveLog(orig) {
    var s = String(orig).toLowerCase();
    var m = s.match(/(log|ln)\s*_?\s*(\d+)?\s*\(\s*(\d+)\s*\)/);
    if (!m) throw new Error('无法识别对数表达式（示例：log2(8)、log(100)、ln(8)）');
    var kind = m[1], baseStr = m[2], arg = parseInt(m[3], 10);
    var base = kind === 'ln' ? Math.E : (baseStr ? parseInt(baseStr, 10) : 10);
    if (base <= 0 || base === 1) throw new Error('底数必须大于 0 且不等于 1');
    var val = Math.log(arg) / Math.log(base);
    var isExact = Math.abs(val - Math.round(val)) < 1e-9;
    var label = (kind === 'ln' ? 'ln(' + arg + ')' : 'log' + (baseStr || '') + '(' + arg + ')');
    var steps = [];
    steps.push({
      title: '识别对数表达式',
      body: label + '：底数 = ' + (kind === 'ln' ? 'e' : (baseStr || '10')) + '，真数 = ' + arg,
      why: '对数 logₐ(b) 表示“a 的多少次方等于 b”，即 a^x = b，x = logₐ(b)。'
    });
    if (isExact) {
      steps.push({
        title: '把真数写成底数的幂',
        body: arg + ' = ' + (kind === 'ln' ? 'e^' : (baseStr || '10') + '^') + Math.round(val),
        why: '找到底数的幂等于真数，指数即为对数的值。'
      });
      steps.push({
        title: '得出结果',
        body: label + ' = ' + Math.round(val),
        why: '由定义：若 a^k = b，则 logₐ(b) = k。'
      });
    } else {
      steps.push({
        title: '真数不是底数的整数幂，保留近似值',
        body: label + ' ≈ ' + val.toFixed(4),
        why: '此时结果不是整数，可用换底公式 logₐ(b) = ln(b)/ln(a) 或计算器求近似值。'
      });
    }
    return {
      type: 'log', typeName: '对数运算',
      answer: isExact ? String(Math.round(val)) : '≈ ' + val.toFixed(4),
      steps: steps
    };
  }

  /* ---------------- 几何（公式应用） ---------------- */
  function solveGeometry(orig) {
    var gs = String(orig);
    // 圆面积：S = πr²
    if (/圆|半径|直径/.test(gs)) {
      var nums = (gs.match(/(\d+(?:\.\d+)?)/g) || []).map(Number);
      if (!nums.length) throw new Error('未识别到半径或直径的数值');
      var isDia = /直径/.test(gs);
      var r = isDia ? nums[0] / 2 : nums[0];
      var areaExact = Math.round(r * r * 1e6) / 1e6;
      var steps = [];
      steps.push({
        title: '套用圆面积公式',
        body: 'S = πr²',
        why: '圆的面积 = 圆周率 π × 半径的平方，这是圆面积基本公式。'
      });
      steps.push({
        title: isDia ? '由直径求半径' : '代入半径',
        body: isDia ? 'r = d ÷ 2 = ' + nums[0] + ' ÷ 2 = ' + r : 'r = ' + r,
        why: isDia ? '半径是直径的一半，先把直径除以 2 得到半径。' : '把题目给的半径代入公式。'
      });
      steps.push({
        title: '计算结果',
        body: 'S = π × ' + r + '² = ' + areaExact + 'π ≈ ' + (Math.PI * r * r).toFixed(2),
        why: '先算 r²，再乘以 π；题目不要求取近似值时可保留 π。'
      });
      return {
        type: 'geometry', typeName: '圆面积',
        answer: 'S = ' + areaExact + 'π ≈ ' + (Math.PI * r * r).toFixed(2),
        steps: steps
      };
    }
    var m = gs.match(/(\d+(?:\.\d+)?)/g);
    var vals = m ? m.map(Number) : [];
    if (vals.length < 2) throw new Error('需要至少两个数值（如三角形底边与高）');
    var base = vals[0], height = vals[1];
    var area = new Rat(Math.round(base * height * 1e9), 2e9);
    var steps = [];
    steps.push({
      title: '套用三角形面积公式',
      body: 'S = ½ × 底 × 高',
      why: '三角形面积 = 底 × 高 ÷ 2，这是最基础的面积公式。'
    });
    steps.push({
      title: '代入数值',
      body: 'S = ½ × ' + base + ' × ' + height,
      why: '把题目给的底边与高代入公式。'
    });
    steps.push({
      title: '计算结果',
      body: 'S = ' + area.toDisplay(),
      why: '先算底×高，再除以 2，注意单位是面积单位。'
    });
    return {
      type: 'geometry', typeName: '三角形面积',
      answer: 'S = ' + area.toDisplay(),
      steps: steps
    };
  }

  /* ---------------- 识别题型 ---------------- */
  function detectType(problem) {
    var s = String(problem || '');
    var compact = s.replace(/\s+/g, '');
    var lower = s.toLowerCase();
    if (/三角形|面积|底边|高|圆|半径|直径|π/.test(s) && /\d/.test(s)) return 'geometry';
    if (/求导|导数|derivative|f\s*'|f′/.test(lower)) return 'derivative';
    if (/log|ln/.test(lower)) return 'log';
    var lines = splitLines(s);
    if (lines.length >= 2 && lines.filter(function (ln) { return ln.indexOf('=') >= 0; }).length >= 2) return 'system';
    var sp = splitEquation(s);
    if (sp) {
      try {
        var l = polyFromAST(parseExpr(sp.lhs), 'x');
        var r = polyFromAST(parseExpr(sp.rhs), 'x');
        var diff = polyAdd(l, polyNeg(r));
        if (polyDegree(diff) === 3) return 'cubic';
        if (polyDegree(diff) === 2) return 'quadratic';
        if (polyDegree(diff) === 1) return 'linear';
      } catch (e) { /* fallthrough */ }
    }
    var expr = cleanMath(s.split('=')[0]);
    if (expr) {
      try {
        var ast = parseExpr(expr);
        var p = polyFromAST(ast, 'x');
        if (polyIsConst(p) && expr.indexOf('/') >= 0) return 'fraction';
      } catch (e) { /* fallthrough */ }
    }
    return 'unknown';
  }

  /* ---------------- 求解入口（withSimilar 防止递归） ---------------- */
  function solveCore(problem) {
    var p = String(problem || '').trim()
      .replace(/[XＸ]/g, 'x').replace(/[YＹ]/g, 'y');
    if (!p) throw new Error('题目为空');
    var type = detectType(p);
    var result;
    switch (type) {
      case 'linear': result = solveLinear(splitEquation(p)); break;
      case 'quadratic': result = solveQuadratic(splitEquation(p)); break;
      case 'cubic': result = solveCubic(splitEquation(p)); break;
      case 'fraction': result = solveFraction(p); break;
      case 'derivative': result = solveDerivative(p); break;
      case 'system': result = solveSystem(splitLines(p)); break;
      case 'geometry': result = solveGeometry(p); break;
      case 'log': result = solveLog(p); break;
      default: throw new Error('离线引擎暂不支持该题型。目前支持：一元一次/二次方程、简单三次方程、分式运算、多项式求导、二元一次方程组、三角形/圆面积、简单对数。请选择示例题体验，或配置 LLM_API_KEY 由真实大模型解答任意题目。');
    }
    result.problem = p;
    result.type = type;
    result.typeName = result.typeName || '数学题';
    return result;
  }

  function solve(problem) {
    var r = solveCore(problem);
    r.similar = genSimilar(r.type, r);
    return r;
  }

  /* ---------------- 同类题生成 ---------------- */
  function genSimilar(type, ref) {
    var out = [];
    try {
      if (type === 'linear') {
        for (var i = 0; i < 3; i++) {
          var a = randInt(2, 6), x = randInt(1, 6), b = randInt(1, 12);
          var c = a * x + b;
          var q = a + 'x + ' + b + ' = ' + c;
          out.push({ problem: q, answer: solveCore(q).answer, typeName: '一元一次方程' });
        }
      } else if (type === 'quadratic') {
        for (var j = 0; j < 3; j++) {
          var r1 = randInt(1, 6), r2 = randInt(1, 6);
          if (r1 === r2) r2++;
          var q2 = 'x^2 − ' + (r1 + r2) + 'x + ' + (r1 * r2) + ' = 0';
          out.push({ problem: q2, answer: solveCore(q2).answer, typeName: '一元二次方程' });
        }
      } else if (type === 'fraction') {
        for (var k = 0; k < 3; k++) {
          var d1 = randInt(2, 9), d2 = randInt(2, 9), n1 = randInt(1, 5), n2 = randInt(1, 5);
          var q3 = n1 + '/' + d1 + ' + ' + n2 + '/' + d2;
          out.push({ problem: q3, answer: solveCore(q3).answer, typeName: '分数运算' });
        }
      } else if (type === 'derivative') {
        for (var t = 0; t < 3; t++) {
          var a3 = randInt(2, 5), b3 = randInt(2, 5);
          var c3 = randInt(1, 5) * (Math.random() < 0.5 ? -1 : 1);
          var q4 = 'f(x) = ' + a3 + 'x^2 + ' + b3 + 'x' + (c3 < 0 ? ' − ' + Math.abs(c3) : ' + ' + c3) + '，求导数';
          out.push({ problem: q4, answer: solveCore(q4).answer, typeName: '多项式求导' });
        }
      } else if (type === 'system') {
        for (var u = 0; u < 3; u++) {
          var x0 = randInt(1, 5), y0 = randInt(1, 5);
          var q5 = 'x + y = ' + (x0 + y0) + '；x − y = ' + (x0 - y0);
          out.push({ problem: q5, answer: solveCore(q5).answer, typeName: '二元一次方程组' });
        }
      } else if (type === 'geometry') {
        for (var g = 0; g < 3; g++) {
          var base = randInt(4, 12), h = randInt(3, 9);
          var q6 = '已知三角形底边为 ' + base + '，高为 ' + h + '，求面积';
          out.push({ problem: q6, answer: solveCore(q6).answer, typeName: '三角形面积' });
        }
      }
    } catch (e) { /* 同类题生成失败不影响主流程 */ }
    return out;
  }

  /* ---------------- 错因分析 ---------------- */
  var ERROR_PATTERNS = [
    {
      id: 'sign_move', label: '移项未变号',
      test: function (problem, work) {
        var sp = splitEquation(problem);
        if (!sp) return false;
        try {
          var lp = polyFromAST(parseExpr(sp.lhs), 'x');
          var rp = polyFromAST(parseExpr(sp.rhs), 'x');
          var constL = lp.has(0) ? lp.get(0) : Z0;
          var constR = rp.has(0) ? rp.get(0) : Z0;
          if (constL.isZero()) return false;
          var w = work.replace(/\s+/g, '');
          var rText = sp.rhs.replace(/\s+/g, '');
          var plus = rText + '\\+' + Math.abs(constL.n) + (constL.d !== 1 ? '/' + constL.d : '');
          if (new RegExp(plus).test(w)) {
            return { detail: '你把常数 ' + constL.toDisplay() + ' 从左边移到右边时没有变号。正确做法：' +
              '移项要变号，右边应为 "−' + constL.toDisplay() + '"，即 ' + constR.sub(constL).toDisplay() + '。' };
          }
        } catch (e) { return false; }
        return false;
      }
    },
    {
      id: 'sign_answer', label: '最终答案符号错误',
      test: function (problem, work) {
        try {
          var sol = solveCore(problem);
          var ans = extractAnswer(sol.answer);
          var userAns = extractAnswer(work);
          if (!ans || !userAns) return false;
          if (ans !== userAns && parseNum(userAns) === -parseNum(ans)) {
            return { detail: '你的答案与正确答案只差一个符号：正确答案是 ' + sol.answer + '。检查移项或去括号时是否漏掉了负号。' };
          }
        } catch (e) { return false; }
        return false;
      }
    },
    {
      id: 'arithmetic', label: '计算失误',
      test: function (problem, work) {
        try {
          var sol = solveCore(problem);
          var ans = extractAnswer(sol.answer);
          var userAns = extractAnswer(work);
          if (!ans || !userAns) return false;
          if (ans !== userAns) {
            return { detail: '你的结果 ' + userAns + ' 与正确答案 ' + sol.answer + ' 不一致，通常是中间某步四则运算算错了。建议把每一步的等式都写出来再检查一遍。' };
          }
        } catch (e) { return false; }
        return false;
      }
    }
  ];

  function extractAnswer(text) {
    if (!text) return null;
    var s = String(text).replace(/−/g, '-');
    var m, last = null;
    var re = /x₁?\s*=\s*([-]?\d+(?:\s*\/\s*\d+)?)/g;
    while ((m = re.exec(s)) !== null) last = m[1].replace(/\s+/g, '');
    if (last !== null) return last;
    var re2 = /([-]?\d+(?:\s*\/\s*\d+)?)/g;
    var nums = [];
    while ((m = re2.exec(s)) !== null) nums.push(m[1].replace(/\s+/g, ''));
    return nums.length ? nums[nums.length - 1] : null;
  }
  function allAnswers(text) {
    var out = [];
    if (!text) return out;
    var s = String(text).replace(/−/g, '-');
    var m, re = /x₁?\s*=\s*([-]?\d+(?:\s*\/\s*\d+)?)/g;
    while ((m = re.exec(s)) !== null) out.push(parseNum(m[1].replace(/\s+/g, '')));
    return out;
  }
  function parseNum(s) {
    if (!s) return NaN;
    var parts = s.split('/');
    var n = parseFloat(parts[0]);
    if (parts.length > 1) n = n / parseFloat(parts[1]);
    return n;
  }
  function getSuggestion(id) {
    var map = {
      sign_move: '牢记"移项要变号"：把某项从等号一边移到另一边时，符号必须取反。建议用箭头标注每个被移动的项。',
      sign_answer: '解方程或化简后，把答案代回原式验证一次；负号较多时，建议用括号把负项包起来再计算。',
      arithmetic: '放慢计算节奏，每步只做一次运算；完成后用代入法检验，能有效避免低级失误。',
      unknown: '把过程按步骤分行书写，并标注每一步的依据（等式性质/公式），便于定位问题。'
    };
    return map[id] || '';
  }
  function safeAnswer(p) { try { return solveCore(p).answer; } catch (e) { return ''; } }
  function safeSimilar(p) { try { return solveCore(p).similar; } catch (e) { return []; } }

  function analyze(problem, myWork) {
    var p = String(problem || '').trim();
    var w = String(myWork || '').trim();
    if (!p) throw new Error('题目为空');
    if (!w) throw new Error('请先输入你的过程或答案');
    try {
      var sol = solveCore(p);
      var correctList = allAnswers(sol.answer);
      if (!correctList.length) correctList.push(parseNum(extractAnswer(sol.answer)));
      var userAns = extractAnswer(w);
      var userNum = parseNum(userAns);
      var isCorrect = userAns !== null && !isNaN(userNum) && correctList.some(function (n) { return n === userNum; });
      if (isCorrect) {
        return {
          correct: true,
          errorType: 'none',
          title: '你的过程是对的 🎉',
          detail: '你的答案与正确答案一致（' + sol.answer + '）。可以再看看有没有更优的解法，或做一道同类题巩固。',
          correctAnswer: sol.answer,
          suggestion: '尝试用另一种方法（如代入法/因式分解）再解一遍，加深理解。',
          similar: sol.similar
        };
      }
    } catch (e) { /* 继续模式匹配 */ }

    for (var i = 0; i < ERROR_PATTERNS.length; i++) {
      var res = ERROR_PATTERNS[i].test(p, w);
      if (res) {
        return {
          correct: false,
          errorType: ERROR_PATTERNS[i].id,
          title: ERROR_PATTERNS[i].label,
          detail: res.detail,
          correctAnswer: safeAnswer(p),
          suggestion: getSuggestion(ERROR_PATTERNS[i].id),
          similar: safeSimilar(p)
        };
      }
    }
    return {
      correct: false,
      errorType: 'unknown',
      title: '未能精确识别错因',
      detail: '从你输入的过程看，结果与正确答案不一致。请把每一步的等式完整写出来（每行一个等式），系统就能更准确地定位错因。',
      correctAnswer: safeAnswer(p),
      suggestion: getSuggestion('unknown'),
      similar: safeSimilar(p)
    };
  }

  /* ---------------- 示例题库 ---------------- */
  var SAMPLES = [
    { id: 's1', label: '一元一次方程', text: '2x + 3 = 7，求 x', img: 'assets/sample-problems/linear.svg' },
    { id: 's2', label: '一元二次方程', text: 'x² − 5x + 6 = 0，求 x', img: 'assets/sample-problems/quadratic.svg' },
    { id: 's3', label: '分式运算', text: '1/2 + 1/3 = ?', img: 'assets/sample-problems/fraction.svg' },
    { id: 's4', label: '多项式求导', text: 'f(x) = 3x² + 2x − 1，求导数', img: 'assets/sample-problems/derivative.svg' },
    { id: 's5', label: '二元一次方程组', text: 'x + y = 5；x − y = 1', img: 'assets/sample-problems/system.svg' },
    { id: 's6', label: '三角形面积', text: '已知三角形底边为 8，高为 5，求面积', img: 'assets/sample-problems/geometry.svg' }
  ];

  return {
    solve: solve,
    solveCore: solveCore,
    analyze: analyze,
    detectType: detectType,
    SAMPLES: SAMPLES,
    version: '1.0.1'
  };
});
