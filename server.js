/* DreamTeach server — zero dependencies (Node 18+).
   Serves the PWA, proxies AI to Google Gemini, receives offline sync batches and author video uploads.
   Run:  GEMINI_API_KEY=... node server.js      (without a key the app still works with on-device answers) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const Engine = require('./js/engine.js');

const PORT = +process.env.PORT || 8080;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'server-data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MOCK = process.env.AI_MOCK === '1';
const MAX_UPLOAD = 300 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { events: [], seen: {}, devices: {}, lessons: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* first run */ }
let saveT = null;
function saveDb() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 300);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

/* ---------------- AI ---------------- */
const TUTOR_RULES = 'Siz DreamTeach platformasidagi AI ustozsiz. Faqat berilgan dars matniga tayanib, o‘zbek tilida (lotin yozuvida) qisqa va aniq javob bering: 2–5 gap. ' +
  'Har bir fikrdan keyin dars matnidagi vaqtni [mm:ss] ko‘rinishida yozing. Agar javob dars matnida bo‘lmasa, buni ochiq ayting va qaysi mavzuni qayta ko‘rishni maslahat bering. ' +
  'To‘qima ma’lumot qo‘shmang. Markdown ishlatmang.';
const MENTOR_RULES = 'Siz kompaniyaning shaxsiy AI mentorisiz. Faqat berilgan ichki hujjatlarga tayanib, o‘zbek tilida qisqa javob bering. ' +
  'Har bir fikrdan keyin manbani [Hujjat nomi, N-qism] ko‘rinishida yozing. Hujjatlarda javob bo‘lmasa, ochiq ayting. Markdown ishlatmang.';
const QUIZ_RULES = 'Berilgan dars matni asosida o‘zbek tilida test tuzing. Faqat JSON qaytaring: ' +
  '{"questions":[{"q":"savol","options":["A","B","C","D"],"answer":0,"t":12}]} — answer to‘g‘ri variant indeksi (0–3), t — javob topiladigan joyning soniyasi. ' +
  'Variantlar qisqa, faqat bittasi to‘g‘ri, barchasi dars matnidan.';

const transcript = (segs) => (segs || []).slice(0, 400).map((s) => `[${Engine.mmss(s.t)}] ${String(s.text).slice(0, 600)}`).join('\n');

