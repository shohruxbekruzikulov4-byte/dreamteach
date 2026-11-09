/* DreamTeach server — zero dependencies (Node 18+).
   Serves the PWA, proxies AI to Google Gemini, receives offline sync batches and author video uploads.
   Run:  GEMINI_API_KEY=... node server.js      (without a key the app still works with on-device answers) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Engine = require('./js/engine.js');

const PORT = +process.env.PORT || 8080;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'server-data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MOCK = process.env.AI_MOCK === '1';
const MAX_UPLOAD = 300 * 1024 * 1024;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Analog11@';
const ADMIN_TOKEN = 'adt-' + Buffer.from(ADMIN_PASSWORD + ':dreamteach').toString('base64');

/* ---- Payment config ---- */
const PAYME_ID       = process.env.PAYME_MERCHANT_ID   || '';
const PAYME_KEY      = process.env.PAYME_SECRET_KEY     || '';
const CLICK_SID      = process.env.CLICK_SERVICE_ID     || '';
const CLICK_MERCHANT = process.env.CLICK_MERCHANT_ID    || '';
const CLICK_KEY      = process.env.CLICK_SECRET_KEY     || '';
const SITE_URL       = process.env.SITE_URL             || 'https://dreamteach-production.up.railway.app';

/* subscription plans (in tiyin for Payme, so'm for display) */
const PLANS = {
  teacher_monthly:  { label: "O'qituvchi oylik",    amount: 9900000,  period: 30  },
  teacher_yearly:   { label: "O'qituvchi yillik",   amount: 79000000, period: 365 },
  student_monthly:  { label: "O'quvchi oylik",       amount: 4900000,  period: 30  },
  student_yearly:   { label: "O'quvchi yillik",      amount: 39000000, period: 365 }
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { events: [], seen: {}, devices: {}, lessons: [], teachers: [], students: [], payments: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* first run */ }
if (!db.teachers)  db.teachers  = [];
if (!db.students)  db.students  = [];
if (!db.payments)  db.payments  = [];
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

/* ---------------- AI: core ---------------- */
const TUTOR_RULES = "Siz DreamTeach platformasidagi AI ustozsiz. Faqat berilgan dars matniga tayanib, o'zbek tilida (lotin yozuvida) qisqa va aniq javob bering: 2-5 gap. " +
  "Har bir fikrdan keyin dars matnidagi vaqtni [mm:ss] ko'rinishida yozing. Agar javob dars matnida bo'lmasa, buni ochiq ayting va qaysi mavzuni qayta ko'rishni maslahat bering. " +
  "To'qima ma'lumot qo'shmang. Markdown ishlatmang.";
const MENTOR_RULES = "Siz kompaniyaning shaxsiy AI mentorisiz. Faqat berilgan ichki hujjatlarga tayanib, o'zbek tilida qisqa javob bering. " +
  "Har bir fikrdan keyin manbani [Hujjat nomi, N-qism] ko'rinishida yozing. Hujjatlarda javob bo'lmasa, ochiq ayting. Markdown ishlatmang.";
const QUIZ_RULES = "Berilgan dars matni asosida o'zbek tilida test tuzing. Faqat JSON qaytaring: " +
  '{"questions":[{"q":"savol","options":["A","B","C","D"],"answer":0,"t":12}]} - answer to\'g\'ri variant indeksi (0-3), t - javob topiladigan joyning soniyasi. ' +
  "Variantlar qisqa, faqat bittasi to'g'ri, barchasi dars matnidan.";

/* ---------------- AI: teacher ---------------- */
const RESUME_RULES = "Siz DreamTeach platformasining HR ekspertisiz. O'qituvchi resumesini tahlil qilib, faqat JSON qaytaring:\n" +
  '{"score":8,"strengths":["kuchli tomon 1","kuchli tomon 2"],"weaknesses":["zaif tomon 1"],"summary":"qisqa xulosa 2-3 gap","recommendation":"qabul qilish/rad etish tavsiyasi"}\n' +
  "score: 1-10 oralig'ida baho. 7+ bo'lsa qabul qilishga tavsiya. Faqat JSON, boshqa hech narsa yozmang.";

function examRules(specialty) {
  return `Siz professional imtihon tuzuvchisiz. "${specialty}" mutaxassisligi bo'yicha o'qituvchi uchun 5 ta professional savol tuzing.\n` +
    'Faqat JSON qaytaring: {"questions":[{"id":1,"q":"savol matni","options":["A variant","B variant","C variant","D variant"],"answer":0,"explanation":"to\'g\'ri javob izohi"}]}\n' +
    "answer - to'g'ri variant indeksi (0-3). Savollar amaliy va chuqur bo'lsin. Faqat JSON.";
}

const EXAM_GRADE_RULES = "Siz imtihon baholovchisisiz. O'qituvchi imtihon javoblarini baholab, faqat JSON qaytaring:\n" +
  '{"score":75,"passed":true,"feedback":"qisqa umumiy baho 2-3 gap","details":[{"q":"savol","correct":true,"explanation":"izoh"}]}\n' +
  "score: 0-100. passed: score >= 60 bo'lsa true. Faqat JSON.";

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
  if (!a.found) return "Dars matnida bu savolga aniq javob topilmadi. Transkriptni qayta ko'rib chiqing.";
  return a.items.map((s) => `${s.text} [${Engine.mmss(s.t)}]`).join(' ');
}

