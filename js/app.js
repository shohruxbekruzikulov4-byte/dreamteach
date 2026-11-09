/* DreamTeach — offline-first learning app (UI). Depends on DTEngine, DTStore, DTCloud. */
(function () {
  'use strict';
  var E = window.DTEngine, Store = window.DTStore, Cloud = window.DTCloud;
  var Q = '‘', A = '’';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var app = $('#app');

  /* ---------------- icons ---------------- */
  var SV = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var I = {
    down: SV + '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>',
    check: SV + '<path d="M4 12.5l5 5L20 6.5"/></svg>',
    trash: SV + '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    play: SV + '<path d="M7 4.5v15l12-7.5z"/></svg>',
    off: SV + '<path d="M2 8.8a15 15 0 0 1 4.4-2.9M10 5.1A15 15 0 0 1 22 8.8M5 12.5a10 10 0 0 1 3.4-2.2M16 10.6a10 10 0 0 1 3 1.9M8.5 16a5 5 0 0 1 7 0M3 3l18 18"/></svg>',
    wifi: SV + '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
    send: SV + '<path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>',
    text: SV + '<path d="M5 6h14M5 10h14M5 14h10M5 18h7"/></svg>',
    film: SV + '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/></svg>',
    sync: SV + '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5"/></svg>',
    spark: SV + '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
    clock: SV + '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function mmss(t) { return E.mmss(t); }
  function fmtKB(kb) { return kb >= 1024 ? (kb / 1024).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(kb)) + ' KB'; }
  function fmtNum(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function ago(ts) {
    if (!ts) return '—';
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'hozirgina'; if (s < 3600) return Math.round(s / 60) + ' daqiqa oldin';
    if (s < 86400) return Math.round(s / 3600) + ' soat oldin'; return Math.round(s / 86400) + ' kun oldin';
  }
  var ACC = { '#00E5FF': 'cyan', '#FFD700': 'yellow', '#00FF94': 'green', '#B07CFF': 'purple', '#FF7A45': 'orange' };
  function accOf(c) { return 'acc-' + (ACC[(c && c.color || '').toUpperCase()] || 'purple'); }

  /* ---------------- state ---------------- */
  var S = {
    base: null, courses: {}, courseList: [], lessons: {}, media: {}, progress: {}, quizBest: {}, userLessons: [], remoteLessons: [],
    profile: { name: 'Mehmon o‘quvchi', device: null }, simOffline: false, outbox: 0, syncing: false, lastSync: 0,
    downloading: {}, route: { v: 'kurslar', id: '' }, cur: null, days: {}, installEvt: null
  };
  function isOnline() { return !S.simOffline && navigator.onLine !== false; }
  function canCloud() { return isOnline() && Cloud.mode !== 'none'; }

  /* ---------------- toasts ---------------- */
  function toast(msg, kind) {
    var box = $('#toasts'), el = document.createElement('div');
    el.className = 'toast ' + (kind || ''); el.textContent = msg; box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(function () { el.remove(); }, 4200);
  }

  /* ---------------- catalog ---------------- */
  function loadCatalog() {
    var net = isOnline() ? fetch('data/courses.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }) : Promise.reject(0);
    return net.then(function (j) { Store.put('kv', 'catalog', j); return j; })
      .catch(function () { return Store.get('kv', 'catalog'); })
      .then(function (j) { S.base = j || { courses: [], company: null, authorSample: null }; });
  }
  function indexCatalog() {
    S.courses = {}; S.courseList = []; S.lessons = {};
    function addCourse(c) {
      if (!S.courses[c.id]) { S.courses[c.id] = c; S.courseList.push(c); }
      return S.courses[c.id];
    }
    (S.base.courses || []).forEach(function (c) {
      c = Object.assign({}, c, { lessons: c.lessons.slice() }); addCourse(c);
      c.lessons.forEach(function (l) { l.courseId = c.id; S.lessons[l.id] = l; });
    });
    S.userLessons.concat(S.remoteLessons).forEach(function (l) {
      if (S.lessons[l.id]) return;
      var c = S.courses[l.courseId] || addCourse({ id: l.courseId, title: l.courseTitle || 'Mualliflar darslari', author: l.author || 'Muallif',
        level: 'Muallif kursi', color: '#B07CFF', about: 'Mualliflar marketpleysidan yangi dars.', lessons: [], userMade: true });
      if (c.lessons.indexOf(l) < 0) c.lessons.push(l);
      S.lessons[l.id] = l;
    });
  }
  function courseSizeKB(c) { return c.lessons.reduce(function (a, l) { return a + (l.video ? (l.sizeKB || 0) : 0); }, 0); }
  function courseVideoLessons(c) { return c.lessons.filter(function (l) { return l.video || S.media[l.id]; }); }
  function courseDownloaded(c) { var v = courseVideoLessons(c); return v.length > 0 && v.every(function (l) { return S.media[l.id]; }); }
  function courseProgress(c) {
    if (!c.lessons.length) return 0;
    var done = c.lessons.filter(function (l) { return S.progress[l.id] && S.progress[l.id].done; }).length;
    return Math.round(done / c.lessons.length * 100);
  }

  /* ---------------- outbox / sync ---------------- */
  function addEvent(type, data, key) {
    var ev = { id: key || ('e-' + uid()), type: type, ts: Date.now(), data: data, user: S.profile.name };
    S.days[today()] = 1; Store.put('kv', 'days', S.days);
    return Store.put('outbox', ev.id, ev).then(refreshOutbox).then(function () { if (canCloud()) scheduleFlush(800); });
  }
  function refreshOutbox() { return Store.all('outbox').then(function (rows) { S.outbox = rows.length; paintStatus(); return rows; }); }
  var flushT = null;
  function scheduleFlush(ms) { clearTimeout(flushT); flushT = setTimeout(flush, ms || 500); }
  function flush(manual) {
    if (S.syncing) return Promise.resolve();
    if (!canCloud() || !Cloud.sync) { if (manual) toast(isOnline() ? 'Server ulanmagan: natijalar qurilmada xavfsiz saqlanmoqda.' : 'Internet yo‘q. Natijalar internet qaytganda yuboriladi.', 'warn'); return Promise.resolve(); }
    S.syncing = true; paintStatus();
    return Store.all('outbox').then(function (rows) {
      var evs = rows.map(function (r) { return r.value; }).sort(function (a, b) { return a.ts - b.ts; });
      if (!evs.length) return 0;
      return uploadPendingVideos(evs).then(function () {
        return Cloud.pushEvents(evs, { id: S.profile.device, name: S.profile.name });
      }).then(function () {
        return Promise.all(evs.map(function (e) { return Store.del('outbox', e.id); })).then(function () { return evs.length; });
      });
    }).then(function (n) {
      S.syncing = false; S.lastSync = Date.now(); Store.put('kv', 'lastSync', S.lastSync);
      if (n) toast(n + ' ta natija serverga yuborildi. Hammasi sinxronlandi.', 'ok');
      else if (manual) toast('Yuboriladigan yangi natija yo‘q.', 'ok');
      return refreshOutbox();
    }).catch(function (e) {
      S.syncing = false; paintStatus();
      if (manual) toast('Sinxronlab bo‘lmadi (' + (e && e.message || 'xato') + '). Keyinroq avtomatik qayta urinamiz.', 'warn');
    }).then(function () { if (S.route.v === 'natijalar') render(); });
  }
  function uploadPendingVideos(evs) {
    var jobs = evs.filter(function (e) { return e.type === 'lesson_published' && !e.data.videoUrl && e.data.hasLocalVideo; });
    if (Cloud.mode !== 'server' || !jobs.length) return Promise.resolve();
    return jobs.reduce(function (p, e) {
      return p.then(function () {
        return Store.get('media', e.data.id).then(function (m) {
          if (!m || !m.blob) return;
          return Cloud.uploadVideo(e.data.id, m.blob).then(function (url) {
            if (!url) return;
            e.data.videoUrl = url;
            var l = S.userLessons.filter(function (x) { return x.id === e.data.id; })[0];
            if (l) { l.video = url; l.status = 'uploaded'; Store.put('lessons', l.id, l); }
            return Store.put('outbox', e.id, e);
          });
        });
      });
    }, Promise.resolve());
  }

  /* ---------------- connectivity ---------------- */
  function paintStatus() {
    var on = isOnline(), btn = $('#statusBtn');
    btn.classList.toggle('off', !on);
    $('#statusText').textContent = on ? 'Onlayn' : 'Oflayn';
    $('#statusQ').textContent = S.syncing ? '· sinxronlanmoqda' : (S.outbox ? '· ' + S.outbox + ' ta kutmoqda' : (on && Cloud.sync ? '· sinxron' : ''));
    var sb = $('#simBtn'); sb.setAttribute('aria-pressed', S.simOffline ? 'true' : 'false');
    sb.classList.toggle('warn', S.simOffline);
    $('#simLbl').textContent = S.simOffline ? 'Internetni qaytarish' : 'Oflayn rejimni sinash';
  }
  function netChanged(wasOnline) {
    var on = isOnline();
    paintStatus();
    if (on === wasOnline) return;
    if (!on) toast('Internet yo‘q. Oflayn rejim: yuklab olingan darslar, test va AI ustoz ishlashda davom etadi.', 'warn');
    else {
      toast('Internet qaytdi. Natijalar serverga yuborilmoqda…', 'ok');
      (Cloud.mode === 'none' ? Cloud.detect() : Promise.resolve()).then(function () { paintStatus(); if (S.cur) paintChips(); flush(); processPending(); });
    }
    if (S.route.v === 'dars' && S.cur) refreshLessonSource(); else render();
  }
  window.addEventListener('online', function () { netChanged(false); });
  window.addEventListener('offline', function () { netChanged(true); });
  $('#simBtn').addEventListener('click', function () { var was = isOnline(); S.simOffline = !S.simOffline; netChanged(was); });
  $('#statusBtn').addEventListener('click', function () { location.hash = 'natijalar'; });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvt = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', function () {
    if (!S.installEvt) return; S.installEvt.prompt();
    S.installEvt.userChoice.finally(function () { S.installEvt = null; $('#installBtn').hidden = true; });
  });

  /* ---------------- downloads ---------------- */
  function downloadCourse(cid) {
    var c = S.courses[cid]; if (!c || S.downloading[cid]) return;
    if (!isOnline()) { toast('Yuklab olish uchun internet kerak. Wi-Fi bor joyda bir marta yuklab oling.', 'warn'); return; }
    var todo = c.lessons.filter(function (l) { return l.video && !S.media[l.id]; });
    var total = todo.reduce(function (a, l) { return a + (l.sizeKB || 200) * 1024; }, 0) || 1, got = 0;
    S.downloading[cid] = 0.01; render();
    todo.reduce(function (p, l) {
      return p.then(function () {
        return fetch(l.video).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var type = r.headers.get('content-type') || 'video/mp4';
          if (!r.body || !r.body.getReader) return r.blob().then(function (b) { got += b.size; return b; });
          var reader = r.body.getReader(), parts = [];
          function pump() {
            return reader.read().then(function (x) {
              if (x.done) return new Blob(parts, { type: type });
              parts.push(x.value); got += x.value.length; S.downloading[cid] = Math.min(.99, got / total); paintDl(cid);
              return pump();
            });
          }
          return pump();
        }).then(function (blob) {
          S.media[l.id] = { size: blob.size };
          return Store.put('media', l.id, { blob: blob, size: blob.size, type: blob.type, at: Date.now() });
        });
      });
    }, Promise.resolve()).then(function () {
      delete S.downloading[cid];
      addEvent('course_downloaded', { courseId: cid });
      toast('“' + c.title + '” yuklab olindi. Endi internetsiz ishlaydi.', 'ok'); render();
    }).catch(function (e) {
      delete S.downloading[cid]; toast('Yuklab olish to‘xtadi: ' + (e.message || 'internet uzildi') + '. Qayta urinib ko‘ring.', 'warn'); render();
    });
  }
  function paintDl(cid) {
    var el = document.querySelector('[data-dlbar="' + cid + '"]');
    if (el) el.style.width = Math.round((S.downloading[cid] || 0) * 100) + '%';
    var t = document.querySelector('[data-dlpct="' + cid + '"]');
    if (t) t.textContent = Math.round((S.downloading[cid] || 0) * 100) + '%';
  }
  function removeDownload(cid) {
    var c = S.courses[cid];
    Promise.all(c.lessons.filter(function (l) { return l.video && S.media[l.id]; }).map(function (l) { delete S.media[l.id]; return Store.del('media', l.id); }))
      .then(function () { toast('Videolar qurilmadan o‘chirildi. Matn, test va natijalar saqlanib qoldi.'); render(); });
  }

  /* ---------------- router ---------------- */
  function parseHash() {
    var h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (h.indexOf('dars-') === 0) return { v: 'dars', id: h.slice(5) };
    if (h.indexOf('kurs-') === 0) return { v: 'kurs', id: h.slice(5) };
    if (['natijalar', 'muallif', 'kompaniya'].indexOf(h) >= 0) return { v: h, id: '' };
    return { v: 'kurslar', id: '' };
  }
  window.addEventListener('hashchange', function () { leaveLesson(); S.route = parseHash(); render(); window.scrollTo(0, 0); });
  function paintNav() {
    var key = S.route.v === 'kurs' || S.route.v === 'dars' ? 'kurslar' : S.route.v;
    document.querySelectorAll('[data-r]').forEach(function (a) { if (a.dataset.r === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  function render() {
    paintNav(); paintStatus();
    var v = S.route.v;
    if (v === 'kurs') return viewCourse(S.route.id);
    if (v === 'dars') return viewLesson(S.route.id);
    if (v === 'natijalar') return viewProgress();
    if (v === 'muallif') return viewAuthor();
    if (v === 'kompaniya') return viewCompany();
    return viewHome();
  }

  /* ---------------- views: home ---------------- */
  function offlineBanner() {
    if (isOnline()) return '';
    var n = S.courseList.filter(courseDownloaded).length;
    return '<div class="banner off">' + I.off + '<div><b>Siz oflayn rejimdasiz.</b> <span class="muted">' +
      (n ? n + ' ta kurs videolari bilan to‘liq ishlaydi.' : 'Videolar yuklab olinmagan, lekin matnli darslar, testlar va AI ustoz ishlaydi.') +
      ' Natijalaringiz qurilmada saqlanadi va internet qaytganda o‘zi yuboriladi.</span></div></div>';
  }
  function courseCard(c) {
    var size = courseSizeKB(c), dl = courseDownloaded(c), pct = courseProgress(c), busy = S.downloading[c.id];
    var first = c.lessons[0], poster = first && (first.poster || '');
    var thumb = poster ? '<img src="' + esc(poster) + '" alt="" loading="lazy">' : '<div class="novideo"><div>' + I.text + '<div class="small">' + esc(c.title) + '</div></div></div>';
    var ctrl;
    if (busy) ctrl = '<div style="flex:1;display:grid;gap:6px"><div class="bar"><i data-dlbar="' + c.id + '" style="width:' + Math.round(busy * 100) + '%"></i></div><span class="small muted">Yuklanmoqda <span data-dlpct="' + c.id + '">' + Math.round(busy * 100) + '%</span></span></div>';
    else if (dl) ctrl = '<span class="chip ok">' + I.check + ' Oflayn mavjud</span><button class="btn sm ghost" data-act="undl" data-id="' + c.id + '">' + I.trash + ' O‘chirish</button>';
    else if (size) ctrl = '<button class="btn sm' + (isOnline() ? ' primary' : '') + '" data-act="dl" data-id="' + c.id + '"' + (isOnline() ? '' : ' disabled') + '>' + I.down + ' Yuklab olish · ' + fmtKB(size) + '</button>';
    else ctrl = '<span class="chip">' + I.text + ' Matnli kurs</span>';
    return '<article class="card course ' + accOf(c) + '">' +
      '<a class="thumb" href="#kurs-' + esc(c.id) + '" tabindex="-1">' + thumb + (dl ? '<span class="chip ok badge">' + I.check + ' Oflayn</span>' : '') + '</a>' +
      '<div style="display:grid;gap:6px"><h3><a href="#kurs-' + esc(c.id) + '">' + esc(c.title) + '</a></h3>' +
      '<div class="meta"><span>' + esc(c.author) + '</span><span>' + esc(c.level || '') + '</span><span>' + c.lessons.length + ' ta dars</span></div></div>' +
      '<div style="display:grid;gap:6px"><div class="spread small"><span class="muted">Progress</span><span class="num">' + pct + '%</span></div><div class="bar"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="dl">' + ctrl + '</div></article>';
  }
  function lastLesson() {
    var best = null;
    Object.keys(S.progress).forEach(function (id) { var p = S.progress[id]; if (S.lessons[id] && (!best || p.at > best.at)) best = { id: id, at: p.at, p: p }; });
    return best && S.lessons[best.id] ? best : null;
  }
  function viewHome() {
    var done = Object.keys(S.progress).filter(function (k) { return S.progress[k].done && S.lessons[k]; }).length;
    var offN = S.courseList.filter(courseDownloaded).length;
    var last = lastLesson(), resume = '';
    if (last) {
      var l = S.lessons[last.id], c = S.courses[l.courseId];
      resume = '<section class="card resume ' + accOf(c) + '">' + (l.poster ? '<img src="' + esc(l.poster) + '" alt="">' : '<div></div>') +
        '<div style="display:grid;gap:4px;min-width:0"><span class="small muted">Davom ettirish · ' + esc(c.title) + '</span><h3>' + esc(l.title) + '</h3>' +
        '<div class="bar"><i style="width:' + Math.round(Math.min(1, (last.p.max || 0) / (l.duration || 1)) * 100) + '%"></i></div></div>' +
        '<a class="btn primary" href="#dars-' + esc(l.id) + '">' + I.play + ' Davom etish</a></section>';
    }
    app.innerHTML = '<div class="stack">' + offlineBanner() +
      '<section class="hello"><div style="display:grid;gap:6px"><h1>Salom, ' + esc(S.profile.name) + '!</h1>' +
      '<p class="muted">Kasb ko‘nikmalari bir chashka kofe narxida. Kursni bir marta yuklab oling va internetsiz o‘qing.</p></div>' +
      '<div class="facts"><div class="fact"><b>' + done + '</b><span>yakunlangan dars</span></div><div class="fact"><b>' + offN + '</b><span>oflayn kurs</span></div>' +
      '<div class="fact"><b>' + S.outbox + '</b><span>yuborilishi kutilmoqda</span></div></div></section>' +
      resume +
      '<div class="section-h"><h2>Kurslar</h2><span class="small muted">Matn, test va AI ustoz internetsiz ham ishlaydi</span></div>' +
      '<div class="grid">' + S.courseList.map(courseCard).join('') + '</div></div>';
  }

  /* ---------------- views: course ---------------- */
  function viewCourse(id) {
    var c = S.courses[id];
    if (!c) { app.innerHTML = '<div class="card">Kurs topilmadi. <a href="#kurslar">Kurslarga qaytish</a></div>'; return; }
    var rows = c.lessons.map(function (l, i) {
      var p = S.progress[l.id] || {}, best = S.quizBest[l.id];
      var st = p.done ? '<span class="chip ok">' + I.check + ' Yakunlangan</span>' : (p.max ? '<span class="chip info">' + Math.round(Math.min(1, p.max / (l.duration || 1)) * 100) + '%</span>' : '<span class="chip">Yangi</span>');
      return '<a class="lrow' + (p.done ? ' done' : '') + '" href="#dars-' + esc(l.id) + '"><span class="n">' + (p.done ? '✓' : i + 1) + '</span>' +
        '<div style="min-width:0"><div style="font-weight:650">' + esc(l.title) + '</div><div class="meta"><span class="num">' + mmss(l.duration) + '</span>' +
        (S.media[l.id] ? '<span>' + I.check + ' video qurilmada</span>' : (l.video ? '<span>' + fmtKB(l.sizeKB || 0) + '</span>' : '<span>matnli dars</span>')) +
        (best ? '<span>test: ' + best.score + '/' + best.total + '</span>' : '') + '</div></div>' + st + '</a>';
    }).join('');
    var size = courseSizeKB(c), dl = courseDownloaded(c), busy = S.downloading[c.id];
    var ctrl = busy ? '<span class="chip info">Yuklanmoqda <span data-dlpct="' + c.id + '">' + Math.round(busy * 100) + '%</span></span>' :
      dl ? '<span class="chip ok">' + I.check + ' Oflayn mavjud</span><button class="btn sm ghost" data-act="undl" data-id="' + c.id + '">' + I.trash + ' Videolarni o‘chirish</button>' :
      size ? '<button class="btn primary" data-act="dl" data-id="' + c.id + '"' + (isOnline() ? '' : ' disabled') + '>' + I.down + ' Butun kursni yuklab olish · ' + fmtKB(size) + '</button>' : '';
    app.innerHTML = '<div class="stack ' + accOf(c) + '">' + offlineBanner() +
      '<div class="crumbs"><a href="#kurslar">Kurslar</a><span>/</span><span>' + esc(c.title) + '</span></div>' +
      '<section class="card" style="display:grid;gap:12px"><div class="row"><span class="acc-dot"></span><span class="small muted">' + esc(c.level || '') + ' · ' + esc(c.author) + '</span></div>' +
      '<h1>' + esc(c.title) + '</h1><p class="muted" style="max-width:70ch">' + esc(c.about || '') + '</p>' +
      '<div class="dl">' + ctrl + '<span class="small muted">' + c.lessons.length + ' ta dars · progress ' + courseProgress(c) + '%</span></div></section>' +
      '<div class="lessons">' + rows + '</div></div>';
  }

  /* ---------------- views: lesson workspace ---------------- */
  function leaveLesson() {
    var cur = S.cur; if (!cur) return;
    saveProgress(true);
    if (cur.url && cur.local) { try { URL.revokeObjectURL(cur.url); } catch (e) {} }
    S.cur = null;
  }
  function viewLesson(id) {
    var l = S.lessons[id];
    if (!l) { app.innerHTML = '<div class="card">Dars topilmadi. <a href="#kurslar">Kurslarga qaytish</a></div>'; return; }
    var c = S.courses[l.courseId], idx = c.lessons.indexOf(l), next = c.lessons[idx + 1];
    S.cur = { l: l, tab: (S.cur && S.cur.l === l && S.cur.tab) || 'transkript', textMode: false, quiz: null, url: null, local: false };
    app.innerHTML = '<div class="stack ' + accOf(c) + '">' + offlineBanner() +
      '<div class="crumbs"><a href="#kurslar">Kurslar</a><span>/</span><a href="#kurs-' + esc(c.id) + '">' + esc(c.title) + '</a><span>/</span><span>' + (idx + 1) + '-dars</span></div>' +
      '<div class="spread"><h1>' + esc(l.title) + '</h1><div class="row" id="srcChips"></div></div>' +
      '<div class="work"><div><div id="stage"></div>' +
      '<div class="under"><div class="row"><button class="btn sm" data-act="textmode" id="tmBtn">' + I.text + ' Matnli rejim</button>' +
      '<button class="btn sm" data-act="done">' + I.check + ' Darsni yakunlash</button></div>' +
      (next ? '<a class="btn sm ghost" href="#dars-' + esc(next.id) + '">Keyingi dars: ' + esc(next.title) + ' →</a>' : '<a class="btn sm ghost" href="#kurs-' + esc(c.id) + '">Kurs sahifasi</a>') + '</div></div>' +
      '<section class="panel" aria-label="O‘quv paneli"><div class="tabs" role="tablist" id="tabs"></div><div class="pane" id="pane"></div></section></div></div>';
    paintTabs(); refreshLessonSource(); paintPane();
  }
  function lessonVideo() { return document.querySelector('#stage video'); }
  function refreshLessonSource() {
    var cur = S.cur; if (!cur) return;
    var l = cur.l, keepT = lessonVideo() ? lessonVideo().currentTime : ((S.progress[l.id] || {}).pos || 0);
    if (cur.url && cur.local) { try { URL.revokeObjectURL(cur.url); } catch (e) {} }
    cur.url = null; cur.local = false;
    Store.get('media', l.id).then(function (m) {
      if (S.cur !== cur) return;
      if (m && m.blob) { cur.url = URL.createObjectURL(m.blob); cur.local = true; }
      else if (isOnline() && l.video) { cur.url = l.video; cur.local = false; }
      paintStage(keepT); paintChips();
    });
  }
  function paintChips() {
    var cur = S.cur, el = $('#srcChips'); if (!el || !cur) return;
    var chips = [];
    if (cur.textMode || !cur.url) chips.push('<span class="chip info">' + I.text + ' Matnli rejim</span>');
    else chips.push(cur.local ? '<span class="chip ok">' + I.check + ' Video qurilmada (internetsiz)</span>' : '<span class="chip">' + I.wifi + ' Onlayn oqim</span>');
    chips.push(isOnline() && Cloud.ai ? '<span class="chip info">' + I.spark + ' AI: onlayn</span>' : '<span class="chip warn">' + I.spark + ' AI: oflayn rejim</span>');
    el.innerHTML = chips.join('');
    var tb = $('#tmBtn'); if (tb) tb.innerHTML = (cur.textMode ? I.film + ' Video rejim' : I.text + ' Matnli rejim');
  }
  function paintStage(t0) {
    var cur = S.cur, st = $('#stage'); if (!st || !cur) return;
    var l = cur.l;
    if (cur.textMode || !cur.url) {
      var why = cur.textMode ? '' : (l.video ? '<div class="banner off" style="margin-bottom:12px">' + I.off + '<div><b>Bu dars videosi qurilmada yo‘q.</b> <span class="muted">Internet bo‘lganda kursni yuklab oling. Hozircha darsni matn shaklida o‘qing — test va AI ustoz to‘liq ishlaydi.</span></div></div>' : '');
      st.innerHTML = why + '<div class="reader" id="reader">' + l.segments.map(function (s, i) {
        return '<p data-i="' + i + '"><button class="tc" data-act="seek" data-t="' + s.t + '">' + mmss(s.t) + '</button>' + esc(s.text) + '</p>';
      }).join('') + '<div><button class="btn sm primary" data-act="done">' + I.check + ' O‘qib chiqdim</button></div></div>';
      return;
    }
    st.innerHTML = '<div class="player"><video controls playsinline preload="metadata"' + (l.poster ? ' poster="' + esc(l.poster) + '"' : '') + '></video></div>';
    var v = lessonVideo();
    v.src = cur.url;
    v.addEventListener('loadedmetadata', function () { if (t0 && t0 < (v.duration || 0) - 2) v.currentTime = t0; }, { once: true });
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('pause', function () { saveProgress(true); });
    v.addEventListener('ended', function () { saveProgress(true); });
    v.addEventListener('error', function () {
      // Some hosts refuse local video blobs; fall back to streaming when the network is really there.
      if (cur.local && navigator.onLine && l.video && cur.url !== l.video) { cur.url = l.video; cur.local = false; v.src = l.video; paintChips(); }
      else if (!cur.textMode) { cur.url = null; paintStage(); paintChips(); }
    });
  }
  var lastSave = 0;
  function onTime() {
    var v = lessonVideo(), cur = S.cur; if (!v || !cur) return;
    var t = v.currentTime, segs = cur.l.segments, ai = 0;
    for (var i = 0; i < segs.length; i++) if (segs[i].t <= t + 0.2) ai = i;
    if (cur.activeSeg !== ai) {
      cur.activeSeg = ai;
      document.querySelectorAll('.seg').forEach(function (el) { el.classList.toggle('on', +el.dataset.i === ai); });
      var on = document.querySelector('.seg.on'), pane = $('#pane');
      if (on && pane && cur.tab === 'transkript') { var r = on.getBoundingClientRect(), pr = pane.getBoundingClientRect(); if (r.top < pr.top || r.bottom > pr.bottom) pane.scrollTop += r.top - pr.top - 40; }
    }
    var p = S.progress[cur.l.id] = S.progress[cur.l.id] || { pos: 0, max: 0, done: false };
    p.pos = t; p.max = Math.max(p.max || 0, t);
    if (!p.done && p.max >= (cur.l.duration || v.duration || 1) * 0.9) markDone(cur.l, 'video');
    if (Date.now() - lastSave > 5000) saveProgress(false);
  }
  function saveProgress(queue) {
    var cur = S.cur; if (!cur) return;
    var l = cur.l, p = S.progress[l.id]; if (!p) return;
    p.at = Date.now(); lastSave = Date.now();
    Store.put('progress', l.id, p);
    if (queue && p.max > 1) addEvent('progress', { lessonId: l.id, pos: Math.round(p.pos), max: Math.round(p.max), done: !!p.done }, 'p:' + l.id);
  }
  function markDone(l, how) {
    var p = S.progress[l.id] = S.progress[l.id] || { pos: 0, max: 0 };
    if (p.done) { if (how !== 'video') toast('Bu dars allaqachon yakunlangan.'); return; }
    p.done = true; p.at = Date.now();
    Store.put('progress', l.id, p);
    addEvent('lesson_done', { lessonId: l.id, how: how }, 'd:' + l.id);
    toast('Dars yakunlandi: “' + l.title + '”. ' + (isOnline() ? '' : 'Natija internet qaytganda yuboriladi.'), 'ok');
  }

  /* tabs */
  var TABS = [['transkript', 'Transkript'], ['ai', 'AI ustoz'], ['test', 'Test'], ['konspekt', 'Konspekt']];
  function paintTabs() {
    var cur = S.cur, el = $('#tabs'); if (!el || !cur) return;
    Store.get('chat', cur.l.id).then(function (msgs) {
      var pend = (msgs || []).filter(function (m) { return m.mode === 'pending'; }).length;
      el.innerHTML = TABS.map(function (t) {
        return '<button role="tab" data-act="tab" data-tab="' + t[0] + '" aria-selected="' + (cur.tab === t[0]) + '">' + t[1] +
          (t[0] === 'ai' && pend ? '<span class="cnt">' + pend + '</span>' : '') + '</button>';
      }).join('');
    });
  }
  function paintPane() {
    var cur = S.cur, pane = $('#pane'); if (!pane || !cur) return;
    pane.style.padding = cur.tab === 'ai' ? '0' : '';
    if (cur.tab === 'transkript') {
      pane.innerHTML = '<div class="segs">' + cur.l.segments.map(function (s, i) {
        return '<div class="seg' + (cur.activeSeg === i ? ' on' : '') + '" data-act="seek" data-t="' + s.t + '" data-i="' + i + '"><span class="t">' + mmss(s.t) + '</span><span>' + esc(s.text) + '</span></div>';
      }).join('') + '</div>';
    } else if (cur.tab === 'ai') paintChat();
    else if (cur.tab === 'test') paintQuiz();
    else paintNotes();
  }
  function seek(t) {
    var v = lessonVideo(), cur = S.cur;
    if (v) { v.currentTime = t; v.play().catch(function () {}); v.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    var r = $('#reader'); if (!r || !cur) return;
    var idx = 0; cur.l.segments.forEach(function (s, i) { if (s.t <= t) idx = i; });
    var p = r.querySelector('p[data-i="' + idx + '"]');
    if (p) { r.querySelectorAll('p').forEach(function (x) { x.style.background = ''; }); p.style.background = 'color-mix(in srgb, var(--cyan) 12%, transparent)'; p.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  /* AI tutor */
  function linkify(text) {
    return esc(text).replace(/\[(\d{1,2}):(\d{2})\]/g, function (_, m, s) { var t = (+m) * 60 + (+s); return '<button class="tc" data-act="seek" data-t="' + t + '">' + m.padStart(2, '0') + ':' + s + '</button>'; });
  }
  function msgHtml(m) {
    if (m.role === 'me') return '<div class="msg me">' + esc(m.text) + '</div>';
    var src = m.mode === 'online' ? '<span class="chip info">' + I.spark + ' AI ustoz · onlayn</span>' :
      m.mode === 'pending' ? '<span class="chip warn">' + I.clock + ' Navbatda</span>' : '<span class="chip ok">' + I.off + ' Oflayn javob · dars matnidan</span>';
    var body;
    if (m.mode === 'online') body = '<div>' + linkify(m.text) + '</div>';
    else if (m.items && m.items.length) body = '<div>Darsda bu haqida shunday deyilgan:</div>' + m.items.map(function (it) {
      return '<div class="quote"><button class="tc" data-act="seek" data-t="' + it.t + '">' + mmss(it.t) + '</button><span>' + esc(it.text) + '</span></div>'; }).join('');
    else body = '<div>' + esc(m.text) + '</div>';
    return '<div class="msg"><div class="src">' + src + '</div>' + body + '</div>';
  }
  function suggestions(l) {
    var t = (l.terms || []).slice(0, 3).map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1) + ' nima?'; });
    return t;
  }
  function paintChat() {
    var cur = S.cur, pane = $('#pane');
    Store.get('chat', cur.l.id).then(function (msgs) {
      if (S.cur !== cur || cur.tab !== 'ai') return;
      msgs = msgs || [];
      var intro = '<div class="msg"><div class="src"><span class="chip">' + I.spark + ' AI ustoz</span></div><div>Savolingizni yozing. Men faqat shu dars matniga tayanaman va har bir javobda videoning aniq daqiqasini ko‘rsataman.' +
        (isOnline() ? '' : ' Hozir internet yo‘q: javoblar qurilmaning o‘zida topiladi.') + '</div></div>';
      pane.innerHTML = '<div class="chat"><div class="msgs" id="msgs">' + intro + msgs.map(msgHtml).join('') + (cur.thinking ? '<div class="typing">AI ustoz javob yozmoqda…</div>' : '') + '</div>' +
        '<div class="suggest">' + suggestions(cur.l).map(function (s) { return '<button data-act="ask" data-q="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        '<form class="composer" id="askForm"><input type="text" id="askInput" placeholder="Masalan: ' + esc(suggestions(cur.l)[0] || 'Bu nima degani?') + '" autocomplete="off" aria-label="Savol">' +
        '<button class="btn primary" type="submit" aria-label="Yuborish">' + I.send + '</button></form></div>';
      var box = $('#msgs'); box.scrollTop = box.scrollHeight;
    });
  }
  function ask(q) {
    var cur = S.cur; q = (q || '').trim(); if (!q || !cur) return;
    var l = cur.l;
    Store.get('chat', l.id).then(function (msgs) {
      msgs = msgs || [];
      msgs.push({ id: uid(), role: 'me', text: q, ts: Date.now() });
      var off = E.answer(q, l.segments);
      addEvent('question', { lessonId: l.id, q: q, mode: canCloud() && Cloud.ai ? 'online' : 'offline' });
      if (canCloud() && Cloud.ai) {
        cur.thinking = true; Store.put('chat', l.id, msgs).then(paintChat);
        var hist = msgs.filter(function (m) { return m.mode !== 'pending'; }).slice(-6).map(function (m) { return { role: m.role === 'me' ? 'user' : 'assistant', text: m.text || '' }; });
        return Cloud.ask(q, l, hist).then(function (text) {
          msgs.push({ id: uid(), role: 'ai', mode: 'online', text: text, ts: Date.now() });
        }).catch(function () {
          msgs.push(off.found ? { id: uid(), role: 'ai', mode: 'offline', items: off.items, ts: Date.now() } :
            { id: uid(), role: 'ai', mode: 'offline', text: 'Onlayn AI hozir javob bera olmadi va dars matnida aniq javob topilmadi. Savolni boshqacha yozib ko‘ring.', ts: Date.now() });
        }).then(function () { cur.thinking = false; return Store.put('chat', l.id, msgs); }).then(function () { if (S.cur === cur) { paintChat(); paintTabs(); } });
      }
      if (off.found) msgs.push({ id: uid(), role: 'ai', mode: 'offline', items: off.items, ts: Date.now() });
      else if (!isOnline()) msgs.push({ id: uid(), role: 'ai', mode: 'pending', q: q, text: 'Dars matnida bu savolga aniq javob topilmadi. Savolingiz navbatga qo‘yildi: internet qaytgach AI ustoz javob beradi.', ts: Date.now() });
      else msgs.push({ id: uid(), role: 'ai', mode: 'offline', text: 'Dars matnida bu haqida ma’lumot topilmadi. Savolni boshqacha yozib ko‘ring yoki transkriptni ko‘zdan kechiring.', ts: Date.now() });
      return Store.put('chat', l.id, msgs).then(function () { paintChat(); paintTabs(); });
    });
  }
  function processPending() {
    if (!canCloud() || !Cloud.ai) return;
    Store.all('chat').then(function (rows) {
      var jobs = [];
      rows.forEach(function (r) { (r.value || []).forEach(function (m) { if (m.mode === 'pending') jobs.push({ lid: r.key, m: m }); }); });
      if (!jobs.length) return;
      var answered = 0;
      return jobs.reduce(function (p, j) {
        return p.then(function () {
          var l = S.lessons[j.lid]; if (!l) return;
          return Cloud.ask(j.m.q, l, []).then(function (text) {
            return Store.get('chat', j.lid).then(function (msgs) {
              msgs = (msgs || []).map(function (m) { return m.id === j.m.id ? { id: m.id, role: 'ai', mode: 'online', text: text, ts: Date.now() } : m; });
              answered++; return Store.put('chat', j.lid, msgs);
            });
          }).catch(function () {});
        });
      }, Promise.resolve()).then(function () {
        if (answered) toast('AI ustoz navbatdagi ' + answered + ' ta savolingizga javob berdi.', 'ok');
        if (S.cur && S.cur.tab === 'ai') paintChat(); if (S.cur) paintTabs();
      });
    });
  }

  /* quiz */
  function newQuiz(useAI) {
    var cur = S.cur, l = cur.l;
    cur.quizRound = (cur.quizRound || 0) + (cur.quiz ? 1 : 0);
    if (useAI) {
      cur.quiz = { loading: true }; paintQuiz();
      return Cloud.quiz(l, 5).then(function (qs) {
        if (!qs.length) throw new Error('empty');
        cur.quiz = { qs: qs, picks: [], checked: false, source: 'ai' };
      }).catch(function () {
        toast('AI test tuza olmadi. Oflayn test ko‘rsatildi.', 'warn');
        cur.quiz = { qs: E.makeQuiz(l, { n: 5, round: cur.quizRound }), picks: [], checked: false, source: 'offline' };
      }).then(paintQuiz);
    }
    var qs = (cur.quizRound === 0 && l.aiQuiz && l.aiQuiz.length) ? l.aiQuiz : E.makeQuiz(l, { n: 5, round: cur.quizRound });
    cur.quiz = { qs: qs, picks: [], checked: false, source: 'offline' };
    paintQuiz();
  }
  function paintQuiz() {
    var cur = S.cur, pane = $('#pane'); if (!pane || !cur || cur.tab !== 'test') return;
    if (!cur.quiz) return newQuiz(false);
    var z = cur.quiz;
    if (z.loading) { pane.innerHTML = '<p class="typing">AI test tuzmoqda…</p>'; return; }
    if (!z.qs.length) { pane.innerHTML = '<p class="empty">Bu dars uchun test tuzib bo‘lmadi: transkript juda qisqa.</p>'; return; }
    var right = 0;
    var html = z.qs.map(function (q, qi) {
      var pick = z.picks[qi];
      if (z.checked && pick === q.answer) right++;
      return '<div class="q"><div class="small muted">' + (qi + 1) + '-savol · ' + (q.type === 'tf' ? 'To‘g‘ri yoki noto‘g‘ri?' : q.type === 'cloze' ? 'Bo‘sh joyni to‘ldiring' : 'Savol') + '</div>' +
        '<div class="p">' + esc(q.prompt) + '</div><div class="opts">' + q.options.map(function (o, oi) {
          var cls = 'opt' + (pick === oi ? ' sel' : '') + (z.checked && oi === q.answer ? ' right' : '') + (z.checked && pick === oi && oi !== q.answer ? ' wrong' : '');
          return '<button class="' + cls + '" data-act="pick" data-q="' + qi + '" data-o="' + oi + '"' + (z.checked ? ' disabled' : '') + '><span class="k">' + 'ABCD'[oi] + '</span><span>' + esc(o) + '</span></button>';
        }).join('') + '</div>' +
        (z.checked ? '<div class="row small">' + (pick === q.answer ? '<span class="chip ok">' + I.check + ' To‘g‘ri</span>' : '<span class="chip warn">Xato</span>') +
          '<span class="muted">Videoda ko‘rish:</span><button class="tc" data-act="seek" data-t="' + q.t + '">' + mmss(q.t) + '</button></div>' : '') + '</div>';
    }).join('');
    var all = z.picks.filter(function (x) { return x !== undefined; }).length === z.qs.length;
    var head = z.checked ? '<div class="score"><b>' + right + '/' + z.qs.length + '</b><div><div style="font-weight:650">' + (right / z.qs.length >= 0.6 ? 'Yaxshi natija!' : 'Mavzuni yana bir bor ko‘rib chiqing.') + '</div>' +
      '<div class="small muted">Natija saqlandi' + (isOnline() ? '' : ' va internet qaytganda yuboriladi') + '.</div></div></div>' : '';
    pane.innerHTML = '<div class="qz">' + '<div class="spread"><span class="chip ' + (z.source === 'ai' ? 'info' : 'ok') + '">' + (z.source === 'ai' ? I.spark + ' AI tuzgan test' : I.off + ' Oflayn tuzilgan test') + '</span>' +
      '<div class="row"><button class="btn sm ghost" data-act="quiz-new">Yangi savollar</button>' + (canCloud() && Cloud.ai ? '<button class="btn sm" data-act="quiz-ai">' + I.spark + ' AI bilan tuzish</button>' : '') + '</div></div>' +
      head + html + (z.checked ? '' : '<button class="btn primary" data-act="quiz-check"' + (all ? '' : ' disabled') + '>Tekshirish</button>') + '</div>';
    if (z.checked && !z.saved) {
      z.saved = true;
      var l = cur.l, best = S.quizBest[l.id];
      if (!best || right > best.score) { S.quizBest[l.id] = { score: right, total: z.qs.length }; Store.put('kv', 'quizBest', S.quizBest); }
      Store.put('quiz', uid(), { lessonId: l.id, score: right, total: z.qs.length, source: z.source, ts: Date.now() });
      addEvent('quiz', { lessonId: l.id, score: right, total: z.qs.length, source: z.source });
    }
  }

  /* notes */
  var noteT = null;
  function paintNotes() {
    var cur = S.cur, pane = $('#pane');
    Store.get('notes', cur.l.id).then(function (n) {
      if (S.cur !== cur || cur.tab !== 'konspekt') return;
      pane.innerHTML = '<div class="form"><label class="f" for="noteBox">Konspekt — qurilmada saqlanadi, internet bo‘lganda sinxronlanadi' +
        '<textarea id="noteBox" rows="12" placeholder="Muhim fikrlarni yozing…">' + esc(n && n.text || '') + '</textarea></label>' +
        '<div class="spread"><button class="btn sm" data-act="note-time">' + I.clock + ' Hozirgi vaqtni qo‘shish</button><span class="small muted" id="noteState">' + (n && n.at ? 'Saqlangan: ' + ago(n.at) : '') + '</span></div></div>';
    });
  }
  function saveNote() {
    var cur = S.cur, box = $('#noteBox'); if (!cur || !box) return;
    var text = box.value;
    Store.put('notes', cur.l.id, { text: text, at: Date.now() });
    var st = $('#noteState'); if (st) st.textContent = 'Saqlandi';
    addEvent('note', { lessonId: cur.l.id, chars: text.length, text: text.slice(0, 4000) }, 'n:' + cur.l.id);
  }

  /* ---------------- views: progress ---------------- */
  function viewProgress() {
    Promise.all([Store.all('outbox'), Store.all('quiz'), Store.estimate()]).then(function (r) {
      var out = r[0].map(function (x) { return x.value; }).sort(function (a, b) { return b.ts - a.ts; }), quizzes = r[1].map(function (x) { return x.value; }), est = r[2];
      var done = Object.keys(S.progress).filter(function (k) { return S.progress[k].done && S.lessons[k]; }).length;
      var watched = Object.keys(S.progress).reduce(function (a, k) { return a + (S.progress[k].max || 0); }, 0);
      var avg = quizzes.length ? Math.round(quizzes.reduce(function (a, q) { return a + q.score / q.total; }, 0) / quizzes.length * 100) : 0;
      var mediaKB = Object.keys(S.media).reduce(function (a, k) { return a + (S.media[k].size || 0) / 1024; }, 0);
      var LABEL = { progress: 'Dars progressi', lesson_done: 'Dars yakunlandi', quiz: 'Test natijasi', note: 'Konspekt', question: 'AI ustozga savol', lesson_published: 'Yangi dars nashri', course_downloaded: 'Kurs yuklab olindi', license_assigned: 'Litsenziya berildi', doc_added: 'Hujjat qo‘shildi' };
      var rows = out.slice(0, 12).map(function (e) {
        var l = e.data && e.data.lessonId && S.lessons[e.data.lessonId];
        var extra = e.type === 'quiz' ? ' · ' + e.data.score + '/' + e.data.total : '';
        return '<div class="item"><div><div class="nm">' + esc(LABEL[e.type] || e.type) + extra + '</div><div class="small muted">' + esc(l ? l.title : (e.data && (e.data.title || e.data.name)) || '') + '</div></div><span class="small muted">' + ago(e.ts) + '</span></div>';
      }).join('');
      var cloudLine = Cloud.mode === 'none' ? (Cloud.detected ? 'Server topilmadi — natijalar qurilmada saqlanmoqda' : 'Server tekshirilmoqda…') : Cloud.label + ' · ' + Cloud.detail;
      var courseRows = S.courseList.map(function (c) {
        var pct = courseProgress(c);
        return '<tr class="' + accOf(c) + '"><td><span class="acc-dot"></span> ' + esc(c.title) + '</td><td><div class="bar"><i style="width:' + pct + '%"></i></div></td><td class="num">' + pct + '%</td><td>' +
          (courseDownloaded(c) ? '<span class="chip ok">Oflayn</span>' : '<span class="chip">Onlayn</span>') + '</td></tr>';
      }).join('');
      var dlList = S.courseList.filter(courseDownloaded).map(function (c) {
        var kb = c.lessons.reduce(function (a, l) { return a + ((S.media[l.id] || {}).size || 0) / 1024; }, 0);
        return '<div class="item"><div><div class="nm">' + esc(c.title) + '</div><div class="small muted">' + fmtKB(kb) + '</div></div><button class="btn sm ghost" data-act="undl" data-id="' + c.id + '">' + I.trash + ' O‘chirish</button></div>';
      }).join('') || '<p class="empty">Hali kurs yuklab olinmagan.</p>';
      app.innerHTML = '<div class="stack">' + offlineBanner() + '<h1>Natijalarim</h1>' +
        '<div class="kpis"><div class="kpi acc-green"><span class="v">' + done + '</span><span class="l">yakunlangan dars</span></div>' +
        '<div class="kpi acc-cyan"><span class="v">' + avg + '%</span><span class="l">o‘rtacha test natijasi</span></div>' +
        '<div class="kpi acc-yellow"><span class="v">' + Math.round(watched / 60) + ' daq</span><span class="l">ko‘rilgan video</span></div>' +
        '<div class="kpi acc-purple"><span class="v">' + Object.keys(S.days).length + '</span><span class="l">faol kun</span></div></div>' +
        '<div class="cols"><section class="card stack" style="gap:12px"><div class="spread"><h2>Sinxronlash</h2>' +
        '<button class="btn sm" data-act="sync"' + (canCloud() && Cloud.sync ? '' : ' disabled') + '>' + I.sync + ' Hozir yuborish</button></div>' +
        '<div class="row"><span class="chip ' + (isOnline() ? 'ok' : 'warn') + '">' + (isOnline() ? 'Onlayn' : 'Oflayn') + '</span><span class="small muted">' + esc(cloudLine) + '</span></div>' +
        '<p class="small muted">Oxirgi sinxronlash: ' + ago(S.lastSync) + '. Yuborilishi kutilayotgan: <b class="num">' + out.length + '</b>.</p>' +
        '<div class="list">' + (rows || '<p class="empty">Hamma natijalar yuborilgan.</p>') + '</div></section>' +
        '<section class="card stack" style="gap:12px"><h2>Kurslar bo‘yicha</h2><div class="tbl-wrap"><table><thead><tr><th>Kurs</th><th>Progress</th><th></th><th>Holat</th></tr></thead><tbody>' + courseRows + '</tbody></table></div>' +
        '<h2 style="margin-top:8px">Qurilma xotirasi</h2><p class="small muted">Videolar: ' + fmtKB(mediaKB) + (est && est.quota ? ' · bo‘sh joy: ' + fmtKB((est.quota - est.usage) / 1024) : '') + (Store.persistent ? '' : ' · diqqat: brauzer xotirasi cheklangan') + '</p>' +
        '<div class="list">' + dlList + '</div>' +
        '<form class="row" id="nameForm"><label class="f" style="flex:1" for="nameIn">Ismingiz<input type="text" id="nameIn" value="' + esc(S.profile.name) + '" maxlength="40"></label><button class="btn" type="submit" style="align-self:end">Saqlash</button></form>' +
        '</section></div></div>';
    });
  }

  /* ---------------- views: author studio ---------------- */
  var SAMPLE_TRANSCRIPT = '00:00 Assalomu alaykum! Bugun Python dasturlash tilida o‘zgaruvchilar bilan tanishamiz.\n' +
    '00:12 O‘zgaruvchi — bu ma’lumot saqlanadigan quti. Masalan, ism = "Aziz".\n' +
    '00:25 Python o‘zgaruvchi turini o‘zi aniqlaydi: son, matn yoki ro‘yxat bo‘lishi mumkin.\n' +
    '00:38 print funksiyasi natijani ekranga chiqaradi: print(ism).\n' +
    '00:50 input funksiyasi foydalanuvchidan ma’lumot so‘raydi.\n' +
    '01:02 Uyga vazifa: ismingiz va yoshingizni so‘raydigan dastur yozing.';
  function viewAuthor() {
    var a = (S.base && S.base.authorSample) || { revenueUzs: 0, share: 70, enrollments: 0, quality: 0 };
    var mine = S.userLessons.slice().sort(function (x, y) { return (y.createdAt || 0) - (x.createdAt || 0); });
    var courseOpts = S.courseList.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.title) + '</option>'; }).join('');
    app.innerHTML = '<div class="stack">' + offlineBanner() +
      '<div class="spread"><h1>Muallif paneli</h1><span class="chip sample">Namuna ko‘rsatkichlar</span></div>' +
      '<div class="kpis"><div class="kpi acc-green"><span class="v">' + fmtNum(a.revenueUzs) + '</span><span class="l">daromad, so‘m (' + a.share + '% muallifda qoladi)</span></div>' +
      '<div class="kpi acc-cyan"><span class="v">' + a.enrollments + '</span><span class="l">faol yozilishlar</span></div>' +
      '<div class="kpi acc-yellow"><span class="v">' + String(a.quality).replace('.', ',') + '</span><span class="l">AI sifat bahosi</span></div>' +
      '<div class="kpi acc-purple"><span class="v">' + mine.length + '</span><span class="l">siz yuklagan darslar</span></div></div>' +
      '<div class="cols"><section class="card"><form class="form" id="auForm">' +
      '<h2>Yangi dars yuklash</h2><p class="small muted">Internet bo‘lmasa ham yuklang: dars qurilmada saqlanadi va internet qaytganda serverga o‘zi yuboriladi.</p>' +
      '<div class="two"><label class="f" for="auCourse">Kurs<select id="auCourse">' + courseOpts + '<option value="__new">+ Yangi kurs</option></select></label>' +
      '<label class="f" for="auNew">Yangi kurs nomi<input type="text" id="auNew" placeholder="Masalan: Python asoslari"></label></div>' +
      '<div class="two"><label class="f" for="auTitle">Dars nomi<input type="text" id="auTitle" required placeholder="Masalan: O‘zgaruvchilar"></label>' +
      '<label class="f" for="auPrice">Narxi, so‘m (ixtiyoriy)<input type="number" id="auPrice" min="0" step="1000" placeholder="25000"></label></div>' +
      '<label class="f" for="auVideo">Video fayl (MP4/WebM, ixtiyoriy)<input type="file" id="auVideo" accept="video/*"></label>' +
      '<label class="f" for="auText">Transkript: SRT, VTT, “00:15 matn” qatorlari yoki oddiy matn<textarea id="auText" rows="7" placeholder="00:00 Kirish…"></textarea></label>' +
      '<div class="row"><label class="btn sm" for="auTFile" style="cursor:pointer">Transkript faylini tanlash</label><input type="file" id="auTFile" accept=".srt,.vtt,.txt,text/plain" hidden>' +
      '<button class="btn sm ghost" type="button" data-act="au-sample">Namuna transkript qo‘yish</button></div>' +
      '<label class="check"><input type="checkbox" id="auAi" checked> <span>AI materiallarini avtomatik yaratish: kalit so‘zlar va test' + (canCloud() && Cloud.ai ? ' (onlayn AI)' : ' (oflayn)') + '</span></label>' +
      '<p class="small" id="auMsg" role="status"></p>' +
      '<button class="btn primary" type="submit">' + I.down + ' Darsni nashr qilish</button></form></section>' +
      '<section class="card stack" style="gap:12px"><h2>Mening darslarim</h2><div class="list">' + (mine.map(function (l) {
        return '<div class="item"><div><div class="nm">' + esc(l.title) + '</div><div class="small muted">' + esc(l.courseTitle || '') + ' · ' + mmss(l.duration) + ' · ' + l.segments.length + ' ta qism' + (l.price ? ' · ' + fmtNum(l.price) + ' so‘m' : '') + '</div></div>' +
          '<div class="row"><span class="chip ' + (l.status === 'uploaded' ? 'ok' : 'warn') + '">' + (l.status === 'uploaded' ? 'Serverda' : 'Qurilmada') + '</span><a class="btn sm" href="#dars-' + esc(l.id) + '">Ochish</a>' +
          '<button class="btn sm ghost" data-act="au-del" data-id="' + esc(l.id) + '" aria-label="O‘chirish">' + I.trash + '</button></div></div>';
      }).join('') || '<p class="empty">Hali dars yuklamadingiz. Chapdagi forma orqali birinchi darsingizni qo‘shing — test va AI ustoz avtomatik tayyorlanadi.</p>') + '</div>' +
      '<p class="small muted">Daromadning ' + a.share + '% qismi muallifga, 30% — platforma komissiyasi.</p></section></div></div>';
  }
  function probeVideo(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), v = document.createElement('video'), done = false;
      function fin(d, p) { if (done) return; done = true; URL.revokeObjectURL(url); resolve({ duration: d || 0, poster: p || null }); }
      v.muted = true; v.preload = 'auto'; v.src = url;
      v.onloadedmetadata = function () { try { v.currentTime = Math.min(1, (v.duration || 2) / 3); } catch (e) { fin(v.duration); } };
      v.onseeked = function () {
        try { var c = document.createElement('canvas'); c.width = 480; c.height = 270; c.getContext('2d').drawImage(v, 0, 0, 480, 270); fin(v.duration, c.toDataURL('image/jpeg', .72)); }
        catch (e) { fin(v.duration); }
      };
      v.onerror = function () { fin(0); };
      setTimeout(function () { fin(v.duration); }, 8000);
    });
  }
  function publishLesson() {
    var msg = $('#auMsg'), title = $('#auTitle').value.trim(), text = $('#auText').value, file = $('#auVideo').files[0];
    var cid = $('#auCourse').value, newName = $('#auNew').value.trim(), price = +$('#auPrice').value || 0, useAI = $('#auAi').checked;
    if (!title) { msg.textContent = 'Dars nomini yozing.'; return; }
    if (cid === '__new' && !newName) { msg.textContent = 'Yangi kurs nomini yozing.'; return; }
    msg.textContent = 'Tayyorlanmoqda…';
    (file ? probeVideo(file) : Promise.resolve({ duration: 0, poster: null })).then(function (pv) {
      var segs = E.parseTranscript(text, pv.duration);
      if (!segs.length) { msg.textContent = 'Transkript kiriting: AI ustoz va test shu matn asosida ishlaydi.'; return; }
      var course = cid === '__new' ? { id: 'k-' + uid(), title: newName } : S.courses[cid];
      var id = 'u-' + uid();
      var lesson = { id: id, title: title, duration: Math.round(pv.duration || (segs[segs.length - 1].t + 12)), segments: segs, terms: E.extractTerms(segs, 8),
        courseId: course.id, courseTitle: course.title, author: S.profile.name, price: price, poster: pv.poster, video: null,
        hasLocalVideo: !!file, sizeKB: file ? Math.round(file.size / 1024) : 0, status: 'local', createdAt: Date.now() };
      var save = file ? Store.put('media', id, { blob: file, size: file.size, type: file.type, at: Date.now() }).then(function () { S.media[id] = { size: file.size }; }) : Promise.resolve();
      var ai = (useAI && canCloud() && Cloud.ai) ? Cloud.quiz(lesson, 5).then(function (qs) { lesson.aiQuiz = qs; }).catch(function () {}) : Promise.resolve();
      return save.then(function () { return ai; }).then(function () {
        S.userLessons.push(lesson); indexCatalog();
        return Store.put('lessons', id, lesson);
      }).then(function () {
        var meta = Object.assign({}, lesson); delete meta.poster;
        addEvent('lesson_published', meta);
        toast(isOnline() ? 'Dars nashr qilindi. Serverga yuborilmoqda…' : 'Dars qurilmada saqlandi. Internet qaytganda serverga yuboriladi.', 'ok');
        location.hash = 'dars-' + id;
      });
    });
  }

  /* ---------------- views: company (B2B) ---------------- */
  var SAMPLE_DOC = 'Ichki tartib qoidalari (namuna)\n\n' +
    'Ish vaqti dushanbadan jumagacha 9:00 dan 18:00 gacha. Tushlik vaqti 13:00 dan 14:00 gacha.\n\n' +
    'Masofaviy ishlash haftasiga 2 kungacha, bo‘lim rahbarining roziligi bilan ruxsat etiladi.\n\n' +
    'Yillik ta’til 21 ish kuni. Ta’til arizasi kamida 2 hafta oldin HR bo‘limiga topshiriladi.\n\n' +
    'Yangi xodim birinchi 2 hafta ichida “Kompaniya bilan tanishuv” kursini va axborot xavfsizligi testini topshiradi.\n\n' +
    'Mijoz ma’lumotlarini shaxsiy messenjerlar orqali yuborish taqiqlanadi. Shubhali xat kelsa, darhol IT bo‘limiga xabar bering.\n\n' +
    'Kurslarni o‘z vaqtida yakunlagan xodimlarga har oy sertifikat va qo‘shimcha bonus beriladi.';
  function viewCompany() {
    Promise.all([Store.get('kv', 'employees'), Store.all('docs'), Store.get('kv', 'mentorChat')]).then(function (r) {
      var co = (S.base && S.base.company) || { name: 'Kompaniya', licenses: 0, assigned: 0, completion: 0, departments: 0, employees: [] };
      var added = r[0] || [], docs = r[1].map(function (x) { return x.value; }), chat = r[2] || [];
      if (!docs.length) { docs = [{ id: 'd-sample', name: 'Ichki qoidalar (namuna).txt', text: SAMPLE_DOC, at: Date.now() }]; Store.put('docs', 'd-sample', docs[0]); }
      var mine = S.courseList.reduce(function (a, c) { return a + c.lessons.length; }, 0);
      var myDone = Object.keys(S.progress).filter(function (k) { return S.progress[k].done && S.lessons[k]; }).length;
      var me = { name: S.profile.name + ' (siz)', dept: 'Shu qurilma', progress: mine ? Math.round(myDone / mine * 100) : 0, real: true };
      var emps = [me].concat(added, co.employees);
      var assigned = Math.min(co.licenses, co.assigned + added.length);
      app.innerHTML = '<div class="stack">' + offlineBanner() +
        '<div class="spread"><div><h1>Korporativ portal</h1><p class="muted">' + esc(co.name) + '</p></div><span class="chip sample">Namuna kompaniya</span></div>' +
        '<div class="kpis"><div class="kpi acc-cyan"><span class="v">' + assigned + ' / ' + co.licenses + '</span><span class="l">berilgan litsenziyalar</span></div>' +
        '<div class="kpi acc-green"><span class="v">' + co.completion + '%</span><span class="l">kurslarni yakunlash darajasi</span></div>' +
        '<div class="kpi acc-purple"><span class="v">' + co.departments + '</span><span class="l">faol bo‘lim</span></div>' +
        '<div class="kpi acc-yellow"><span class="v">90%</span><span class="l">treninglarga nisbatan tejash</span></div></div>' +
        '<div class="cols"><section class="card stack" style="gap:12px"><h2>Xodimlar faolligi</h2><div class="tbl-wrap"><table><thead><tr><th>Xodim</th><th>Bo‘lim</th><th>Progress</th><th></th></tr></thead><tbody>' +
        emps.map(function (e) { return '<tr><td>' + esc(e.name) + '</td><td class="muted">' + esc(e.dept) + '</td><td><div class="bar acc-green"><i style="width:' + (e.progress || 0) + '%"></i></div></td><td class="num">' + (e.progress || 0) + '%</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        '<form class="form" id="licForm"><h3>Litsenziya berish</h3><div class="two"><label class="f" for="licName">Xodim ismi<input type="text" id="licName" required placeholder="Ism Familiya"></label>' +
        '<label class="f" for="licDept">Bo‘lim<input type="text" id="licDept" placeholder="Masalan: Savdo"></label></div>' +
        '<button class="btn" type="submit"' + (assigned >= co.licenses ? ' disabled' : '') + '>Litsenziya berish</button></form></section>' +
        '<section class="card stack" style="gap:12px"><h2>Shaxsiy AI mentor</h2><p class="small muted">Kompaniya hujjatlarini yuklang. Mentor faqat shu hujjatlarga tayanadi va manbani ko‘rsatadi. Internetsiz ham ishlaydi.</p>' +
        '<div class="list">' + docs.map(function (d) { return '<div class="item"><div><div class="nm">' + esc(d.name) + '</div><div class="small muted">' + E.chunkDoc(d.name, d.text).length + ' ta qism</div></div><button class="btn sm ghost" data-act="doc-del" data-id="' + esc(d.id) + '" aria-label="O‘chirish">' + I.trash + '</button></div>'; }).join('') + '</div>' +
        '<div class="row"><label class="btn sm" for="docFile" style="cursor:pointer">' + I.down + ' Hujjat qo‘shish (.txt, .md)</label><input type="file" id="docFile" accept=".txt,.md,.csv,text/plain" hidden></div>' +
        '<div class="msgs" style="padding:0;max-height:340px">' + chat.map(function (m) {
          if (m.role === 'me') return '<div class="msg me">' + esc(m.text) + '</div>';
          return '<div class="msg"><div class="src">' + (m.mode === 'online' ? '<span class="chip info">' + I.spark + ' AI mentor · onlayn</span>' : '<span class="chip ok">' + I.off + ' Oflayn javob · hujjatlardan</span>') + '</div>' +
            (m.items ? '<div>Hujjatlarda shunday yozilgan:</div>' + m.items.map(function (it) { return '<div class="quote"><span class="chip">' + esc(it.doc) + ', ' + it.part + '-qism</span><span>' + esc(it.text) + '</span></div>'; }).join('') : '<div>' + esc(m.text) + '</div>') + '</div>';
        }).join('') + '</div>' +
        '<form class="composer" id="mentorForm" style="padding:0;border:0"><input type="text" id="mentorIn" placeholder="Masalan: Ta’til necha kun?" aria-label="Mentorga savol"><button class="btn primary" type="submit" aria-label="Yuborish">' + I.send + '</button></form>' +
        '</section></div></div>';
    });
  }
  function mentorAsk(q) {
    q = (q || '').trim(); if (!q) return;
    Promise.all([Store.all('docs'), Store.get('kv', 'mentorChat')]).then(function (r) {
      var passages = []; r[0].forEach(function (x) { passages = passages.concat(E.chunkDoc(x.value.name, x.value.text)); });
      var chat = r[1] || []; chat.push({ role: 'me', text: q });
      var off = E.answer(q, passages, { min: 0.6 });
      var offMsg = off.found ? { role: 'ai', mode: 'offline', items: off.items } : { role: 'ai', mode: 'offline', text: 'Hujjatlarda bu savolga javob topilmadi. Tegishli hujjatni qo‘shing yoki HR bo‘limiga murojaat qiling.' };
      var p = (canCloud() && Cloud.ai) ? Cloud.mentor(q, passages).then(function (t) { chat.push({ role: 'ai', mode: 'online', text: t }); }).catch(function () { chat.push(offMsg); }) : Promise.resolve(chat.push(offMsg));
      return p.then(function () { return Store.put('kv', 'mentorChat', chat.slice(-20)); }).then(viewCompany);
    });
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var act = t.dataset.act, cur = S.cur;
    if (act === 'dl') downloadCourse(t.dataset.id);
    else if (act === 'undl') removeDownload(t.dataset.id);
    else if (act === 'seek') seek(+t.dataset.t);
    else if (act === 'tab' && cur) { cur.tab = t.dataset.tab; paintTabs(); paintPane(); }
    else if (act === 'ask') ask(t.dataset.q);
    else if (act === 'textmode' && cur) { cur.textMode = !cur.textMode; var v = lessonVideo(); paintStage(v ? v.currentTime : 0); paintChips(); }
    else if (act === 'done' && cur) markDone(cur.l, 'manual');
    else if (act === 'pick' && cur && cur.quiz) { cur.quiz.picks[+t.dataset.q] = +t.dataset.o; paintQuiz(); }
    else if (act === 'quiz-check' && cur) { cur.quiz.checked = true; paintQuiz(); }
    else if (act === 'quiz-new' && cur) newQuiz(false);
    else if (act === 'quiz-ai' && cur) newQuiz(true);
    else if (act === 'note-time' && cur) { var box = $('#noteBox'), vv = lessonVideo(); if (box) { box.value += (box.value && !/\n$/.test(box.value) ? '\n' : '') + '[' + mmss(vv ? vv.currentTime : 0) + '] '; box.focus(); saveNote(); } }
    else if (act === 'sync') flush(true);
    else if (act === 'au-sample') { $('#auText').value = SAMPLE_TRANSCRIPT; if (!$('#auTitle').value) $('#auTitle').value = 'Python: o‘zgaruvchilar'; }
    else if (act === 'au-del') {
      var id = t.dataset.id;
      S.userLessons = S.userLessons.filter(function (l) { return l.id !== id; }); delete S.media[id];
      Promise.all([Store.del('lessons', id), Store.del('media', id), Store.del('chat', id)]).then(function () { indexCatalog(); viewAuthor(); toast('Dars o‘chirildi.'); });
    }
    else if (act === 'doc-del') Store.del('docs', t.dataset.id).then(viewCompany);
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; e.preventDefault();
    if (f.id === 'askForm') { var inp = $('#askInput'); ask(inp.value); inp.value = ''; }
    else if (f.id === 'auForm') publishLesson();
    else if (f.id === 'nameForm') { var n = $('#nameIn').value.trim(); if (n) { S.profile.name = n; Store.put('kv', 'profile', S.profile); toast('Saqlandi.', 'ok'); } }
    else if (f.id === 'licForm') {
      var nm = $('#licName').value.trim(), dp = $('#licDept').value.trim() || 'Umumiy'; if (!nm) return;
      Store.get('kv', 'employees').then(function (list) {
        list = list || []; list.unshift({ name: nm, dept: dp, progress: 0 });
        return Store.put('kv', 'employees', list);
      }).then(function () { addEvent('license_assigned', { name: nm, dept: dp }); toast(nm + ' uchun litsenziya berildi.', 'ok'); viewCompany(); });
    }
    else if (f.id === 'mentorForm') { var mi = $('#mentorIn'); mentorAsk(mi.value); mi.value = ''; }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'noteBox') { var st = $('#noteState'); if (st) st.textContent = 'Yozilmoqda…'; clearTimeout(noteT); noteT = setTimeout(saveNote, 700); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'auTFile' && el.files[0]) el.files[0].text().then(function (t) { $('#auText').value = t; });
    if (el.id === 'docFile' && el.files[0]) {
      var f = el.files[0];
      f.text().then(function (t) {
        var id = 'd-' + uid();
        return Store.put('docs', id, { id: id, name: f.name, text: t.slice(0, 200000), at: Date.now() }).then(function () { addEvent('doc_added', { name: f.name, chars: t.length }); toast('“' + f.name + '” qo‘shildi.', 'ok'); viewCompany(); });
      });
    }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveProgress(true); });

  /* ---------------- boot ---------------- */
  function boot() {
    Store.init().then(function () {
      return Promise.all([Store.get('kv', 'profile'), Store.all('progress'), Store.get('kv', 'quizBest'), Store.all('lessons'), Store.get('kv', 'lastSync'),
        Store.get('kv', 'days'), Store.all('media'), Store.get('kv', 'remoteLessons')]);
    }).then(function (r) {
      if (r[0]) S.profile = r[0];
      if (!S.profile.device) { S.profile.device = 'dev-' + uid(); Store.put('kv', 'profile', S.profile); }
      r[1].forEach(function (x) { S.progress[x.key] = x.value; });
      S.quizBest = r[2] || {}; S.userLessons = r[3].map(function (x) { return x.value; }); S.lastSync = r[4] || 0; S.days = r[5] || {};
      r[6].forEach(function (x) { S.media[x.key] = { size: x.value && x.value.size || 0 }; });
      S.remoteLessons = r[7] || [];
      return loadCatalog();
    }).then(function () {
      indexCatalog(); S.route = parseHash(); render(); refreshOutbox();
      return Cloud.detect();
    }).then(function () {
      paintStatus();
      if (S.cur) paintChips();
      if (S.route.v === 'natijalar' || S.route.v === 'muallif') render();
      if (!isOnline()) return;
      flush(); processPending();
      return Cloud.catalog().then(function (j) {
        if (!j || !j.lessons) return;
        var mineIds = {}; S.userLessons.forEach(function (l) { mineIds[l.id] = 1; });
        S.remoteLessons = j.lessons.filter(function (l) { return !mineIds[l.id]; });
        Store.put('kv', 'remoteLessons', S.remoteLessons); indexCatalog();
        if (S.route.v === 'kurslar') render();
      });
    }).catch(function (e) { app.innerHTML = '<div class="card">Ilovani ochishda xato: ' + esc(e && e.message) + '</div>'; });
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) {}
    }
  }
  boot();
})();
