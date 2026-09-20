/* =====================================================================
   РЕДАКТОР СОДЕРЖИМОГО SPOTTER — замена админке на Netlify.

   Почему своя, а не Decap: Decap авторизуется через Netlify (Git Gateway),
   а у Netlify кончились кредиты и деплои встали — вместе с ними замёрзла
   и админка. Здесь посредника нет вообще: страница ходит в GitHub API
   напрямую, личным токеном владельца.

   Как это работает целиком:
     страница -> коммит в GitHub -> GitHub Actions -> бакет -> сайт.
   То есть сохранение здесь = публикация, отдельного деплоя не нужно.

   Токен лежит в localStorage этого браузера и никуда больше не уходит:
   запросы идут только на api.github.com. Это годится, пока редактор один
   человек; для команды нужен был бы полноценный вход, а не общий токен.
   ===================================================================== */

const REPO = 'jurydes/spotter';
const BRANCH = 'main';
const API = 'https://api.github.com';
const TOKEN_KEY = 'spotter-editor-token';

/* ---------------------------------------------------------------------
   ОПИСАНИЕ ПОЛЕЙ.

   Повторяет admin/config.yml вместе с подсказками — они писались под
   конкретные грабли (id нельзя менять, номер выпуска решает порядок
   на сайте), и терять их при переезде было бы глупо.
   --------------------------------------------------------------------- */
const SCHEMAS = {
  episodes: {
    file: 'data/episodes.json',
    key: 'episodes',
    title: 'Выпуски',
    one: 'выпуск',
    summary: it => it.title || '(без названия)',
    blank: () => ({ title:'', artists:[], dj:'', youtubeUrl:'', duration:'', cover:'',
                    description:'', chapter:null, number:null, standalone:false }),
    fields: [
      { name:'title', label:'Заголовок', type:'text',
        hint:'Состав через запятую, диджей — через x. Например: REDO, TILLS x DJ CHAPO.' },
      { name:'artists', label:'Участники', type:'strings',
        hint:'По одному имени на строку, в порядке выступления. Диджея тоже добавь сюда последним.' },
      { name:'dj', label:'Диджей', type:'text',
        hint:'Имя должно точно совпадать с одной из строк выше — иначе подпись «за пультом» не сработает.' },
      { name:'youtubeUrl', label:'Ссылка на YouTube', type:'text',
        hint:'Полный адрес вида https://www.youtube.com/watch?v=…' },
      { name:'duration', label:'Длительность', type:'text',
        hint:'Формат мм:сс, например 14:45 — берётся из плеера YouTube.' },
      { name:'cover', label:'Обложка', type:'image', folder:'assets/episodes' },
      { name:'description', label:'Отдельный текст о выпуске', type:'textarea',
        hint:'Заполняй, только если про выпуск есть что сказать отдельно от состава. Обычно пусто.' },
      { name:'chapter', label:'Часть (chapter)', type:'number',
        hint:'1 — первый сезон, 2 — CHAPTER II. Новая часть появится на сайте сама. Пусто — для сольников.' },
      { name:'number', label:'Номер внутри части', type:'number',
        hint:'Порядок на сайте определяется этим числом, а не порядком в списке. Самый большой номер в самой новой части становится «последним выпуском» на главной.' },
      { name:'standalone', label:'Отдельностоящий ролик', type:'bool',
        hint:'Включи и оставь «Часть»/«Номер» пустыми для роликов вроде сольников.' }
    ]
  },
  merch: {
    file: 'data/merch.json',
    key: 'merch',
    title: 'Мерч',
    one: 'товар',
    summary: it => (it.name || '(без названия)') + (it.active === false ? ' — скрыт' : ''),
    blank: () => ({ active:true, name:'', id:'', category:'', price:0, description:'',
                    popular:false, sizes:['S','M','L','XL'], editionTotal:20, editionLeft:20,
                    stock:{S:0,M:0,L:0,XL:0}, images:[] }),
    fields: [
      { name:'active', label:'Показывать на сайте', type:'bool',
        hint:'Выключи — товар пропадёт с сайта, но останется здесь со всеми фото и числами. Так прячут то, что сейчас не продаём, вместо удаления.' },
      { name:'name', label:'Название', type:'text' },
      { name:'id', label:'Идентификатор (id)', type:'text',
        hint:'Латиница, цифры и дефисы. У существующего товара менять НЕЛЬЗЯ — на него завязаны корзина и номера заказов.' },
      { name:'category', label:'Категория', type:'text',
        hint:'Точно как у других товаров того же типа — «Футболки» или «Худи».' },
      { name:'price', label:'Цена, ₽', type:'number' },
      { name:'description', label:'Описание', type:'textarea' },
      { name:'popular', label:'Показывать как «Популярное»', type:'bool',
        hint:'Отметь максимум у одного товара — он выделяется на главной.' },
      { name:'sizes', label:'Размеры в продаже', type:'strings',
        hint:'По одному на строку, в том же порядке, в каком показывать: S, M, L, XL.' },
      { name:'editionTotal', label:'Всего в тираже', type:'number',
        hint:'Сколько штук выпускается всего, по всем размерам вместе.' },
      { name:'editionLeft', label:'Осталось штук', type:'number',
        hint:'Общий остаток на все размеры — уменьшай вручную по мере заказов. 0 — «всё разобрали». Сайт сам это число не списывает: он не знает, какие заказы ты подтвердил.' },
      { name:'images', label:'Фотографии', type:'images', folder:'assets/merch',
        hint:'Первое фото — главное, оно в списке товаров. Предметное фото ставь первым, съёмку на модели — следом, размерную сетку — последней.' },
      { name:'stock', label:'Остатки по размеру (не используются)', type:'object',
        keys:['S','M','L','XL'], collapsed:true,
        hint:'Осталось от прежней схемы. Сайт сюда не смотрит, считает по тиражу выше.' }
    ]
  }
};

