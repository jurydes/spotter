/* =====================================================================
   РЕДАКТОР СОДЕРЖИМОГО SPOTTER — замена админке на Netlify.

   Почему своя, а не Decap: Decap авторизуется через Netlify (Git Gateway),
   а у Netlify кончились кредиты и деплои встали — вместе с ними замёрзла
   и админка. Здесь посредника нет вообще: страница ходит в GitHub API
   напрямую, личным токеном владельца.

   Как это работает целиком:
     страница -> коммит в GitHub -> GitHub Actions -> бакет -> сайт.
   То есть сохранение здесь = публикация, отдельного деплоя не нужно.

   Токен хранится в этом браузере и никуда больше не уходит: запросы идут
   только на api.github.com. На чужом компьютере галочку «запомнить» можно
   снять — тогда токен живёт до закрытия вкладки и нигде не остаётся.

   Своего пароля у страницы нет и быть не может: сайт статический, страница
   лежит файлом, и любой пароль в её коде виден через «исходный код».
   Защищать тут и нечего — ни данных, ни ключей в ней нет. Настоящая
   защита на стороне GitHub: без своего токена с правом записи в репозиторий
   страница бесполезна, а доступ выдаётся и отзывается по людям.
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
        hint:'Заполняй, только если про выпуск есть что сказать отдельно от состава. Обычно пусто. Подписи участников сюда писать не надо — для них есть раздел «Участники», оттуда они встают под каждым именем сами.' },
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
                    popular:false, isNew:false, preorder:false, sizes:['M','L','XL'],
                    showStock:false, stock:{M:0,L:0,XL:0}, images:[] }),
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
      { name:'popular', label:'На главную с плашкой «Популярное»', type:'bool',
        hint:'Товар появляется на главной с этой плашкой. Отметь у одного: на главной помещаются две карточки — «Новое» и «Популярное».' },
      { name:'isNew', label:'На главную с плашкой «Новое»', type:'bool',
        hint:'То же самое, но плашка «Новое». Если отмечены обе галочки, выигрывает «Новое».' },
      { name:'preorder', label:'Предзаказ (партия ещё не отшита)', type:'bool',
        hint:'Включено — на кнопке «Предзаказ». Выключено — «Купить». На худи включено, на футболках нет.' },
      { name:'leadTime', label:'Срок доставки', type:'text',
        hint:'Короткой строкой, как показать: «Доставка 10–17 дней». Встаёт над кнопкой и в карточке товара. Оставь пустым — строки не будет; у того, что есть на складе, она и не нужна.' },
      { name:'sizes', label:'Размеры в продаже', type:'strings',
        hint:'По одному на строку, в том же порядке, в каком показывать. Сейчас везде M, L, XL. Убрать размер отсюда — значит убрать его с сайта: кнопка пропадёт, а у тех, у кого он лежал в корзине, позиция оттуда исчезнет.' },
      { name:'showStock', label:'Показывать наличие по размерам', type:'bool',
        hint:'Включено — на карточке и на кнопках размеров стоят числа из «Остатков» ниже, а размер с нулём зачёркивается и не заказывается. Так у худи: партия ограничена, и человеку важно видеть, что его размера осталось две штуки. Выключено — покупатель про остатки не знает вообще, и они ему не мешают. Так у футболок.' },
      { name:'stock', label:'Остатки по размерам', type:'object',
        keys:['M','L','XL'],
        hint:'Сколько штук каждого размера есть. Уменьшай вручную по мере заказов: сайт сам не списывает — он не знает, какие заказы ты подтвердил. 0 во всех размерах при включённой галочке выше — «всё разобрали», кнопка заказа гаснет. У футболок эти числа всё равно никому не показываются.' },
      { name:'images', label:'Фотографии', type:'images', folder:'assets/merch',
        hint:'Первое фото — главное, оно в списке товаров. Предметное фото ставь первым, съёмку на модели — следом, размерную сетку — последней.' }
    ]
  },
  /* Событие — афиша на первом экране главной вместо последнего выпуска.
     Список, а не одна запись: прошедшие концерты остаются здесь
     выключенными, вместе с составом и афишей. Показывается первое
     включённое. */
  event: {
    file: 'data/event.json',
    key: 'event',
    title: 'Событие',
    one: 'событие',
    summary: it => (it.title || '(без названия)') + ' · ' + (it.date || 'без даты')
                   + (it.active ? '' : ' — выключено'),
    blank: () => ({ active:false, title:'SPOTTER LIVE', date:'', dateShort:'', place:'',
                    endsAt:'', poster:'', age:'18+', ticketUrl:'', boostyTier:'Спартанец',
                    ticketPrice:1000, ticketsTotal:40, ticketsLeft:40,
                    lineup:[], note:'' }),
    fields: [
      { name:'active', label:'Показывать афишу на главной', type:'bool',
        hint:'Включено — афиша занимает первый экран вместо последнего выпуска, и появляется блок «как попасть». Выключи после концерта: главная сама вернётся к выпуску, а событие останется здесь со всем составом.' },
      { name:'title', label:'Название', type:'text' },
      { name:'date', label:'Дата словами', type:'text',
        hint:'Как написать — так и покажется: «23 октября».' },
      { name:'dateShort', label:'Дата коротко', type:'text',
        hint:'Попадёт в название билета в заказе и в таблице: «23.10».' },
      { name:'endsAt', label:'Снять с главной', type:'text',
        hint:'День ПОСЛЕ концерта, строго в виде 2026-10-24. В 6 утра по Москве этого дня афиша уйдёт с главной сама, выключать руками не нужно. Пусто — висит, пока не снимешь галочку.' },
      { name:'place', label:'Место', type:'text',
        hint:'Полностью, с адресом: «бар БТК, пр. Мира, 102, корп. 1».' },
      { name:'poster', label:'Афиша', type:'image', folder:'assets/events',
        hint:'Вертикальная картинка с афишей. По клику открывается на весь экран.' },
      { name:'age', label:'Возрастное ограничение', type:'text',
        hint:'«18+». Показывается рядом с названием и в условиях входа.' },
      { name:'ticketUrl', label:'Ссылка на покупку (Boosty)', type:'text',
        hint:'Адрес поста, по которому попадают на событие. Заполнено — на афише стоят два шага («подписка» → «пост по ссылке») и кнопка, ведущая туда; своих билетов сайт не продаёт и в корзину их не кладёт. Очисти — вернётся продажа на сайте с корзиной и ценой из полей ниже.' },
      { name:'boostyTier', label:'Уровень подписки', type:'text',
        hint:'Как он называется на Boosty: «Спартанец». Подставляется в первый шаг — «Уровень „Спартанец“ или выше».' },
      { name:'ticketPrice', label:'Цена билета, ₽', type:'number',
        hint:'Нужна только при продаже на сайте, то есть когда ссылка выше пустая. На Boosty цену задаёт уровень подписки, и сайт её не показывает — чтобы не разошлась с настоящей.' },
      { name:'ticketsTotal', label:'Всего билетов', type:'number',
        hint:'Сколько мест всего. При продаже через Boosty показывается строкой «всего 40 мест»: сколько разобрали, знает Boosty, а не сайт, поэтому счётчика «осталось» там нет.' },
      { name:'ticketsLeft', label:'Осталось билетов', type:'number',
        hint:'Только для продажи на сайте. Уменьшай вручную по мере продаж, как у мерча; 0 — кнопка превращается в «Билеты закончились». При продаже через Boosty это число нигде не показывается.' },
      { name:'lineup', label:'Состав по жанрам', type:'strings',
        hint:'По строке на жанр, в формате «ЖАНР: имя, имя, имя». Например: GRIME: SPIESKEY, ESKI M, SAPA13. Цвет плашки подбирается по названию жанра (BOOMBAP, GARAGE, GRIME, DJ), остальные — серым.' },
      { name:'note', label:'Отдельный текст о событии', type:'textarea',
        hint:'Необязательно. Встанет под датой, над составом. Про паспорт и 18+ писать не надо — это сайт говорит сам.' }
    ]
  },
  /* Подписи участников. Раньше лежали только в коде (ARTIST_BIOS в config.js),
     и добавить строку про нового человека без программиста было нельзя —
     поэтому подписи к EP.08 оказались свалены в «Отдельный текст о выпуске»
     и вылезли на главной сплошной простынёй. Теперь это обычный раздел. */
  artists: {
    file: 'data/artists.json',
    key: 'artists',
    title: 'Участники',
    one: 'участника',
    summary: it => (it.name || '(без имени)') + (it.bio ? '' : ' — без подписи'),
    blank: () => ({ name:'', bio:'' }),
    fields: [
      { name:'name', label:'Имя', type:'text',
        hint:'Точно как в списке участников выпуска, включая регистр: GANGSBURG, КАЖЭ ОБОЙМА. Не совпадёт — подпись не подставится.' },
      { name:'bio', label:'Подпись', type:'textarea',
        hint:'Одна строка о человеке, со строчной буквы и без имени в начале: «ветеран жанра, участник GOH». На сайте встаёт после имени через тире. Оставь пустым — человек уйдёт в строку «также», как диджеи.' }
    ]
  }
};

/* ---------------------------------------------------------------------
   GITHUB API
   --------------------------------------------------------------------- */
let token = '';
const state = {};   // collection -> { data, sha, dirty }

/* Где держать токен. localStorage — на своём устройстве, sessionStorage —
   на чужом: он исчезает вместе с вкладкой, даже если про «Выйти» забыли.
   Оба в try/catch: в приватном режиме запись может бросить исключение,
   и редактор должен просто работать до конца сессии, а не падать. */
function tokenStore(remember){
  try{ return remember ? localStorage : sessionStorage; }catch(e){ return null; }
}
function saveToken(value, remember){
  try{
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    const store = tokenStore(remember);
    if (store) store.setItem(TOKEN_KEY, value);
  }catch(e){ /* хранилище недоступно — токен живёт только в памяти вкладки */ }
}
function readToken(){
  try{ return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; }
  catch(e){ return ''; }
}
function forgetToken(){
  try{ localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); }catch(e){}
}

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