async function aiAsk({ question, title, segments, history }) {
  if (MOCK || !KEY) return mockAnswer(question, segments);
  const contents = [];
  (history || []).slice(-6).forEach((h) => { if (h.text) contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: String(h.text).slice(0, 2000) }] }); });
  contents.push({ role: 'user', parts: [{ text: `Dars: ${title}\nDars matni:\n${transcript(segments)}\n\nO'quvchi savoli: ${question}` }] });
  return gemini(TUTOR_RULES, contents, false);
}
async function aiMentor({ question, passages }) {
  const ps = (passages || []).slice(0, 300);
  if (MOCK || !KEY) {
    const a = Engine.answer(question, ps, { min: 0.6 });
    return a.found ? a.items.map((p) => `${p.text} [${p.doc}, ${p.part}-qism]`).join(' ') : "Hujjatlarda bu savolga javob topilmadi.";
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

/* ---------------- AI: teacher functions ---------------- */
async function aiResumeCheck({ name, specialty, experience, resumeText }) {
  if (!KEY || MOCK) {
    const score = Math.min(10, Math.max(1, Math.floor((+experience || 0) * 1.2 + 4)));
    return {
      score, passed: score >= 7,
      strengths: ['Tajriba mavjud', 'Mutaxassislik aniq ko\'rsatilgan'],
      weaknesses: score < 7 ? ['Qo\'shimcha malaka talab qilinadi'] : [],
      summary: `${name} - ${specialty} sohasida ${experience} yil tajribaga ega.`,
      recommendation: score >= 7 ? "Imtihonga o'tkazishga tavsiya etiladi." : "Qo'shimcha hujjatlar kerak."
    };
  }
  const prompt = `O'qituvchi ma'lumotlari:\nIsm: ${name}\nMutaxassislik: ${specialty}\nTajriba: ${experience} yil\n\nResume:\n${String(resumeText || '').slice(0, 3000)}`;
  const raw = await gemini(RESUME_RULES, [{ role: 'user', parts: [{ text: prompt }] }], true);
  const m = raw.match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : raw);
  return { ...j, passed: (j.score || 0) >= 7 };
}

async function aiGenerateExam({ specialty }) {
  if (!KEY || MOCK) {
    return [
      { id: 1, q: `${specialty} sohasida eng muhim tushuncha nima?`, options: ["Amaliy ko'nikma", "Nazariy bilim", "Tajriba", "Hamma javob to'g'ri"], answer: 3, explanation: "Barchasi muhim." },
      { id: 2, q: "Dars rejasini tuzishda eng birinchi qadam?", options: ["Maqsad belgilash", "Material tanlash", "Test tuzish", "Baholash"], answer: 0, explanation: "Maqsad belgilash asosiy qadam." },
      { id: 3, q: "O'quvchi motivatsiyasini oshirish uchun qaysi usul eng samarali?", options: ["Ko'proq dars berish", "Interaktiv mashqlar", "Imtihon o'tkazish", "Vazifa berish"], answer: 1, explanation: "Interaktiv usullar eng samarali." },
      { id: 4, q: "Murakkab mavzuni tushuntirish uchun qaysi yondashuv yaxshi?", options: ["Oddiydan murakkabga", "Murakkabdan oddiyga", "Faqat misol", "Faqat nazariya"], answer: 0, explanation: "Oddiydan murakkabga - klassik pedagogik yondashuv." },
      { id: 5, q: "Online dars samaradorligini qanday o'lchash mumkin?", options: ["Davomiylik", "Test natijalari", "Savollar soni", "Barchasi"], answer: 3, explanation: "Barcha ko'rsatkichlar muhim." }
    ];
  }
  const raw = await gemini(examRules(specialty), [{ role: 'user', parts: [{ text: `Mutaxassislik: ${specialty}` }] }], true);
  const m = raw.match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : raw);
  return (j.questions || []).slice(0, 5);
}

