# DreamTeach — internetsiz ham ishlaydigan o‘quv platformasi

DreamTeach — viloyatdagi o‘quvchilar uchun AI ustozli o‘quv platformasi. Kurs bir marta yuklab olinadi, keyin video, test, konspekt va AI ustoz internetsiz ishlaydi. Internet qaytganda natijalar serverga o‘zi yuboriladi.

## Nimalar bor

| Bo‘lim | Imkoniyatlar |
| --- | --- |
| Kurslar | Katalog, kursni bir bosishda yuklab olish, progress, "Oflayn mavjud" belgisi |
| Dars | Video + transkript yonma-yon; AI ustoz; avtomatik test; konspekt; matnli rejim (trafikni tejash) |
| AI ustoz | Onlayn: Gemini 2.5 Flash, faqat dars matniga tayanadi va [mm:ss] vaqtini ko‘rsatadi. Oflayn: qurilmaning o‘zida dars matnidan qidiradi. Javobi topilmagan savol navbatga qo‘yiladi va internet qaytganda javob keladi |
| Test | Oflayn: dars matnidan avtomatik (bo‘sh joyni to‘ldirish, to‘g‘ri/noto‘g‘ri). Onlayn: AI tuzadi. Har bir savolda "videoda ko‘rish" vaqti |
| Natijalarim | Yakunlangan darslar, test natijalari, sinxronlash navbati, qurilma xotirasi |
| Muallif | Video + transkript (SRT, VTT, "00:15 matn" yoki oddiy matn) yuklash. Kalit so‘zlar va test avtomatik tayyorlanadi. Internetsiz yuklansa ham keyin serverga ketadi |
| Kompaniya | Litsenziyalar, xodimlar progressi, shaxsiy AI mentor (kompaniya hujjatlari asosida, oflayn ham ishlaydi) |

## Ishga tushirish

Kerak: [Node.js](https://nodejs.org) 18 yoki undan yangi. Boshqa hech narsa o‘rnatilmaydi.

```bash
cd dreamteach
node server.js
```

Brauzerda oching: http://localhost:8080

### Gemini AI ni ulash

1. [Google AI Studio](https://aistudio.google.com/apikey) da API kalit oling.
2. Serverni kalit bilan ishga tushiring:

```bash
GEMINI_API_KEY=sizning_kalitingiz node server.js
```

Windows (PowerShell):

```powershell
$env:GEMINI_API_KEY="sizning_kalitingiz"; node server.js
```

Kalit faqat serverda turadi, brauzerga yuborilmaydi. Kalitsiz ham platforma ishlaydi: AI ustoz va testlar qurilmaning o‘zida dars matnidan tuziladi.

Boshqa sozlamalar: `PORT` (standart 8080), `GEMINI_MODEL` (standart `gemini-2.5-flash`), `AI_MOCK=1` (kalitsiz sinov rejimi).

## Oflayn rejim qanday ishlaydi

1. Birinchi ochilishda ilova (HTML, JS, kurslar ro‘yxati, rasmlar) service worker orqali qurilmaga saqlanadi.
2. "Yuklab olish" tugmasi dars videolarini qurilma xotirasiga (IndexedDB) yozadi.
3. Internet yo‘q paytda progress, test, konspekt va savollar navbatga yoziladi (`outbox`).
4. Internet qaytganda navbat `/api/sync` ga yuboriladi, navbatdagi AI savollarga javob olinadi, muallif videolari `/api/upload` ga yuklanadi.

Sinash uchun yuqoridagi "Oflayn rejimni sinash" tugmasini bosing yoki telefonda parvoz rejimini yoqing.

## Internetga joylash (deploy)

Telefonga o‘rnatish va oflayn rejim uchun sayt **HTTPS** orqali ochilishi kerak (localhost bundan mustasno).

- **VPS** (masalan, Ubuntu): `node server.js` ni `pm2` yoki `systemd` bilan doimiy ishga tushiring, oldiga Nginx + Let's Encrypt qo‘ying.
- **Render / Railway**: yangi Node servis yarating, start buyrug‘i `node server.js`, muhit o‘zgaruvchisiga `GEMINI_API_KEY` qo‘shing. Yuklangan videolar va natijalar `server-data/` papkasida turadi, shuning uchun doimiy disk (persistent disk) ulang.

## Yangi kurs qo‘shish

`data/courses.json` dagi `courses` ro‘yxatiga kurs qo‘shing. Har bir dars uchun:

```json
{
  "id": "py-1",
  "title": "O‘zgaruvchilar",
  "duration": 95,
  "video": "media/py-1.mp4",
  "poster": "media/py-1.jpg",
  "sizeKB": 4200,
  "terms": ["o‘zgaruvchi", "print", "input"],
  "segments": [{ "t": 0, "text": "Kirish..." }, { "t": 12, "text": "..." }]
}
```

`segments` — vaqt (soniya) va matn. AI ustoz, test va qidiruv shu matn asosida ishlaydi. Videoni `media/` papkasiga qo‘ying. Oflayn foydalanuvchilar uchun 480p yoki 360p video tavsiya etiladi: 10 daqiqalik dars taxminan 15–25 MB bo‘ladi. Yangi versiyani chiqarganda `sw.js` dagi `CACHE` nomini o‘zgartiring.

Muallif panelidan yuklangan darslar serverga sinxronlangach, `/api/catalog` orqali boshqa o‘quvchilarga ham ko‘rinadi.

## API

| So‘rov | Vazifasi |
| --- | --- |
| `GET /api/health` | Server holati va AI ulanganmi |
| `POST /api/ask` | AI ustoz: `{question, title, segments, history}` → `{text}` |
| `POST /api/quiz` | AI test: `{title, segments, terms, n}` → `{questions}` |
| `POST /api/mentor` | Kompaniya AI mentori: `{question, passages}` → `{text}` |
| `POST /api/sync` | Oflayn navbatni qabul qilish: `{device, events}` |
| `POST /api/upload?id=` | Muallif videosini yuklash (300 MB gacha) |
| `GET /api/catalog` | Mualliflar nashr qilgan darslar |
| `GET /api/stats` | Umumiy statistika |

## Papkalar

```
index.html, app.css      ilova oynasi va dizayni
js/engine.js             oflayn AI: qidiruv, javob, test, transkript tahlili
js/store.js              qurilma xotirasi (IndexedDB)
js/cloud.js              server bilan aloqa
js/app.js                ilova interfeysi
sw.js, manifest          oflayn ishlash va telefonga o‘rnatish
data/courses.json        kurslar katalogi
media/                   dars videolari va rasmlari
server.js                server (Node, kutubxonasiz)
server-data/             natijalar va yuklangan videolar (avtomatik yaratiladi)
```

## Keyingi qadamlar

Hozirgi versiya MVP. Ishlab chiqarishga chiqishdan oldin quyidagilarni qo‘shish kerak:

- Ro‘yxatdan o‘tish va kirish (telefon raqami + SMS kod), har bir foydalanuvchining ma’lumotlarini ajratish.
- To‘lov tizimi (Payme, Click) va $4.99 obuna.
- Videolarni CDN orqali tarqatish va bir nechta sifatda (360p/720p) saqlash.
- Muallif darslarini moderatsiya qilish.
- Kompaniya portaliga haqiqiy ma’lumotlar bazasi (hozir namuna ma’lumotlar).

Ilovadagi namuna kurslar, muallif ko‘rsatkichlari va "Demo Kompaniya MChJ" ma’lumotlari — demo uchun.
"# dreamteach" 
