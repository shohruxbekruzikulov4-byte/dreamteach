/* DreamTeach offline engine: Uzbek-aware search over lesson transcripts ("Deep Context Sync"),
   grounded answers with timecodes, quiz generation and transcript parsing. No network, no dependencies. */
(function (root) {
  'use strict';

  var APOS = /[‘’ʻʼ`´']/g;
  var LETTER = "a-z0-9'Ѐ-ӿ";

  function norm(s) {
    return String(s || '').toLowerCase().replace(APOS, "'").replace(/[–—]/g, ' ');
  }

  var STOP = {};
  ('va bu bilan uchun esa ham bir u ular biz siz men sen nima nimaga nega qanday qanaqa qaysi qachon qayerda kim ' +
   'necha nechta mi da ga ni dan emas edi deb yoki lekin ammo agar har eng shu o\'sha kerak mumkin haqida bo\'ladi ' +
   'bo\'lsa bo\'lgan degani deyiladi ya\'ni juda qilib qiladi bor yo\'q ekan nimani tushuntir tushuntiring aytib ' +
   'ayting bering ber menga iltimos haqda hamda keyin endi ushbu mana yana faqat hech nimadir qilsa qilish kabi ' +
   'darsda dars nimalar nimaning qiladimi bo\'ladimi uni unga undan buni bunga bundan shuni o\'zi ' +
   'what is the a an of to in and how why do does it this that are be for on with you your i').split(' ')
    .forEach(function (w) { STOP[w] = 1; });

  var SUFFIXES = ['lardagi', 'lardan', 'larning', 'larni', 'larga', 'larda', 'lari', 'lar',
    'yotgan', 'yapti', 'moqda', 'ilgan', 'iladi', 'ladi', 'adigan', 'ydigan', 'ganda', 'gan', 'kan', 'qan',
    'moqchi', 'moq', 'ishni', 'ishga', 'ishda', 'ish', 'adi', 'ydi', 'di', 'ingiz', 'imiz', 'ning', 'dagi', 'dan', 'tan',
    'lik', 'lig', 'chi', 'siz', 'roq', 'ni', 'ga', 'ka', 'qa', 'da', 'ta', 'ing', 'ib', 'sa', 'si', 'ini', 'im', 'i'];

  function stem(w) {
    var changed = true, guard = 0;
    while (changed && guard++ < 4) {
      changed = false;
      for (var i = 0; i < SUFFIXES.length; i++) {
        var s = SUFFIXES[i];
        if (w.length - s.length >= 3 && w.slice(-s.length) === s) { w = w.slice(0, -s.length); changed = true; break; }
      }
    }
    return w;
  }

  var SYN = {
    'ai': ["sun'iy", 'intellekt'], "sun'iy": ['ai'], 'xato': ['bug', 'gallyutsinatsiya'], 'muddat': ['deadline'],
    'fikr': ['feedback'], 'vazifa': ['task', 'topshiriq'], 'uchrashuv': ['meeting', 'stand-up'],
    'versiya': ['version', 'release'], 'joyla': ['deploy'], 'diagramma': ['grafik'], 'jadval': ['pivot', 'grafik'],
    'yig\'indi': ['sum'], 'qo\'sh': ['sum'], "o'rtacha": ['average'], 'sana': ['count'], 'shart': ['if'],
    'savol': ['prompt'], 'topshiriq': ['prompt', 'vazifa']
  };

  function tokens(s, keepStop) {
    var out = [], m, re = new RegExp('[' + LETTER + ']+(?:-[' + LETTER + ']+)*', 'g');
    var t = norm(s);
    while ((m = re.exec(t))) {
      var w = m[0].replace(/^'+|'+$/g, '');
      if (!w || (!keepStop && STOP[w])) continue;
      out.push(stem(w));
    }
    return out;
  }

  function expand(toks) {
    var out = toks.slice();
    toks.forEach(function (t) { (SYN[t] || []).forEach(function (x) { out.push(stem(norm(x))); }); });
    return out;
  }

  /* ---------- BM25 index over passages {t?, text, ref?} ---------- */
  function Index(passages) {
    this.p = passages;
    this.docs = passages.map(function (x) { return tokens(x.text); });
    this.df = {};
    var self = this, total = 0;
    this.docs.forEach(function (d) {
      total += d.length;
      var seen = {};
      d.forEach(function (w) { if (!seen[w]) { seen[w] = 1; self.df[w] = (self.df[w] || 0) + 1; } });
    });
    this.avg = total / Math.max(1, this.docs.length);
  }
  Index.prototype.search = function (query) {
    var q = expand(tokens(query)), N = this.docs.length, self = this, k1 = 1.2, b = 0.75;
    var uq = q.filter(function (w, i) { return q.indexOf(w) === i; });
    var res = this.docs.map(function (d, i) {
      var score = 0, hits = 0;
      uq.forEach(function (w) {
        var f = 0; for (var j = 0; j < d.length; j++) if (d[j] === w || (w.length >= 5 && d[j].indexOf(w) === 0)) f++;
        if (!f) return;
        hits++;
        var df = self.df[w] || 1, idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / self.avg));
      });
      return { i: i, score: score, hits: hits, coverage: uq.length ? hits / uq.length : 0 };
    });
    return { q: uq, results: res.sort(function (a, b2) { return b2.score - a.score; }) };
  };

  function mmss(t) {
    t = Math.max(0, Math.floor(t || 0));
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }

  /* Grounded answer: quotes the best passages with their timecodes. Never invents text. */
  function answer(question, passages, opts) {
    opts = opts || {};
    if (!passages || !passages.length) return { found: false, items: [] };
    var idx = new Index(passages), r = idx.search(question);
    var top = r.results[0];
    if (!r.q.length || !top || top.score <= 0 || top.coverage < 0.2 || (top.score < (opts.min || 0.9) && top.coverage < 0.5)) return { found: false, items: [], query: r.q };
    var picked = [top.i];
    r.results.slice(1, 4).forEach(function (x) { if (x.score >= top.score * 0.55 && picked.length < 3) picked.push(x.i); });
    var next = top.i + 1;
    if (picked.length < 3 && passages[next] && picked.indexOf(next) < 0 && passages[top.i].text.length < 90) picked.push(next);
    picked.sort(function (a, b) { return a - b; });
    return {
      found: true, query: r.q, confidence: Math.min(1, top.score / 6),
      items: picked.map(function (i) { return passages[i]; })
    };
  }

  /* ---------- term helpers ---------- */
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function termRegex(term) {
    var body = escRe(term).replace(/['‘’ʻ`]/g, "['‘’ʻ`]");
    return new RegExp('(^|[^A-Za-zЀ-ӿ‘’\'`])(' + body + ")([A-Za-z‘’'`]*)", 'i');
  }
  function hasTerm(text, term) { return termRegex(term).test(text); }

  /* Deterministic RNG so the same lesson gives a stable quiz until the learner asks for a new one */
  function rng(seed) {
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  }
  function shuffle(a, r) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function extractTerms(segments, n) {
    var count = {}, surface = {}, segHit = {};
    segments.forEach(function (s, si) {
      var m, re = /[A-Za-z‘’'`-]{4,}/g;
      while ((m = re.exec(s.text))) {
        var raw = m[0].replace(/^[-'‘’`]+|[-'‘’`]+$/g, '');
        var w = norm(raw);
        if (STOP[w] || w.length < 4) continue;
        var st = stem(w);
        if (STOP[st] || st.length < 4) continue;
        count[st] = (count[st] || 0) + 1;
        (segHit[st] = segHit[st] || {})[si] = 1;
        var cands = surface[st] = surface[st] || {};
        var base = raw.slice(0, Math.max(st.length, 4));
        cands[base] = (cands[base] || 0) + 1;
      }
    });
    var keys = Object.keys(count).sort(function (a, b) {
      var sa = count[a] + Object.keys(segHit[a]).length * 0.5 + (a.length > 6 ? 0.5 : 0);
      var sb = count[b] + Object.keys(segHit[b]).length * 0.5 + (b.length > 6 ? 0.5 : 0);
      return sb - sa;
    });
    return keys.slice(0, n || 8).map(function (k) {
      var c = surface[k]; return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
    });
  }

  /* ---------- quiz generation (offline) ---------- */
  function makeQuiz(lesson, opts) {
    opts = opts || {};
    var n = opts.n || 5, r = rng((lesson.id || 'x') + ':' + (opts.round || 0));
    var segs = lesson.segments || [];
    var terms = (lesson.terms && lesson.terms.length >= 3) ? lesson.terms.slice() : extractTerms(segs, 8);
    var pool = terms.concat(opts.extraTerms || []);
    var qs = [], usedSeg = {};
    var order = shuffle(terms, r);
    order.forEach(function (term, k) {
      if (qs.length >= n) return;
      var cands = segs.map(function (s, i) { return i; }).filter(function (i) { var m = segs[i].text.match(termRegex(term)); return !usedSeg[i] && m && m[3].length <= 6; });
      if (!cands.length) return;
      var si = cands[Math.floor(r() * cands.length)], seg = segs[si];
      var re = termRegex(term), others = shuffle(pool.filter(function (x) { return norm(x) !== norm(term) && !hasTerm(seg.text, x); }), r);
      if (others.length < 1) return;
      usedSeg[si] = 1;
      if (k % 3 === 2) { // true / false
        var makeFalse = r() < 0.5, text = seg.text;
        if (makeFalse) {
          var swap = others[0];
          text = seg.text.replace(new RegExp(re.source, 'gi'), function (_, pre, w, suf) { return pre + matchCase(w, swap) + suf; });
        }
        qs.push({ type: 'tf', prompt: text, options: ['To‘g‘ri', 'Noto‘g‘ri'], answer: makeFalse ? 1 : 0,
          t: seg.t, explain: seg.text, term: term });
      } else {
        var blank = seg.text.replace(new RegExp(re.source, 'gi'), function (_, pre, w, suf) { return pre + '_____' + suf; });
        var opts4 = shuffle([term].concat(others.slice(0, 3)), r);
        qs.push({ type: 'cloze', prompt: blank, options: opts4, answer: opts4.indexOf(term), t: seg.t, explain: seg.text, term: term });
      }
    });
    return qs;
  }
  function matchCase(src, word) {
    if (src && src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  }

  /* ---------- transcript parsing for author uploads ---------- */
  function toSec(h, m, s) { return (+h || 0) * 3600 + (+m || 0) * 60 + parseFloat(String(s).replace(',', '.')); }
  function parseTranscript(raw, duration) {
    var text = String(raw || '').replace(/\r/g, '').trim();
    if (!text) return [];
    var segs = [], m;
    // SRT / VTT cues
    var cue = /(?:(\d+):)?(\d{1,2}):(\d{2}(?:[.,]\d+)?)\s*-->\s*[^\n]+\n([\s\S]*?)(?=\n\s*\n|$)/g;
    while ((m = cue.exec(text))) {
      var body = m[4].replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim();
      if (body) segs.push({ t: Math.floor(toSec(m[1], m[2], m[3])), text: body });
    }
    if (segs.length) return mergeShort(segs);
    // "mm:ss matn" or "[mm:ss] matn" lines
    var lines = text.split('\n'), stamped = 0;
    lines.forEach(function (ln) {
      var x = ln.match(/^\s*\[?(?:(\d+):)?(\d{1,2}):(\d{2})\]?\s*[-–—:]?\s*(.+)$/);
      if (x) { stamped++; segs.push({ t: toSec(x[1], x[2], x[3]), text: x[4].trim() }); }
      else if (ln.trim() && segs.length) segs[segs.length - 1].text += ' ' + ln.trim();
    });
    if (stamped) return segs;
    // plain text: split into sentences and spread over the video length
    var sentences = text.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]+["»”]?|[^.!?]+$/g) || [text];
    var chunks = [], cur = '';
    sentences.forEach(function (s) { s = s.trim(); if (!s) return; if ((cur + ' ' + s).length > 140 && cur) { chunks.push(cur); cur = s; } else cur = (cur + ' ' + s).trim(); });
    if (cur) chunks.push(cur);
    var total = chunks.join(' ').length || 1, dur = duration || chunks.length * 10, acc = 0;
    return chunks.map(function (c) { var t = Math.round(acc / total * dur); acc += c.length + 1; return { t: t, text: c }; });
  }
  function mergeShort(segs) {
    var out = [];
    segs.forEach(function (s) {
      var last = out[out.length - 1];
      if (last && last.text.length < 60 && s.t - last.t < 8) last.text += ' ' + s.text; else out.push({ t: s.t, text: s.text });
    });
    return out;
  }

  /* Split free text (company documents) into citeable passages */
  function chunkDoc(name, raw) {
    var paras = String(raw || '').replace(/\r/g, '').split(/\n\s*\n|\n(?=[-*•]|\d+[.)])/);
    var out = [], n = 0;
    paras.forEach(function (p) {
      p = p.replace(/\s+/g, ' ').trim();
      if (!p) return;
      var sents = p.match(/[^.!?]+[.!?]*/g) || [p], cur = '';
      sents.forEach(function (s) {
        if ((cur + s).length > 260 && cur) { out.push({ doc: name, part: ++n, text: cur.trim() }); cur = s; } else cur += s;
      });
      if (cur.trim()) out.push({ doc: name, part: ++n, text: cur.trim() });
    });
    return out;
  }

  var api = { norm: norm, tokens: tokens, stem: stem, Index: Index, answer: answer, makeQuiz: makeQuiz, extractTerms: extractTerms,
    parseTranscript: parseTranscript, chunkDoc: chunkDoc, mmss: mmss, hasTerm: hasTerm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DTEngine = api;
})(typeof window !== 'undefined' ? window : this);
