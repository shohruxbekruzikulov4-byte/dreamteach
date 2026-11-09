/* DreamTeach cloud adapters.
   server   – our Node server (api/*): Gemini 2.5 Flash answers, quiz generation, sync, video upload.
   artifact – the hosted demo page: Claude via the page runtime for AI, the page's private store for sync.
   none     – no backend reachable: everything stays on the device until one appears. */
(function (root) {
  'use strict';
  var E = root.DTEngine;

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]);
  }

  var TUTOR_RULES =
    'Siz DreamTeach platformasidagi AI ustozsiz. Faqat berilgan dars matniga tayanib, o‘zbek tilida (lotin yozuvida) ' +
    'qisqa va aniq javob bering: 2–5 gap. Har bir fikrdan keyin dars matnidagi vaqtni [mm:ss] ko‘rinishida yozing. ' +
    'Agar javob dars matnida bo‘lmasa, buni ochiq ayting va qaysi mavzuni qayta ko‘rishni maslahat bering. ' +
    'To‘qima ma’lumot qo‘shmang. Markdown ishlatmang.';
  var MENTOR_RULES =
    'Siz kompaniyaning shaxsiy AI mentorisiz. Faqat berilgan ichki hujjatlarga tayanib, o‘zbek tilida qisqa javob bering. ' +
    'Har bir fikrdan keyin manbani [Hujjat nomi, N-qism] ko‘rinishida yozing. Hujjatlarda javob bo‘lmasa, ochiq ayting. Markdown ishlatmang.';
  var QUIZ_RULES =
    'Berilgan dars matni asosida o‘zbek tilida test tuzing. Faqat JSON qaytaring: ' +
    '{"questions":[{"q":"savol","options":["A","B","C","D"],"answer":0,"t":12}]} — answer to‘g‘ri variant indeksi (0–3), ' +
    't — javob topiladigan joyning soniyasi. Variantlar qisqa, faqat bittasi to‘g‘ri, barchasi dars matnidan.';

  function transcriptText(segments) {
    return segments.map(function (s) { return '[' + E.mmss(s.t) + '] ' + s.text; }).join('\n');
  }
  function docsText(passages) {
    return passages.map(function (p) { return '[' + p.doc + ', ' + p.part + '-qism] ' + p.text; }).join('\n');
  }

  var Cloud = {
    mode: 'none', ai: false, sync: false, label: 'Ulanmagan', detail: '',
    _sample: null, _db: null, _uid: null, detected: false,

    detect: function () {
      return withTimeout(fetch('api/health', { cache: 'no-store' }), 3000)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (j) {
          if (j && j.ok && j.app === 'dreamteach') {
            Cloud.mode = 'server'; Cloud.ai = !!j.ai; Cloud.sync = true;
            Cloud.label = 'DreamTeach server'; Cloud.detail = j.ai ? ('AI: ' + (j.model || 'Gemini')) : 'AI kaliti qo‘shilmagan';
            return Cloud;
          }
          if (!root.claude || typeof root.claude.use !== 'function') return Cloud;
          return Promise.all([root.claude.use('sample'), root.claude.use('db'), root.claude.use('user')])
            .then(function (r) {
              Cloud._sample = r[0]; Cloud._db = r[1];
              var u = r[2];
              return (u && u.id ? u.id().catch(function () { return null; }) : Promise.resolve(null)).then(function (id) {
                Cloud._uid = id;
                if (Cloud._sample || (Cloud._db && id)) {
                  Cloud.mode = 'artifact'; Cloud.ai = !!Cloud._sample; Cloud.sync = !!(Cloud._db && id);
                  Cloud.label = 'Demo bulut'; Cloud.detail = Cloud.ai ? 'AI: Claude (demo sahifa)' : 'AI ulanmagan';
                }
                return Cloud;
              });
            })
            .catch(function () { return Cloud; });
        })
        .then(function (c) { Cloud.detected = true; return c; });
    },

    post: function (path, body, ms) {
      return withTimeout(fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ms || 30000)
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error || ('HTTP ' + r.status)); return j; }); });
    },

    ask: function (question, lesson, history) {
      if (Cloud.mode === 'server') {
        return Cloud.post('api/ask', { question: question, title: lesson.title, segments: lesson.segments, history: history || [] })
          .then(function (j) { return j.text; });
      }
      if (Cloud.mode === 'artifact' && Cloud._sample) {
        var prompt = TUTOR_RULES + '\n\nDars: ' + lesson.title + '\nDars matni:\n' + transcriptText(lesson.segments) +
          '\n\nO‘quvchi savoli: ' + question;
        return Cloud._sample(prompt, { modelTier: 'quick', cache: false }).then(function (r) { return r.text; });
      }
      return Promise.reject(new Error('ai_unavailable'));
    },

    mentor: function (question, passages) {
      if (Cloud.mode === 'server') {
        return Cloud.post('api/mentor', { question: question, passages: passages }).then(function (j) { return j.text; });
      }
      if (Cloud.mode === 'artifact' && Cloud._sample) {
        var prompt = MENTOR_RULES + '\n\nIchki hujjatlar:\n' + docsText(passages) + '\n\nXodim savoli: ' + question;
        return Cloud._sample(prompt, { modelTier: 'quick', cache: false }).then(function (r) { return r.text; });
      }
      return Promise.reject(new Error('ai_unavailable'));
    },

    quiz: function (lesson, n) {
      var shape = function (arr) {
        return (arr || []).filter(function (q) { return q && q.q && q.options && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length; })
          .slice(0, n || 5).map(function (q) {
            return { type: 'ai', prompt: String(q.q), options: q.options.map(String), answer: q.answer | 0, t: Math.max(0, +q.t || 0), explain: '' };
          });
      };
      if (Cloud.mode === 'server') {
        return Cloud.post('api/quiz', { title: lesson.title, segments: lesson.segments, terms: lesson.terms || [], n: n || 5 }, 45000).then(function (j) { return shape(j.questions); });
      }
      if (Cloud.mode === 'artifact' && Cloud._sample) {
        var prompt = QUIZ_RULES + '\nSavollar soni: ' + (n || 5) + '\n\nDars: ' + lesson.title + '\nDars matni:\n' + transcriptText(lesson.segments);
        return Cloud._sample.json(prompt, { modelTier: 'quick' }).then(function (j) { return shape(j && j.questions); });
      }
      return Promise.reject(new Error('ai_unavailable'));
    },

    pushEvents: function (events, device) {
      if (Cloud.mode === 'server') {
        return Cloud.post('api/sync', { device: device, events: events }).then(function (j) { return j.accepted || events.length; });
      }
      if (Cloud.mode === 'artifact' && Cloud._db && Cloud._uid) {
        var id = 'sync-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
        var slim = events.map(function (e) { return { id: e.id, type: e.type, ts: e.ts, data: e.data }; });
        return Cloud._db.collection('data/users/' + Cloud._uid).doc(id).set({ at: Date.now(), device: device.id, events: slim })
          .then(function () { return events.length; });
      }
      return Promise.reject(new Error('sync_unavailable'));
    },

    uploadVideo: function (lessonId, blob) {
      if (Cloud.mode !== 'server') return Promise.resolve(null);
      return withTimeout(fetch('api/upload?id=' + encodeURIComponent(lessonId), {
        method: 'POST', headers: { 'Content-Type': blob.type || 'video/mp4' }, body: blob
      }), 300000).then(function (r) { return r.json(); }).then(function (j) { return j.url || null; });
    },

    catalog: function () {
      if (Cloud.mode !== 'server') return Promise.resolve(null);
      return withTimeout(fetch('api/catalog', { cache: 'no-store' }), 5000).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
  };
  root.DTCloud = Cloud;
})(window);