async function gemini(system, contents, json) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: json ? 0.4 : 0.3, maxOutputTokens: json ? 2000 : 700, thinkingConfig: { thinkingBudget: 0 } }
  };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Gemini HTTP ${r.status}`);
  const text = (((j.candidates || [])[0] || {}).content || {}).parts;
  return (text || []).map((p) => p.text || '').join('').trim();
}

function mockAnswer(question, segments) {
  const a = Engine.answer(question, segments);
  if (!a.found) return 'Dars matnida bu savolga aniq javob topilmadi. Transkriptni qayta ko‘rib chiqing.';
  return a.items.map((s) => `${s.text} [${Engine.mmss(s.t)}]`).join(' ');
}

async function aiAsk({ question, title, segments, history }) {
  if (MOCK || !KEY) return mockAnswer(question, segments);
  const contents = [];
  (history || []).slice(-6).forEach((h) => { if (h.text) contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: String(h.text).slice(0, 2000) }] }); });
  contents.push({ role: 'user', parts: [{ text: `Dars: ${title}\nDars matni:\n${transcript(segments)}\n\nO‘quvchi savoli: ${question}` }] });
  return gemini(TUTOR_RULES, contents, false);
}
async function aiMentor({ question, passages }) {
  const ps = (passages || []).slice(0, 300);
  if (MOCK || !KEY) {
    const a = Engine.answer(question, ps, { min: 0.6 });
    return a.found ? a.items.map((p) => `${p.text} [${p.doc}, ${p.part}-qism]`).join(' ') : 'Hujjatlarda bu savolga javob topilmadi.';
  }
  const docs = ps.map((p) => `[${p.doc}, ${p.part}-qism] ${p.text}`).join('\n');
  return gemini(MENTOR_RULES, [{ role: 'user', parts: [{ text: `Ichki hujjatlar:\n${docs}\n\nXodim savoli: ${question}` }] }], false);
}
async function aiQuiz({ title, segments, terms, n }) {
  n = Math.min(10, Math.max(1, n | 0 || 5));
  if (MOCK || !KEY) {
    return Engine.makeQuiz({ id: title, segments, terms: Array.isArray(terms) ? terms : [] }, { n }).map((q) => ({ q: q.prompt, options: q.options, answer: q.answer, t: q.t }));
  }
  const raw = await gemini(QUIZ_RULES, [{ role: 'user', parts: [{ text: `Savollar soni: ${n}\nDars: ${title}\nDars matni:\n${transcript(segments)}` }] }], true);
  const m = raw.match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : raw);
  return (j.questions || []).slice(0, n);
}

/* ---------------- helpers ---------------- */
function send(res, code, obj, headers) {
  const body = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}
function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}
const safeId = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not_found' });
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const isMedia = /^(video|image)\//.test(type);
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': isMedia ? 'public, max-age=604800' : 'no-cache' };
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const [a, b] = range.replace('bytes=', '').split('-');
      let start = parseInt(a, 10), end = b ? parseInt(b, 10) : st.size - 1;
      if (isNaN(start)) { start = st.size - parseInt(b, 10); end = st.size - 1; }
      if (start < 0 || start >= st.size || end >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- routes ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/health') return send(res, 200, { ok: true, app: 'dreamteach', ai: !!KEY || MOCK, model: MOCK ? 'test rejimi (AI_MOCK)' : MODEL });
    if (p === '/api/ask' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b.question || !Array.isArray(b.segments)) return send(res, 400, { error: 'question va segments kerak' });
      return send(res, 200, { text: await aiAsk(b) });
    }
    if (p === '/api/mentor' && req.method === 'POST') {
      const b = await readJson(req);
      return send(res, 200, { text: await aiMentor(b) });
    }
    if (p === '/api/quiz' && req.method === 'POST') {
      const b = await readJson(req);
      return send(res, 200, { questions: await aiQuiz(b) });
    }
    if (p === '/api/sync' && req.method === 'POST') {
      const b = await readJson(req, 8 * 1024 * 1024);
      const dev = b.device || {}; const events = Array.isArray(b.events) ? b.events.slice(0, 5000) : [];
      let accepted = 0;
      events.forEach((e) => {
        if (!e || !e.id) return;
        const key = `${safeId(dev.id)}:${e.id}`;
        // progress/notes use stable ids: the newest copy replaces the older one
        if (db.seen[key] && !/^(p|n|d):/.test(e.id)) return;
        db.seen[key] = Date.now(); accepted++;
        db.events.push({ device: safeId(dev.id), user: String(dev.name || e.user || '').slice(0, 60), id: e.id, type: e.type, ts: e.ts, data: e.data, at: Date.now() });
        if (e.type === 'lesson_published' && e.data && e.data.id) {
          const l = Object.assign({}, e.data, { video: e.data.videoUrl || e.data.video || null, status: 'uploaded', author: e.data.author || dev.name });
          delete l.videoUrl; delete l.poster;
          db.lessons = db.lessons.filter((x) => x.id !== l.id).concat([l]);
        }
      });
      if (db.events.length > 200000) db.events = db.events.slice(-150000);
      db.devices[safeId(dev.id)] = { name: dev.name, last: Date.now() };
      saveDb();
      return send(res, 200, { ok: true, accepted });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const id = safeId(url.searchParams.get('id'));
      if (!id) return send(res, 400, { error: 'id kerak' });
      const type = String(req.headers['content-type'] || 'video/mp4');
      const ext = type.includes('webm') ? '.webm' : type.includes('quicktime') ? '.mov' : '.mp4';
      const file = path.join(UPLOAD_DIR, id + ext);
      let size = 0; const out = fs.createWriteStream(file);
      req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.unlink(file, () => {}); } });
      req.pipe(out);
      out.on('finish', () => send(res, 200, { ok: true, url: `uploads/${id}${ext}`, size }));
      out.on('error', () => send(res, 500, { error: 'yozib bo‘lmadi' }));
      return;
    }
    if (p === '/api/catalog') return send(res, 200, { lessons: db.lessons });
    if (p === '/api/stats') {
      const by = {}; db.events.forEach((e) => { by[e.type] = (by[e.type] || 0) + 1; });
      return send(res, 200, { devices: Object.keys(db.devices).length, events: db.events.length, byType: by, lessons: db.lessons.length });
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'not_found' });

    // static files
    let rel = decodeURIComponent(p);
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel.startsWith('/uploads/')) return serveFile(req, res, path.join(UPLOAD_DIR, path.basename(rel)));
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT) || /[\\/](server-data|node_modules|\.git)([\\/]|$)/.test(file) || path.basename(file) === 'server.js') return send(res, 404, { error: 'not_found' });
    return serveFile(req, res, file);
  } catch (e) {
    return send(res, e.message === 'too_large' ? 413 : 500, { error: e.message || 'server_error' });
  }
});

server.listen(PORT, () => {
  console.log(`DreamTeach: http://localhost:${PORT}`);
  console.log(KEY && !MOCK ? `AI: ${MODEL} (Gemini)` : 'AI: kalitsiz rejim — javoblar dars matnidan. Gemini uchun GEMINI_API_KEY bering.');
});