/* ---------------------------------------------------------------------
   GITHUB API
   --------------------------------------------------------------------- */
let token = '';
const state = {};   // collection -> { data, sha, dirty }

function authHeaders(){
  return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
}
async function ghGet(path){
  const res = await fetch(`${API}/repos/${REPO}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`,
                          { headers: authHeaders(), cache:'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await describeError(res));
  return res.json();
}
async function ghPut(path, contentBase64, message, sha){
  const body = { message, content: contentBase64, branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
    method:'PUT', headers:{ ...authHeaders(), 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await describeError(res));
  return res.json();
}
// Ошибки GitHub переводим в человеческие: «404» само по себе не объясняет,
// что делать, а причина почти всегда одна из трёх.
async function describeError(res){
  let detail = '';
  try{ detail = (await res.json()).message || ''; }catch(e){}
  if (res.status === 401) return 'Токен не принят. Проверьте, что скопировали его целиком и он не истёк.';
  if (res.status === 403) return 'Доступ запрещён. У токена должно быть право Contents: Read and write на репозиторий ' + REPO + '.';
  if (res.status === 404) return 'Репозиторий или файл не найден. Проверьте, что токен выдан именно на ' + REPO + '.';
  if (res.status === 409) return 'Файл изменился в репозитории, пока вы правили. Перезагрузите страницу и повторите.';
  if (res.status === 422) return 'GitHub отклонил запись: ' + detail;
  return `Ошибка GitHub ${res.status}. ${detail}`;
}

// base64 <-> UTF-8. Встроенный btoa работает только с однобайтовыми
// символами и падает на кириллице, поэтому через TextEncoder.
function utf8ToBase64(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function base64ToUtf8(b64){
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/* ---------------------------------------------------------------------
   КАРТИНКИ.

   Перед отправкой уменьшаем прямо в браузере. Это не украшательство:
   снимки с телефона приезжают по 8 МБ при 4000 пикселей по стороне,
   а показываются в разы меньшем размере — без сжатия такой файл лёг бы
   и в репозиторий, и на карточку товара, и грузился бы на мобильном
   интернете десятками секунд.
   --------------------------------------------------------------------- */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.86;

function shrinkImage(file){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      // Прозрачность у JPEG не сохранится и станет чёрной — подкладываем
      // белый фон, как это делают фотостоки. Однажды на сайте уже висело
      // фото с шашечкой вместо фона именно из-за такой конвертации.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob=>{
        if (!blob) return reject(new Error('Не удалось обработать картинку'));
        const reader = new FileReader();
        reader.onload = ()=> resolve({
          base64: String(reader.result).split(',')[1],
          width: w, height: h, size: blob.size
        });
        reader.onerror = ()=> reject(new Error('Не удалось прочитать картинку'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', JPEG_QUALITY);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('Это не картинка или формат не поддерживается')); };
    img.src = url;
  });
}

// Имя файла в репозитории: латиница, без пробелов, с отметкой времени —
// чтобы новая загрузка никогда не затирала уже лежащее фото.
function safeFileName(original){
  const dot = original.lastIndexOf('.');
  const base = (dot > 0 ? original.slice(0, dot) : original)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'photo';
  const stamp = Date.now().toString(36);
  return `${base}-${stamp}.jpg`;
}

async function uploadImage(file, folder){
  const { base64, width, height, size } = await shrinkImage(file);
  const path = `${folder}/${safeFileName(file.name)}`;
  await ghPut(path, base64, `Загрузка фото: ${path}`);
  return { path, width, height, size, before: file.size };
}