async function aiGradeExam({ questions, answers, specialty }) {
  if (!KEY || MOCK) {
    let correct = 0;
    const details = questions.map((q, i) => {
      const isCorrect = answers[i] === q.answer;
      if (isCorrect) correct++;
      return { q: q.q, correct: isCorrect, explanation: q.explanation || '' };
    });
    const score = Math.round(correct / questions.length * 100);
    return { score, passed: score >= 60, feedback: `${correct}/${questions.length} to'g'ri javob. ${score >= 60 ? "Tabriklaymiz! Imtihondan o'tdingiz." : "Bilimingizni oshiring va qayta urinib ko'ring."}`, details };
  }
  const qText = questions.map((q, i) => `${i + 1}. ${q.q}\nTanlangan: ${q.options[answers[i]] || 'Javob berilmagan'}\nTo\'g\'ri: ${q.options[q.answer]}`).join('\n\n');
  const raw = await gemini(EXAM_GRADE_RULES, [{ role: 'user', parts: [{ text: `Mutaxassislik: ${specialty}\n\nSavollar va javoblar:\n${qText}` }] }], true);
  const m = raw.match(/\{[\s\S]*\}/);
  const j = JSON.parse(m ? m[0] : raw);
  return { ...j, passed: (j.score || 0) >= 60 };
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
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function checkAdmin(req) {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

/* ---- Subscription helpers ---- */
function activateSubscription(payment) {
  const plan = PLANS[payment.planId];
  if (!plan) return;
  const expiresAt = Date.now() + plan.period * 24 * 3600 * 1000;
  if (payment.userType === 'teacher') {
    let teacher = db.teachers.find(t => t.id === payment.userId);
    if (!teacher) {
      teacher = { id: payment.userId, name: 'Teacher', status: 'approved', createdAt: Date.now() };
      db.teachers.push(teacher);
    }
    teacher.subscriptionPlan = payment.planId;
    teacher.subscriptionExpires = expiresAt;
    teacher.updatedAt = Date.now();
  } else {
    let student = db.students.find(s => s.id === payment.userId);
    if (!student) {
      student = { id: payment.userId, createdAt: Date.now() };
      db.students.push(student);
    }
    student.subscriptionPlan = payment.planId;
    student.subscriptionExpires = expiresAt;
  }
  saveDb();
}

function getSubscription(userId, userType) {
  let user = null;
  if (userType === 'teacher') user = db.teachers.find(t => t.id === userId);
  else user = db.students.find(s => s.id === userId);

  if (user && user.subscriptionExpires && user.subscriptionExpires > Date.now()) {
    const plan = PLANS[user.subscriptionPlan];
    return {
      active: true,
      plan: user.subscriptionPlan || null,
      planLabel: plan ? plan.label : null,
      expiresAt: user.subscriptionExpires || null,
      daysLeft: Math.ceil((user.subscriptionExpires - Date.now()) / 86400000)
    };
  }

  // Fallback: check db.payments for any active paid plan for this userId
  const paid = (db.payments || [])
    .filter(p => p.userId === userId && (p.userType || 'student') === userType && p.status === 'paid' && p.paidAt)
    .sort((a, b) => b.paidAt - a.paidAt)[0];
  if (paid) {
    const plan = PLANS[paid.planId];
    if (plan) {
      const expiresAt = paid.paidAt + plan.period * 24 * 3600 * 1000;
      if (expiresAt > Date.now()) {
        return {
          active: true,
          plan: paid.planId,
          planLabel: plan.label,
          expiresAt,
          daysLeft: Math.ceil((expiresAt - Date.now()) / 86400000)
        };
      }
    }
  }

  return { active: false, plan: null, expiresAt: null, daysLeft: 0 };
}

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/health') return send(res, 200, { ok: true, app: 'dreamteach', ai: !!KEY || MOCK, model: MOCK ? 'test rejimi (AI_MOCK)' : MODEL });

    /* ---- original endpoints ---- */
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
      out.on('error', () => send(res, 500, { error: "yozib bo'lmadi" }));
      return;
    }
    if (p === '/api/catalog') return send(res, 200, { lessons: db.lessons });
    if (p === '/api/stats') {
      const by = {}; db.events.forEach((e) => { by[e.type] = (by[e.type] || 0) + 1; });
      return send(res, 200, { devices: Object.keys(db.devices).length, events: db.events.length, byType: by, lessons: db.lessons.length });
    }

    /* ============================================================
       TEACHER PANEL API
    ============================================================ */

    // POST /api/teacher/register
    if (p === '/api/teacher/register' && req.method === 'POST') {
      const b = await readJson(req, 4 * 1024 * 1024);
      const { name, specialty, experience, resumeText, phone } = b;
      if (!name || !specialty) return send(res, 400, { error: 'ism va mutaxassislik kerak' });
      if (phone) {
        const ex = db.teachers.find(t => t.phone === String(phone).slice(0, 20) && t.status !== 'rejected');
        if (ex) return send(res, 200, { existing: true, teacher: { id: ex.id, status: ex.status, name: ex.name } });
      }
      const aiResult = await aiResumeCheck({ name, specialty, experience: +experience || 0, resumeText });
      const id = 'tr-' + uid();
      const teacher = {
        id, name: String(name).slice(0, 80), specialty: String(specialty).slice(0, 80),
        experience: +experience || 0, resumeText: String(resumeText || '').slice(0, 5000),
        phone: String(phone || '').slice(0, 20),
        resumeScore: aiResult.score, resumePassed: aiResult.passed,
        resumeAnalysis: aiResult,
        status: 'pending_exam',
        examResult: null, adminNote: '', createdAt: Date.now(), updatedAt: Date.now()
      };
      db.teachers.push(teacher);
      saveDb();
      return send(res, 200, { ok: true, teacher: { id, status: teacher.status, resumeScore: aiResult.score, resumePassed: aiResult.passed, analysis: aiResult } });
    }

    // POST /api/teacher/exam/generate
    if (p === '/api/teacher/exam/generate' && req.method === 'POST') {
      const b = await readJson(req);
      const { teacherId, specialty } = b;
      const teacher = db.teachers.find(t => t.id === teacherId);
      if (!teacher) return send(res, 404, { error: "O'qituvchi topilmadi" });
      if (teacher.status !== 'pending_exam') return send(res, 400, { error: `Imtihon holati mos emas: ${teacher.status}` });
      const questions = await aiGenerateExam({ specialty: specialty || teacher.specialty });
      teacher._examQuestions = questions;
      teacher.updatedAt = Date.now();
      saveDb();
      const clientQs = questions.map(q => ({ id: q.id, q: q.q, options: q.options }));
      return send(res, 200, { ok: true, questions: clientQs });
    }

    // POST /api/teacher/exam/submit
    if (p === '/api/teacher/exam/submit' && req.method === 'POST') {
      const b = await readJson(req);
      const { teacherId, answers } = b;
      const teacher = db.teachers.find(t => t.id === teacherId);
      if (!teacher) return send(res, 404, { error: "O'qituvchi topilmadi" });
      if (!teacher._examQuestions) return send(res, 400, { error: 'Avval imtihon savollarini oling' });
      const result = await aiGradeExam({ questions: teacher._examQuestions, answers: answers || [], specialty: teacher.specialty });
      teacher.examResult = { ...result, submittedAt: Date.now() };
      teacher.examPassed = result.passed;
      teacher.status = 'pending_admin';
      delete teacher._examQuestions;
      teacher.updatedAt = Date.now();
      saveDb();
      return send(res, 200, { ok: true, result, status: teacher.status });
    }

    // GET /api/teacher/status/:id
    if (p.startsWith('/api/teacher/status/') && req.method === 'GET') {
      const id = safeId(p.replace('/api/teacher/status/', ''));
      const teacher = db.teachers.find(t => t.id === id);
      if (!teacher) return send(res, 404, { error: 'Topilmadi' });
      return send(res, 200, {
        id: teacher.id, name: teacher.name, specialty: teacher.specialty,
        status: teacher.status, resumeScore: teacher.resumeScore,
        resumePassed: teacher.resumePassed, examPassed: teacher.examPassed,
        examScore: teacher.examResult ? teacher.examResult.score : null,
        adminNote: teacher.adminNote || '', createdAt: teacher.createdAt
      });
    }

    /* ============================================================
       ADMIN PANEL API
    ============================================================ */

    // POST /api/admin/login
    if (p === '/api/admin/login' && req.method === 'POST') {
      const b = await readJson(req);
      if (b.password === ADMIN_PASSWORD) return send(res, 200, { ok: true, token: ADMIN_TOKEN });
      return send(res, 401, { error: "Parol noto'g'ri" });
    }

    // GET /api/admin/teachers
    if (p === '/api/admin/teachers' && req.method === 'GET') {
      if (!checkAdmin(req)) return send(res, 401, { error: "Ruxsat yo'q" });
      const status = url.searchParams.get('status');
      let list = db.teachers.map(t => ({
        id: t.id, name: t.name, specialty: t.specialty, experience: t.experience,
        phone: t.phone, status: t.status, resumeScore: t.resumeScore,
        resumePassed: t.resumePassed, examPassed: t.examPassed,
        examScore: t.examResult ? t.examResult.score : null,
        adminNote: t.adminNote, createdAt: t.createdAt, updatedAt: t.updatedAt,
        resumeAnalysis: t.resumeAnalysis, examResult: t.examResult, resumeText: t.resumeText
      }));
      if (status) list = list.filter(t => t.status === status);
      list.sort((a, b) => b.createdAt - a.createdAt);
      const stats = {
        total: db.teachers.length,
        pending_exam: db.teachers.filter(t => t.status === 'pending_exam').length,
        pending_admin: db.teachers.filter(t => t.status === 'pending_admin').length,
        approved: db.teachers.filter(t => t.status === 'approved').length,
        rejected: db.teachers.filter(t => t.status === 'rejected').length
      };
      return send(res, 200, { teachers: list, stats });
    }

    // POST /api/admin/teachers/:id/approve
    if (p.match(/^\/api\/admin\/teachers\/[^/]+\/approve$/) && req.method === 'POST') {
      if (!checkAdmin(req)) return send(res, 401, { error: "Ruxsat yo'q" });
      const id = safeId(p.split('/')[4]);
      const b = await readJson(req);
      const teacher = db.teachers.find(t => t.id === id);
      if (!teacher) return send(res, 404, { error: 'Topilmadi' });
      teacher.status = 'approved'; teacher.adminNote = String(b.note || '').slice(0, 500);
      teacher.approvedAt = Date.now(); teacher.updatedAt = Date.now();
      saveDb();
      return send(res, 200, { ok: true, teacher: { id, status: 'approved' } });
    }

    // POST /api/admin/teachers/:id/reject
    if (p.match(/^\/api\/admin\/teachers\/[^/]+\/reject$/) && req.method === 'POST') {
      if (!checkAdmin(req)) return send(res, 401, { error: "Ruxsat yo'q" });
      const id = safeId(p.split('/')[4]);
      const b = await readJson(req);
      const teacher = db.teachers.find(t => t.id === id);
      if (!teacher) return send(res, 404, { error: 'Topilmadi' });
      teacher.status = 'rejected'; teacher.adminNote = String(b.note || '').slice(0, 500);
      teacher.rejectedAt = Date.now(); teacher.updatedAt = Date.now();
      saveDb();
      return send(res, 200, { ok: true, teacher: { id, status: 'rejected' } });
    }

    // POST /api/admin/teachers/:id/reset-exam
    if (p.match(/^\/api\/admin\/teachers\/[^/]+\/reset-exam$/) && req.method === 'POST') {
      if (!checkAdmin(req)) return send(res, 401, { error: "Ruxsat yo'q" });
      const id = safeId(p.split('/')[4]);
      const teacher = db.teachers.find(t => t.id === id);
      if (!teacher) return send(res, 404, { error: 'Topilmadi' });
      teacher.status = 'pending_exam'; teacher.examResult = null; teacher.examPassed = false;
      teacher.updatedAt = Date.now();
      saveDb();
      return send(res, 200, { ok: true, teacher: { id, status: 'pending_exam' } });
    }

    /* ============================================================
       PAYMENT API
    ============================================================ */

    // GET /api/plans — return subscription plans
    if (p === '/api/plans' && req.method === 'GET') {
      const plans = Object.entries(PLANS).map(([id, pl]) => ({
        id, label: pl.label,
        amount: pl.amount,            // tiyin
        amountSom: Math.round(pl.amount / 100),
        period: pl.period
      }));
      return send(res, 200, { plans });
    }

    // POST /api/payment/create — create a payment order and return Payme + Click checkout URLs
    if (p === '/api/payment/create' && req.method === 'POST') {
      const b = await readJson(req);
      const { planId, userId, userType } = b; // userType: 'teacher' | 'student'
      const plan = PLANS[planId];
      if (!plan) return send(res, 400, { error: "Noto'g'ri tarif" });
      if (!userId) return send(res, 400, { error: 'userId kerak' });

      const orderId = 'pay-' + uid();
      const payment = {
        id: orderId, planId, userId, userType: userType || 'student',
        amount: plan.amount, status: 'pending',
        createdAt: Date.now(), paidAt: null
      };
      db.payments.push(payment);
      saveDb();

      // --- Payme checkout URL ---
      const paymeParams = Buffer.from(JSON.stringify({
        m: PAYME_ID, ac: { order_id: orderId }, a: plan.amount, l: 'uz',
        c: `${SITE_URL}/api/payment/payme/callback`,
        cr: `${SITE_URL}/payment/success?order=${orderId}`
      })).toString('base64');
      const paymeUrl = PAYME_ID
        ? `https://checkout.paycom.uz/${paymeParams}`
        : `${SITE_URL}/payment/demo?order=${orderId}&method=payme`;

      // --- Click checkout URL ---
      const clickUrl = CLICK_SID && CLICK_MERCHANT
        ? `https://my.click.uz/services/pay?service_id=${CLICK_SID}&merchant_id=${CLICK_MERCHANT}&amount=${Math.round(plan.amount / 100)}&transaction_param=${orderId}&return_url=${encodeURIComponent(SITE_URL + '/payment/success?order=' + orderId)}`
        : `${SITE_URL}/payment/demo?order=${orderId}&method=click`;

      return send(res, 200, { ok: true, orderId, paymeUrl, clickUrl, amount: plan.amount, amountSom: Math.round(plan.amount / 100), plan: plan.label });
    }

    // POST /api/payment/payme/callback — Payme server-to-server notifications
    if (p === '/api/payment/payme/callback' && req.method === 'POST') {
      const b = await readJson(req);
      // Basic auth check
      const auth = req.headers['authorization'] || '';
      const expectedAuth = 'Basic ' + Buffer.from(`Paycom:${PAYME_KEY}`).toString('base64');
      if (PAYME_KEY && auth !== expectedAuth) return send(res, 200, { error: { code: -32504, message: 'Insufficient privilege' } });

      const method = b.method;
      const params = b.params || {};
      const orderId = (params.account && params.account.order_id) || '';
      const payment = orderId ? db.payments.find(p => p.id === orderId) : null;

      if (method === 'CheckPerformTransaction') {
        if (!payment) return send(res, 200, { result: { allow: false }, id: b.id });
        return send(res, 200, { result: { allow: true }, id: b.id });
      }
      if (method === 'CreateTransaction') {
        if (!payment) return send(res, 200, { error: { code: -31050, message: 'Order not found' }, id: b.id });
        payment.paymeTransactionId = params.id;
        payment.status = 'created';
        saveDb();
        return send(res, 200, { result: { create_time: Date.now(), transaction: params.id, state: 1 }, id: b.id });
      }
      if (method === 'PerformTransaction') {
        if (!payment) return send(res, 200, { error: { code: -31050, message: 'Order not found' }, id: b.id });
        payment.status = 'paid'; payment.paidAt = Date.now();
        activateSubscription(payment);
        saveDb();
        return send(res, 200, { result: { transaction: params.id, perform_time: Date.now(), state: 2 }, id: b.id });
      }
      if (method === 'CancelTransaction') {
        if (payment && payment.status !== 'paid') { payment.status = 'cancelled'; saveDb(); }
        return send(res, 200, { result: { transaction: params.id, cancel_time: Date.now(), state: -1 }, id: b.id });
      }
      if (method === 'CheckTransaction') {
        if (!payment) return send(res, 200, { error: { code: -31050, message: 'Order not found' }, id: b.id });
        const stateMap = { pending: 1, created: 1, paid: 2, cancelled: -1 };
        return send(res, 200, { result: { create_time: payment.createdAt, perform_time: payment.paidAt || 0, cancel_time: 0, transaction: payment.paymeTransactionId || '', state: stateMap[payment.status] || 1 }, id: b.id });
      }
      return send(res, 200, { error: { code: -32601, message: 'Method not found' }, id: b.id });
    }

    // POST /api/payment/click/prepare — Click prepare step
    if (p === '/api/payment/click/prepare' && req.method === 'POST') {
      const b = await readJson(req);
      const { click_trans_id, merchant_trans_id, amount, sign_time, sign_string } = b;
      const orderId = merchant_trans_id;
      const payment = orderId ? db.payments.find(p => p.id === orderId) : null;
      if (!payment) return send(res, 200, { error: -5, error_note: 'User not found' });
      const expectSign = crypto.createHash('md5').update(`${click_trans_id}${CLICK_SID}${CLICK_KEY}${orderId}${amount}${0}${sign_time}`).digest('hex');
      if (CLICK_KEY && sign_string !== expectSign) return send(res, 200, { error: -1, error_note: 'SIGN CHECK FAILED' });
      payment.clickTransId = click_trans_id;
      saveDb();
      return send(res, 200, { click_trans_id, merchant_trans_id, merchant_prepare_id: orderId, error: 0, error_note: 'Success' });
    }

    // POST /api/payment/click/complete — Click complete step
    if (p === '/api/payment/click/complete' && req.method === 'POST') {
      const b = await readJson(req);
      const { click_trans_id, merchant_trans_id, merchant_prepare_id, amount, sign_time, sign_string, error } = b;
      const orderId = merchant_trans_id;
      const payment = orderId ? db.payments.find(p => p.id === orderId) : null;
      if (!payment) return send(res, 200, { error: -5, error_note: 'User not found' });
      if (error < 0) { payment.status = 'cancelled'; saveDb(); return send(res, 200, { click_trans_id, merchant_trans_id, merchant_confirm_id: orderId, error: 0, error_note: 'Cancelled' }); }
      const expectSign = crypto.createHash('md5').update(`${click_trans_id}${CLICK_SID}${CLICK_KEY}${orderId}${amount}${merchant_prepare_id}${sign_time}`).digest('hex');
      if (CLICK_KEY && sign_string !== expectSign) return send(res, 200, { error: -1, error_note: 'SIGN CHECK FAILED' });
      payment.status = 'paid'; payment.paidAt = Date.now();
      activateSubscription(payment);
      saveDb();
      return send(res, 200, { click_trans_id, merchant_trans_id, merchant_confirm_id: orderId, error: 0, error_note: 'Success' });
    }

    // GET /api/payment/status/:orderId
    if (p.match(/^\/api\/payment\/status\/[^/]+$/) && req.method === 'GET') {
      const orderId = safeId(p.split('/')[4]);
      const payment = db.payments.find(x => x.id === orderId);
      if (!payment) return send(res, 404, { error: 'Topilmadi' });
      return send(res, 200, { status: payment.status, paidAt: payment.paidAt, plan: PLANS[payment.planId]?.label });
    }

    // GET /api/subscription/status?userId=...&userType=...
    if (p === '/api/subscription/status' && req.method === 'GET') {
      const userId = safeId(url.searchParams.get('userId') || '');
      const userType = url.searchParams.get('userType') || 'student';
      if (!userId) return send(res, 400, { error: 'userId kerak' });
      const sub = getSubscription(userId, userType);
      return send(res, 200, sub);
    }
    // ---------------- DEMO PAYMENT CONFIRM ----------------
    // GET/POST /api/payment/demo/confirm?order=... – simulate successful payment in demo mode
    if (p === '/api/payment/demo/confirm') {
      const orderId = safeId(url.searchParams.get('order') || '');
      const payment = orderId ? db.payments.find(p => p.id === orderId) : null;
      if (!payment) return send(res, 404, { error: 'Buyurtma topilmadi' });
      payment.status = 'paid';
      payment.paidAt = Date.now();
      activateSubscription(payment);
      saveDb();
      return send(res, 200, { ok: true, status: 'paid', orderId, plan: PLANS[payment.planId]?.label });
    }

    // ---------------- DEBUG ENDPOINT ----------------
    // POST /api/debug/activate-subscription – manually activate a subscription for a test user
    // Body: { userId: string, userType: "teacher"|"student", planId: string }
    if (p === '/api/debug/activate-subscription' && req.method === 'POST') {
      const b = await readJson(req);
      const { userId, userType, planId } = b;
      if (!userId || !planId) return send(res, 400, { error: 'userId and planId required' });
      const payment = { id: 'debug-' + uid(), userId, userType, planId, status: 'paid', paidAt: Date.now() };
      activateSubscription(payment);
      db.payments.push(payment);
      saveDb();
      return send(res, 200, { ok: true, message: 'Subscription activated for test user' });
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'not_found' });

    // static files
    let rel = decodeURIComponent(p);
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel === '/admin')           rel = '/admin.html';
    if (rel === '/teacher')         rel = '/teacher.html';
    if (rel === '/payment')         rel = '/payment.html';
    if (rel === '/payment/success') rel = '/payment.html';
    if (rel === '/payment/demo')    rel = '/payment.html';
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
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`O'qituvchi paneli: http://localhost:${PORT}/teacher.html`);
  console.log(KEY && !MOCK ? `AI: ${MODEL} (Gemini)` : "AI: kalitsiz rejim — javoblar dars matnidan. Gemini uchun GEMINI_API_KEY bering.");
});
