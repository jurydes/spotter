let currentTab = 'home';
let route = { tab: 'home' }; // разбор location.hash, см. parseRoute()
let cart = [];                // { productId, size, qty }
// Псевдокатегория «Всё» — не лежит в данных товаров, это сброс фильтра
const ALL_CATEGORY = 'Всё';
let activeFilter = ALL_CATEGORY;
let episodeSort = 'new';      // порядок выпусков: 'new' | 'views'
let modalProduct = null;
let modalSize = null;
let modalQty = 1;
let modalMsg = '';           // подтверждение добавления, живёт как состояние модалки
let modalPhoto = 0;          // какое фото товара показано в галерее
// Оформленный заказ: номер, состав с номерами вещей и готовый текст для
// телеграма. Переживает перезагрузку — человек, который вернулся на сайт
// через час, должен увидеть, что заказ уже оформлен, а не пустую корзину
// и соблазн заказать второй раз.
let placedOrder = null;
const ORDER_KEY = 'spotter-order-v1';
// Поля оформления держим состоянием, а не читаем из DOM по факту: подвал
// корзины перерисовывается при каждом изменении количества, и набранные
// имя с телефоном иначе стирались бы на ровном месте.
let checkoutForm = { name:'', phone:'', telegram:'', delivery:'Самовывоз', city:'', comment:'', point:null };
let cdekPoints = [];         // найденные ПВЗ по последнему запросу
let cdekState = '';          // '' | 'loading' | 'error' | 'empty'
let cdekGeo = null;          // координаты покупателя для сортировки «ближайшие»
// Объяснение, почему корзина изменилась не по воле покупателя (размер
// разобрали, пока он оформлял). Живёт до следующего действия: если позицию
// убрали целиком, корзина становится пустой, и написать об этом внизу
// формы уже негде — сообщение должно быть видно и над пустой корзиной.
let cartNotice = '';
// Ошибки формы по полям. Раньше была одна строка внизу и по одной ошибке
// за попытку: человек чинил имя, жал «оформить», узнавал про телефон, и так
// по кругу. Теперь проверяем всё сразу и пишем каждую претензию под своим
// полем — рядом с тем, что надо исправить.
let checkoutErrors = {};
function errHtml(key){
  return checkoutErrors[key]
    ? `<div class="field-err" data-err="${key}">${escapeHtml(checkoutErrors[key])}</div>`
    : '';
}
function badAttr(key){ return checkoutErrors[key] ? ' class="bad"' : ''; }

/* =====================================================================
   UTIL
   ===================================================================== */
// Обработчик на элемент страницы, которого может не оказаться. Звучит как
// перестраховка, но однажды уже положило сайт целиком: CDN отдал свежий
// app.js со старым index.html, строка на верхнем уровне упала на отсутствующем
// элементе — и весь остаток файла, включая init(), просто не выполнился.
// Пустая страница вместо одной неработающей кнопки. Теперь худшее, что может
// случиться при таком рассинхроне, — временно не работает одна кнопка.
function bindEl(id, event, handler){
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
  return el;
}
// Открыт ли оверлей. Отсутствующий элемент = закрыт, по той же причине,
// что и bindEl выше: одна строчка разметки не должна ронять страницу.
function isOpen(id){
  const el = document.getElementById(id);
  return !!el && el.classList.contains('open');
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[s]));
}
function formatPrice(n){ return n.toLocaleString('ru-RU') + ' ₽'; }
function toRoman(n){
  const map = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let out = '';
  for (const [v,s] of map){ while(n>=v){ out+=s; n-=v; } }
  return out || String(n);
}
function chapterLabel(ch){ return `CHAPTER ${toRoman(ch)}`; }
function findProduct(id){ return CONFIG.merch.find(p => p.id === id); }

/* =====================================================================
   УЧАСТНИКИ И АДРЕСА
   ===================================================================== */
// Один и тот же человек в данных подписан по-разному (JEWELZ / JEWELZ PART II).
// Всё, что показывается и сравнивается, проходит через эту функцию.
function canonicalArtist(name){ return ARTIST_ALIASES[name] || name; }

// Латиницей и без пробелов — чтобы ссылка на участника читалась глазами:
// #/artist/pra-killagramm вместо процентов кодировки.
const TRANSLIT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
  'х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
};
function slugify(str){
  return String(str).toLowerCase().split('').map(ch => TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch)
    .join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function artistSlug(name){ return slugify(canonicalArtist(name)); }
function episodeSlug(ep){
  if (ep.standalone || ep.chapter == null) return slugify(ep.title);
  return `ch${ep.chapter}-ep${String(ep.number).padStart(2,'0')}`;
}
function findEpisodeBySlug(slug){ return CONFIG.episodes.find(e => episodeSlug(e) === slug); }
// Все участники в порядке первого появления, уже без дублей
function allArtists(){
  const list = [];
  CONFIG.episodes.forEach(ep => (ep.artists || []).forEach(a => {
    const name = canonicalArtist(a);
    if (!list.includes(name)) list.push(name);
  }));
  return list;
}
// Короткая подпись участника из ARTIST_BIOS. Нет в таблице — пустая строка.
function artistBio(name){
  return ARTIST_BIOS[canonicalArtist(name)] || '';
}
// Состав выпуска: имя + подпись, по строке на человека.
// Раньше здесь был просто ряд имён через точку — теперь у каждого своя строка
// из ARTIST_BIOS. Имена не дублируются: сплошной ряд остаётся только для тех,
// у кого подписи нет (сейчас это диджеи), и уходит в отдельную строку «за пультом».
function lineupBiosHtml(ep){
  const names = (ep.artists || [])
    .map(a => canonicalArtist(a))
    .filter((name, i, all) => all.indexOf(name) === i);
  const link = name => `<a class="artist-link" href="#/artist/${artistSlug(name)}">${escapeHtml(name)}</a>`;
  const withBio = names.filter(artistBio);
  const rest = names.filter(n => !artistBio(n));
  if (!withBio.length){
    // подписей нет вообще — показываем как раньше, сплошным рядом
    return names.length
      ? `<div class="artists">${names.map(link).join('<span class="artist-sep">·</span>')}</div>`
      : '';
  }
  const dj = canonicalArtist(ep.dj || '');
  return `
    <ul class="lineup-bios">
      ${withBio.map(name => `
      <li>${link(name)}<span class="bio-dash">—</span><span class="bio-text">${escapeHtml(artistBio(name))}</span></li>`).join('')}
    </ul>
    ${rest.length ? `<div class="artists lineup-rest">
      <span class="lineup-rest-label">${rest.length === 1 && rest[0] === dj ? 'за пультом' : 'также'}</span>
      ${rest.map(link).join('<span class="artist-sep">·</span>')}
    </div>` : ''}`;
}
function episodesOfArtist(name){
  const target = canonicalArtist(name);
  return CONFIG.episodes.filter(ep => (ep.artists || []).some(a => canonicalArtist(a) === target));
}
// Абсолютный адрес — нужен кнопке «поделиться»: относительный в мессенджере
// бесполезен. Через location.href, а не origin: у file:// origin равен "null".
function absoluteUrl(hash){
  return location.href.split('#')[0] + hash;
}

/* =====================================================================
   ПРОСМОТРЫ. Три источника, от надёжного к свежему:

   1. EPISODE_VIEWS в конфиге — снимок, вшитый в код. Работает всегда,
      без сети и без ключей. Это то, что увидит посетитель, если всё
      остальное недоступно.

   2. assets/views.json — файл, который на сервере раз в час переписывает
      tools/update-views.sh (или .php). Ключ при этом лежит на сервере,
      в браузер не попадает, а сайт просто читает готовые числа. Это
      основной способ держать просмотры свежими.

   3. YouTube API прямо из браузера — только если заполнен
      CONFIG.youtubeApiKey. Тогда ключ виден всем в исходниках страницы,
      поэтому вариант 2 предпочтительнее.

   Любая ошибка на шагах 2-3 — молча остаёмся на предыдущем источнике:
   просмотры это украшение, ронять из-за них страницу нельзя.
   ===================================================================== */
const VIEWS_JSON_URL = 'assets/views.json';
const VIEWS_CACHE_KEY = 'spotter-views-v1';
const VIEWS_TTL_MS = 6 * 60 * 60 * 1000;
let liveViews = {};

function videoIdOf(ep){
  const m = /[?&]v=([\w-]{11})/.exec(ep.youtubeUrl || '');
  return m ? m[1] : null;
}
function viewsFor(ep){
  const id = videoIdOf(ep);
  if (!id) return null;
  const v = liveViews[id] !== undefined ? liveViews[id] : EPISODE_VIEWS[id];
  return typeof v === 'number' ? v : null;
}
function formatViews(n){
  return n.toLocaleString('ru-RU') + ' ' + plural(n, 'просмотр', 'просмотра', 'просмотров');
}

// Читает assets/views.json, который обновляет серверный скрипт по расписанию.
// Возвращает true, если числа получены.
// К адресу приклеивается метка текущего часа: без неё браузер и CDN отдавали бы
// закэшированный файл и обновление раз в час не доезжало бы до посетителя.
async function loadViewsFile(){
  const hourStamp = new Date().toISOString().slice(0, 13).replace(/[-T]/g, '');
  try{
    const res = await fetch(`${VIEWS_JSON_URL}?h=${hourStamp}`, { cache: 'no-cache' });
    if (!res.ok) return false;             // файла ещё нет — это нормально
    const data = await res.json();
    const views = data && data.views;
    if (!views || typeof views !== 'object') return false;
    const next = {};
    Object.keys(views).forEach(id => {
      const n = Number(views[id]);
      if (Number.isFinite(n)) next[id] = n;
    });
    if (!Object.keys(next).length) return false;
    liveViews = next;
    render();
    return true;
  }catch(e){
    return false;                          // локальный просмотр через file:// или нет сети
  }
}
async function refreshViews(){
  if (await loadViewsFile()) return;       // на сервере есть свежий файл — этого достаточно
  const key = (CONFIG.youtubeApiKey || '').trim();
  if (!key) return;                        // ключа нет — живём на снимке
  try{
    const cached = JSON.parse(localStorage.getItem(VIEWS_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < VIEWS_TTL_MS){
      liveViews = cached.views;
      render();
      return;
    }
  }catch(e){ /* кэш испорчен — просто сходим в сеть */ }

  const ids = CONFIG.episodes.map(videoIdOf).filter(Boolean).slice(0, 50);
  if (!ids.length) return;
  try{
    const url = 'https://www.googleapis.com/youtube/v3/videos'
      + '?part=statistics&id=' + ids.join(',') + '&key=' + encodeURIComponent(key);
    const res = await fetch(url);
    if (!res.ok) return;                  // неверный ключ, кончилась квота, домен не разрешён
    const data = await res.json();
    const next = {};
    (data.items || []).forEach(item => {
      const n = Number(item.statistics && item.statistics.viewCount);
      if (Number.isFinite(n)) next[item.id] = n;
    });
    if (!Object.keys(next).length) return;
    liveViews = next;
    try{ localStorage.setItem(VIEWS_CACHE_KEY, JSON.stringify({ at: Date.now(), views: next })); }catch(e){}
    render();
  }catch(e){ /* сеть недоступна — остаёмся на снимке */ }
}
/* =====================================================================
   КОНТЕНТ ИЗ АДМИНКИ.

   CONFIG.episodes / CONFIG.merch выше — запасной снимок, зашитый в код,
   как и с просмотрами. Настоящий источник — data/episodes.json и
   data/merch.json: их правит Decap CMS (/admin) и коммитит прямо в
   репозиторий. При заходе на сайт пробуем подгрузить эти файлы и, если
   получилось, подменяем ими CONFIG.episodes/merch и перерисовываем.
   Любая ошибка (файла нет, сеть недоступна, открыли через file://) —
   молча остаёмся на снимке из config.js.
   ===================================================================== */
const EPISODES_JSON_URL = 'data/episodes.json';
const MERCH_JSON_URL = 'data/merch.json';

// Файл — объект с одним ключом-массивом (а не голый массив в корне): так его
// понимает и Decap CMS (список-виджет как единственное поле файла), и fetch здесь.
async function fetchJsonList(url, key){
  try{
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = await res.json();
    const list = data && data[key];
    return Array.isArray(list) && list.length ? list : null;
  }catch(e){
    return null;                           // локальный просмотр через file:// или нет сети
  }
}
async function loadContentData(){
  const [episodes, merch] = await Promise.all([
    fetchJsonList(EPISODES_JSON_URL, 'episodes'),
    fetchJsonList(MERCH_JSON_URL, 'merch')
  ]);
  if (!episodes && !merch) return;
  if (episodes) CONFIG.episodes = episodes;
  if (merch) CONFIG.merch = merch;
  applyRoute();
}

// Плейсхолдер — плоский чёрный прямоугольник в размере реального блока
// (карточки/обложки), без градиента и подписи: так видно точные пропорции
// до того, как встанут настоящие фото.
function placeholderPhoto(){
  return `<div class="ph-photo viewfinder">
    <span class="vf-corner vf-tl"></span><span class="vf-corner vf-tr"></span>
    <span class="vf-corner vf-bl"></span><span class="vf-corner vf-br"></span>
  </div>`;
}
// Обложка эпизода: реальное фото, если путь есть в ep.cover, иначе — плейсхолдер.
function coverPhoto(ep, eager){
  // Таймкод — реальная длительность ролика, берётся из CONFIG.episodes[].duration
  const tc = ep.duration ? `<span class="tc">${escapeHtml(ep.duration)}</span>` : '';
  // Обложка на первом экране грузится в приоритете: это самая крупная картинка
  // страницы, и откладывать её — значит показывать пустой прямоугольник.
  const load = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  if (ep.cover){
    return `<div class="ph-photo viewfinder">
      <img src="${escapeHtml(ep.cover)}" alt="${escapeHtml(ep.title)}" ${load} decoding="async" style="width:100%;height:100%;object-fit:cover;display:block;">
      ${tc}
      <span class="vf-corner vf-tl"></span><span class="vf-corner vf-tr"></span>
      <span class="vf-corner vf-bl"></span><span class="vf-corner vf-br"></span>
    </div>`;
  }
  return placeholderPhoto();
}
// Все фотографии товара списком. Несколько фото — в карточке товара
// появляются миниатюры, первое всегда главное (показывается в списке).
function productImages(p){
  return Array.isArray(p.images) ? p.images : [];
}
// Фото товара: реальное фото, если оно есть, иначе — плейсхолдер.
// index — какое из фото показать (для галереи в карточке товара).
/* Решает, обрезать картинку по рамке или показать целиком.

   Мерить пропорции, а не полагаться на «сетка всегда последняя»: порядок
   фото продавец меняет перетаскиванием в админке, и любое правило по
   позиции однажды разъедется. А вот форма у таблицы с размерами своя —
   заметно уже и выше кадра со съёмкой, и по ней её видно надёжно.

   Порог 15%: обычная портретная съёмка расходится с рамкой 4:5 примерно
   на десятую, размерная сетка — вдвое сильнее. Мелкая разница пусть
   по-прежнему подрезается, иначе поля появятся у нормальных фото. */
function autoFitPhoto(root){
  const box = root && root.querySelector('.ph-photo');
  const img = box && box.querySelector('.ph-img');
  if (!img) return;
  const apply = ()=>{
    if (!img.naturalWidth || !img.naturalHeight) return;
    box.style.aspectRatio = ''; // сначала вернуть рамку к обычной, иначе сравним с прошлой
    const boxRatio = box.clientWidth / box.clientHeight;
    if (!boxRatio) return;
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const odd = Math.abs(imgRatio - boxRatio) / boxRatio > 0.15;
    img.classList.toggle('fit-contain', odd);
    // Одного contain мало: в рамке 4:5 сетка ужималась до 39% оригинала,
    // и цифры в таблице читались с трудом. Поэтому под такую картинку
    // рамка подстраивается сама — тогда сетка занимает всю ширину колонки.
    // Ограничение 1:2 — чтобы случайная очень длинная картинка не растянула
    // окно на два экрана.
    box.style.aspectRatio = odd ? `${img.naturalWidth}/${Math.min(img.naturalHeight, img.naturalWidth * 2)}` : '';
  };
  if (img.complete) apply();
  else img.addEventListener('load', apply, { once: true });
}
function productPhoto(p, index){
  const images = productImages(p);
  const src = images[index || 0] || images[0];
  if (src){
    return `<div class="ph-photo viewfinder">
      <img class="ph-img" src="${src}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async">
      <span class="vf-corner vf-tl"></span><span class="vf-corner vf-tr"></span>
      <span class="vf-corner vf-bl"></span><span class="vf-corner vf-br"></span>
    </div>`;
  }
  return placeholderPhoto();
}

/* =====================================================================
   ОСТАТКИ.

   Раньше остатки жили в хранилище и списывались при оформлении заказа.
   На обычном хостинге это была фикция: хранилище было доступно только
   внутри среды артефактов, а без него всё уходило в переменную в памяти
   вкладки — у каждого посетителя свои «остатки», списание видел только
   он сам, и после перезагрузки всё возвращалось.

   Теперь остаток — одно число на товар (editionLeft), и правит его продавец
   руками. Сайт его не списывает: он не знает, дошёл ли заказ до продавца
   и подтверждён ли он. «Осталось 18 из 20» — справка, а не бронь.

   Настоящая общая на всех посетителей бронь возможна только с бэкендом:
   тогда availableFor подменяется запросом к нему, остальной код не меняется.
   ===================================================================== */
/* Остаток = тираж из админки минус то, что уже заказали другие.

   Заказы копятся в таблице (лист «Резерв»), оттуда и берётся вычитаемое.
   Раньше сайт не вычитал ничего: восемь человек могли заказать пять худи
   размера L, и разбираться с этим пришлось бы в переписке. Для тиража
   с номерами на вещах это особенно плохо — номера уже выданы.

   Если таблица недоступна, reservedStock пуст, и остаток просто равен
   тиражу: продавать без связи лучше, чем не продавать вообще. Настоящая
   проверка всё равно происходит на стороне таблицы в момент заказа. */
let reservedStock = {};       // 'id|размер' -> сколько занято
// Выключатель всей этой механики, CONFIG.reserveStock. Выключено — остаток
// равен тиражу из админки, как было до резерва.
function reserveEnabled(){ return CONFIG.reserveStock === true; }
/* Тираж общий, а не по размерам.

   На предзаказе шьётся партия целиком, и заранее неизвестно, каких размеров
   из неё возьмут больше. Поэтому счётчик один на товар: «осталось 18 из 20»,
   а какой размер выберут — дело покупателя. Раскладку по размерам считают
   уже по собранным заказам, а не угадывают до старта.

   editionTotal / editionLeft задаются в товаре и правятся руками. Если их
   нет — падаем на старую схему и складываем остатки по размерам, чтобы
   товары, которые так и не перевели на тираж, не сломались. */
function editionTotal(product){
  if (!product) return 0;
  if (typeof product.editionTotal === 'number') return Math.max(product.editionTotal, 0);
  return sumSizeStock(product);
}
function editionLeft(product){
  if (!product) return 0;
  if (typeof product.editionLeft === 'number') return Math.max(product.editionLeft, 0);
  return sumSizeStock(product);
}
function sumSizeStock(product){
  if (!product || !product.stock) return 0;
  return (product.sizes || []).reduce((a, s)=>{
    const v = product.stock[s];
    return a + (typeof v === 'number' ? v : 0);
  }, 0);
}
function usesEdition(product){
  return !!product && (typeof product.editionLeft === 'number' ||
                       typeof product.editionTotal === 'number');
}
// Сколько ещё можно положить в корзину: общий остаток минус уже отложенное,
// по всем размерам сразу.
function availableFor(productId){
  const p = findProduct(productId);
  if (!p) return 0;
  const taken = reservedStock[productId] || 0; // резерв по товару, не по размеру
  return Math.max(editionLeft(p) - taken - qtyInCartForProduct(productId), 0);
}
// Потолок для конкретного размера: то, что уже выбрано в нём, плюс свободный
// остаток тиража. Отдельного лимита на размер больше нет.
function capForSize(productId, size){
  return qtyInCart(productId, size) + availableFor(productId);
}
// Тираж как он задан в админке, без вычета резерва. Нужен таблице:
// она знает, сколько заказано, но не знает, сколько всего выпускается.
//
// У товаров с общим тиражом лимита на размер нет, а таблица считает
// заказанное именно по паре «товар + размер». Поэтому здесь возвращаем
// null: скрипт тогда ничего не проверяет. Пересчёт резерва под общий
// тираж — отдельная работа, и пока она не нужна, счёт ведётся руками.
function stockLimitFor(productId, size){
  const p = findProduct(productId);
  if (!p || usesEdition(p)) return null;
  const v = p.stock ? p.stock[size] : null;
  return typeof v === 'number' ? v : null;
}
function applyReserved(map){
  if (!reserveEnabled()) return;
  if (!map || typeof map !== 'object') return;
  reservedStock = map;
}
async function loadReservedStock(){
  if (!reserveEnabled() || !CONFIG.surveySheetUrl) return;
  try{
    const res = await fetch(`${CONFIG.surveySheetUrl}?stock=1`);
    const data = res.ok ? await res.json() : null;
    if (data && data.reserved){
      applyReserved(data.reserved);
      render(); // остатки на витрине могли измениться
      if (modalProduct) renderModal();
    }
  }catch(e){ /* нет связи — торгуем по тиражу из админки */ }
}

/* =====================================================================
   КОРЗИНА — localStorage, переживает перезагрузку и закрытие вкладки.
   Всё в try/catch: в приватном режиме и при запрете хранилища запись
   бросает исключение, и корзина должна просто работать в пределах
   сессии, а не ронять страницу.
   ===================================================================== */
const CART_KEY = 'spotter-cart-v1';
function loadCart(){
  try{
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // отсеиваем позиции, которых больше нет в каталоге или в размерной сетке
    cart = Array.isArray(parsed) ? parsed.filter(c => {
      const p = findProduct(c.productId);
      return p && p.sizes.includes(c.size) && c.qty > 0;
    }) : [];
  }catch(e){ cart = []; }
}
function saveCart(){
  try{ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }catch(e){}
}
function cartTotalQty(){ return cart.reduce((a,c) => a + c.qty, 0); }
function cartTotalPrice(){
  return cart.reduce((sum,c) => {
    const p = findProduct(c.productId);
    return sum + (p ? p.price * c.qty : 0);
  }, 0);
}
function qtyInCart(productId, size){
  const item = cart.find(c => c.productId === productId && c.size === size);
  return item ? item.qty : 0;
}
function addToCart(productId, size, qty){
  // Место считается по тиражу целиком: неважно, в каком размере оно занято
  const room = availableFor(productId);
  if (room <= 0) return false;
  const add = Math.min(qty, room);
  const existing = cart.find(c => c.productId === productId && c.size === size);
  if (existing) existing.qty += add;
  else cart.push({ productId, size, qty: add });
  cartNotice = ''; // объяснение прошлой правки корзины больше не актуально
  saveCart();
  renderCartCount();
  return add === qty;
}
function removeFromCart(productId, size){
  cart = cart.filter(c => !(c.productId === productId && c.size === size));
  saveCart();
  renderCartCount();
  renderDrawer();
  render(); // товара в корзине больше нет — кнопка на карточке снова «Добавить»
}
function setCartQty(productId, size, qty){
  const item = cart.find(c => c.productId === productId && c.size === size);
  if (!item) return;
  if (qty <= 0){ removeFromCart(productId, size); return; }
  item.qty = Math.min(qty, capForSize(productId, size));
  saveCart();
  renderCartCount();
  renderDrawer();
}

/* =====================================================================
   RENDER: NAV
   ===================================================================== */
function renderCartCount(){
  document.getElementById('cartCount').textContent = cartTotalQty();
}
/* =====================================================================
   РОУТИНГ ПО АДРЕСУ.

   Раньше вкладки были состоянием в памяти: адрес всегда один, поделиться
   разделом или товаром нельзя, а кнопка «назад» уводила с сайта.
   Теперь состояние живёт в location.hash, и браузерная история работает
   сама. Хеш, а не обычные пути, — чтобы сайт оставался статикой и не
   требовал настройки сервера.

     #/                       главная
     #/episodes               все выпуски
     #/merch                  мерч
     #/artist/<имя>           выпуски одного участника
     #/episode/<глава-номер>  выпуски с подсветкой конкретного (ссылка «поделиться»)
     #/product/<id>           мерч с открытой карточкой товара
   ===================================================================== */
function parseRoute(){
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [head, tail] = [raw.split('/')[0] || 'home', raw.split('/').slice(1).join('/')];
  switch (head){
    case 'episodes': return { tab:'episodes' };
    case 'merch':    return { tab:'merch' };
    case 'artist':   return { tab:'artist', artist: decodeURIComponent(tail) };
    case 'episode':  return { tab:'episodes', episode: decodeURIComponent(tail) };
    case 'product':  return { tab:'merch', product: decodeURIComponent(tail) };
    default:         return { tab:'home' };
  }
}
function navigate(hash){
  if (location.hash === hash) applyRoute();
  else location.hash = hash;      // hashchange сам вызовет applyRoute
}
function applyRoute(){
  const prev = route;
  route = parseRoute();
  currentTab = route.tab;
  // подсветка вкладок: страница участника относится к разделу «Выпуски»
  const navTab = route.tab === 'artist' ? 'episodes' : route.tab;
  document.querySelectorAll('#tabsDesktop button, #tabsMobile button').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab === navTab);
  });
  render();

  // Товар: карточка — часть адреса, поэтому «назад» её закрывает
  if (route.product){
    if (!modalProduct || modalProduct.id !== route.product) openProduct(route.product, true);
  } else if (modalProduct){
    closeProduct(true);
  }

  // Ссылка на конкретный выпуск: доскроллить и подсветить
  if (route.episode){
    const card = document.querySelector(`[data-episode="${CSS.escape(route.episode)}"]`);
    if (card){
      card.classList.add('ep-focused');
      card.scrollIntoView({ block:'center', behavior: prev.tab ? 'smooth' : 'auto' });
      return;
    }
  }
  if (!route.product) window.scrollTo({ top:0, behavior:'auto' });
}
window.addEventListener('hashchange', applyRoute);
bindEl('tabsDesktop', 'click', e=>{
  const b = e.target.closest('button'); if(!b) return;
  navigate(b.dataset.tab === 'home' ? '#/' : '#/' + b.dataset.tab);
});
bindEl('tabsMobile', 'click', e=>{
  const b = e.target.closest('button'); if(!b) return;
  navigate(b.dataset.tab === 'home' ? '#/' : '#/' + b.dataset.tab);
});

/* =====================================================================
   RENDER: HOME
   ===================================================================== */
function renderHome(){
  const numbered = CONFIG.episodes.filter(e => e.number != null);
  const maxChapter = Math.max(...CONFIG.episodes.filter(e => e.chapter != null).map(e => e.chapter));
  const latestPool = numbered.filter(e => e.chapter === maxChapter);
  const latest = [...latestPool].sort((a,b)=>b.number-a.number)[0] || numbered[0] || CONFIG.episodes[0];
  const shownMerch = visibleMerch();
  const popular = shownMerch.find(p=>p.popular) || shownMerch[0] || null;
  // новинка — последний добавленный товар на витрине, но не тот же, что уже
  // показан как популярный (иначе на главной дублировалась одна и та же карточка).
  // Если включённый товар всего один — второй карточки просто не будет.
  const newest = popular ? [...shownMerch].reverse().find(p => p.id !== popular.id) || null : null;
  const chapterTag = chapterLabel(latest.chapter);
  const latestBadge = latest.number != null ? `${chapterTag} · EP.${String(latest.number).padStart(2,'0')}` : chapterTag;

  return `
  <section class="hero" style="border-top:none;">
    <div class="wrap hero-grid">
      <div class="hero-text">
        <div class="badge-rec"><span class="dot"></span> НОВЫЙ ВЫПУСК · ${latestBadge}</div>
        <h1>${escapeHtml(latest.title)}</h1>
        ${latest.description ? `<p class="lead">${escapeHtml(latest.description)}</p>` : ''}
        ${lineupBiosHtml(latest)}
        ${latest.youtubeUrl
          ? `<a class="btn" href="${latest.youtubeUrl}" target="_blank" rel="noopener">Смотреть выпуск</a>`
          : `<span class="stock-note mono">ссылка появится позже</span>`}
      </div>
      ${latest.youtubeUrl ? `<a class="hero-photo viewfinder" href="${latest.youtubeUrl}" target="_blank" rel="noopener" style="display:block;">
        ${coverPhoto(latest, true)}
      </a>` : `<div class="hero-photo viewfinder">${coverPhoto(latest, true)}</div>`}
    </div>
  </section>

  ${tickerHtml()}

  ${upcomingHtml()}

  <section>
    <div class="wrap about-cols">
      <h2>О проекте</h2>
      <div>
        ${CONFIG.aboutParagraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}
        <div class="about-quote">${escapeHtml(CONFIG.aboutQuote)}</div>
      </div>
    </div>
  </section>

  ${popular ? `
  <section>
    <div class="wrap">
      <div class="section-head">
        <h2>Мерч</h2>
      </div>
      <div class="merch-grid">
        ${newest ? productCardHtml(newest, 'Новый дроп') : ''}
        ${productCardHtml(popular, newest ? 'Популярное' : null)}
      </div>
      </div>
    </div>
  </section>` : ''}
  `;
}

// Бегущая строка под первым экраном — состав площадки: все, кто хоть раз
// выходил в выпусках, в порядке первого появления. Список дублируется, чтобы
// анимация на -50% зациклилась без стыка.
// Кого не показывать в бегущей строке на главной — из выпусков и подписи
// участника это не убирает, только из этой ленты.
const TICKER_EXCLUDE = new Set([
  'CHENOSKE', 'VERLIEBER', 'MATI BOY', 'YA DIGG KAPUSTU!', 'EEUGENE SPEED', 'T!MMI', 'RECEPT'
]);
function tickerHtml(){
  const roster = allArtists().filter(a => !TICKER_EXCLUDE.has(a));
  if (!roster.length) return '';
  const line = roster.map(a =>
    `<a href="#/artist/${artistSlug(a)}">${escapeHtml(a)}</a><span class="sep">/</span>`
  ).join('');
  return `<div class="ticker"><div class="ticker-track">${line}${line}</div></div>`;
}

// Анонс следующего выпуска. Пока CONFIG.upcoming пуст — блока просто нет.
function upcomingHtml(){
  const u = CONFIG.upcoming;
  if (!u || !u.title) return '';
  const meta = [u.date, u.place].filter(Boolean).map(escapeHtml).join(' · ');
  return `
  <section class="upcoming-section">
    <div class="wrap upcoming">
      <div class="upcoming-tag mono">СКОРО</div>
      <div class="upcoming-body">
        <h2>${escapeHtml(u.title)}</h2>
        ${meta ? `<div class="upcoming-meta mono">${meta}</div>` : ''}
        ${u.lineup && u.lineup.length ? `<div class="artists">${u.lineup.map(a =>
          `<a class="artist-link" href="#/artist/${artistSlug(a)}">${escapeHtml(canonicalArtist(a))}</a>`
        ).join('<span class="artist-sep">·</span>')}</div>` : ''}
        ${u.note ? `<p class="lead">${escapeHtml(u.note)}</p>` : ''}
        ${u.link ? `<a class="btn" href="${escapeHtml(u.link)}" target="_blank" rel="noopener">Подробности</a>` : ''}
      </div>
    </div>
  </section>`;
}

/* =====================================================================
   RENDER: EPISODES
   ===================================================================== */
/* =====================================================================
   СОРТИРОВКА ВЫПУСКОВ.

   «Сначала новые» — привычный архив: главы сверху вниз, внутри главы
   выпуски от большего номера к меньшему.

   «Популярные» — сквозной список по просмотрам, без деления на главы:
   деление тут только мешало бы, потому что смысл именно в общем рейтинге.
   Выпуски без известного числа просмотров уходят в конец.
   ===================================================================== */
const EPISODE_SORTS = { new: 'Сначала новые', views: 'По просмотрам' };

function episodesByViews(){
  return [...CONFIG.episodes].sort((a,b) => {
    const va = viewsFor(a), vb = viewsFor(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va;
  });
}

function sortControlHtml(){
  return `
    <div class="sorts">
      <span class="sorts-label mono">Порядок</span>
      <div class="sorts-group">
        ${Object.entries(EPISODE_SORTS).map(([key,label])=>
          `<button data-sort="${key}" class="${key===episodeSort?'active':''}">${escapeHtml(label)}</button>`
        ).join('')}
      </div>
    </div>`;
}

function renderEpisodes(){
  if (episodeSort === 'views'){
    return `
    <section style="border-top:none;">
      <div class="wrap">
        <div class="section-head">
          <h2>Выпуски</h2>
          <div class="head-actions">
            ${sortControlHtml()}
            <button class="btn-outline btn-sm" data-random-episode>Случайный выпуск</button>
          </div>
        </div>
        <div class="ep-grid">${episodesByViews().map(ep => episodeCardHtml(ep, true)).join('')}</div>
      </div>
    </section>
    `;
  }
  return renderEpisodesByChapter();
}

function renderEpisodesByChapter(){
  // сортировка сверху вниз: сначала более новая глава, внутри главы — от большего номера
  // к меньшему; выпуски без номера (нумерацию пришлют позже) — в конце своей главы.
  const chapters = [...new Set(CONFIG.episodes.filter(e => e.chapter != null).map(e => e.chapter))].sort((a,b)=>b-a);

  const chapterBlocks = chapters.map(ch => {
    const eps = CONFIG.episodes
      .filter(e => e.chapter === ch)
      .sort((a,b)=>{
        if (a.number == null && b.number == null) return 0;
        if (a.number == null) return 1;
        if (b.number == null) return -1;
        return b.number - a.number;
      });
    const cards = eps.map(ep => episodeCardHtml(ep, false)).join('');
    return `
      <div class="chapter-head"><h3>${escapeHtml(chapterLabel(ch))}</h3></div>
      <div class="ep-grid">${cards}</div>
    `;
  }).join('');

  const standalone = CONFIG.episodes.filter(e => e.standalone);
  const standaloneBlock = standalone.length === 0 ? '' : `
    <div class="chapter-head"><h3>ВНЕ ГЛАВ</h3></div>
    <div class="ep-grid">${standalone.map(ep => episodeCardHtml(ep, false)).join('')}</div>
  `;

  return `
  <section style="border-top:none;">
    <div class="wrap">
      <div class="section-head">
        <h2>Выпуски</h2>
        <div class="head-actions">
          ${sortControlHtml()}
          <button class="btn-outline btn-sm" data-random-episode>Случайный выпуск</button>
        </div>
      </div>
      ${chapterBlocks}
      ${standaloneBlock}
    </div>
  </section>
  `;
}

// Карточка выпуска — одна на все места: архив, страница участника, подсветка
// по ссылке. Раньше эта разметка была продублирована для глав и для выпусков
// вне глав, и правку приходилось вносить дважды.
// showChapter — когда карточки идут сквозным списком (по просмотрам, на странице
// участника), номера выпусков повторяются от главы к главе, и «EP.01» без главы
// не опознать. Под заголовком главы это, наоборот, лишнее.
function episodeCardHtml(ep, showChapter){
  const slug = episodeSlug(ep);
  const views = viewsFor(ep);
  const chapterTag = showChapter && ep.chapter != null ? chapterLabel(ep.chapter) + ' · ' : '';
  const numLabel = `${chapterTag}${ep.number != null ? 'EP.'+String(ep.number).padStart(2,'0') : 'ВНЕ ГЛАВ'}`;
  return `
    <div class="ep-card" data-episode="${escapeHtml(slug)}">
      <div class="ep-cover">${coverPhoto(ep)}</div>
      <div class="ep-meta">
        <span>${escapeHtml(numLabel)}</span>
        ${views != null ? `<span>${escapeHtml(formatViews(views))}</span>` : ''}
      </div>
      <div class="ep-body">
        <h3>${escapeHtml(ep.title)}</h3>
        ${ep.description ? `<p>${escapeHtml(ep.description)}</p>` : ''}
        ${lineupBiosHtml(ep)}
        <div class="ep-actions">
          ${ep.youtubeUrl
            ? `<a class="ep-watch" href="${ep.youtubeUrl}" target="_blank" rel="noopener">Смотреть на YouTube</a>`
            : `<span class="stock-note mono">ссылка появится позже</span>`}
          <button class="ep-share" data-share="${escapeHtml(slug)}">Поделиться</button>
        </div>
      </div>
    </div>
  `;
}

/* =====================================================================
   RENDER: УЧАСТНИК — все выпуски одного человека
   ===================================================================== */
function renderArtist(slug){
  const name = allArtists().find(a => artistSlug(a) === slug);
  if (!name){
    return `
    <section style="border-top:none;"><div class="wrap">
      <div class="section-head"><h2>Участник не найден</h2></div>
      <p class="lead">Возможно, ссылка устарела. <a class="ep-watch" href="#/episodes">Все выпуски</a></p>
    </div></section>`;
  }
  const eps = episodesOfArtist(name);
  const asDj = eps.filter(e => canonicalArtist(e.dj || '') === name).length;
  // с кем чаще всего оказывался в одном сете
  const together = {};
  eps.forEach(ep => (ep.artists || []).forEach(a => {
    const other = canonicalArtist(a);
    if (other !== name) together[other] = (together[other] || 0) + 1;
  }));
  const frequent = Object.entries(together).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const facts = [`${eps.length} ${plural(eps.length,'выпуск','выпуска','выпусков')}`];
  if (asDj > 0) facts.push(`${asDj} ${plural(asDj,'раз','раза','раз')} за пультом`);

  return `
  <section style="border-top:none;">
    <div class="wrap">
      <a class="back-link" href="#/episodes">← Все выпуски</a>
      <div class="section-head">
        <h2>${escapeHtml(name)}</h2>
        <span class="section-note">${facts.join(' · ')}</span>
      </div>
      ${artistBio(name) ? `<p class="lead artist-bio">${escapeHtml(artistBio(name))}</p>` : ''}
      ${frequent.length ? `<div class="artist-together">
        <span class="field-label">Чаще всего в одном сете</span>
        <div class="artists">${frequent.map(([other,n]) =>
          `<a class="artist-link" href="#/artist/${artistSlug(other)}">${escapeHtml(other)} <span class="artist-count">${n}</span></a>`
        ).join('<span class="artist-sep">·</span>')}</div>
      </div>` : ''}
      <div class="ep-grid">${eps.map(ep => episodeCardHtml(ep, true)).join('')}</div>
    </div>
  </section>
  `;
}
// «1 выпуск / 2 выпуска / 5 выпусков»
function plural(n, one, few, many){
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/* =====================================================================
   RENDER: MERCH
   ===================================================================== */
// Товары с active:false лежат в данных, но на витрине не показываются —
// это выключатель из админки, чтобы прятать и возвращать товары, ничего
// не удаляя. Поле может отсутствовать (старые записи) — считаем включённым.
function visibleMerch(){
  return CONFIG.merch.filter(p => p.active !== false);
}
// Магазин работает по предзаказу, поэтому вместо «в наличии» так и пишем.
// Остаток при этом настоящий — это размер партии, и когда его остаётся мало,
// об этом честно сообщаем отдельной строкой.
function stockLabel(product){
  const left = editionLeft(product);
  if (left <= 0) return { text:'всё разобрали', cls:'stock-out' };
  // Тираж ограничен, и это главное, что нужно знать до покупки: показываем
  // оба числа. «Осталось 18» без «из 20» не говорит ни о чём — непонятно,
  // много это или мало.
  const total = editionTotal(product);
  if (usesEdition(product) && total > 0){
    return {
      text: `осталось ${left} из ${total}`,
      cls: left <= Math.max(Math.round(total * 0.25), 3) ? 'stock-low' : 'stock-ok'
    };
  }
  if (left <= 3) return { text:`осталось ${left}`, cls:'stock-low' };
  return { text:'предзаказ', cls:'stock-ok' };
}
// Сколько единиц этого товара уже лежит в корзине — по всем размерам сразу
function qtyInCartForProduct(productId){
  return cart.filter(c => c.productId === productId).reduce((a,c) => a + c.qty, 0);
}
function buyButtonHtml(product){
  // Товар уже в корзине — вместо повторного добавления даём переход в корзину.
  if (qtyInCartForProduct(product.id) > 0){
    return `<button class="btn-outline buy-btn" data-open-cart="${product.id}">Посмотреть корзину</button>`;
  }
  // Тираж разобран — кнопка не должна обещать предзаказ, которого не будет.
  if (editionLeft(product) <= 0){
    return `<button class="btn-outline buy-btn" disabled style="opacity:.4;cursor:not-allowed;">Тираж разобрали</button>`;
  }
  // Из списка товар в корзину не кладётся: размер нужно выбрать осознанно,
  // поэтому кнопка ведёт в карточку товара, где есть размеры и количество.
  return `<button class="btn buy-btn" data-choose-size="${product.id}">Предзаказ</button>`;
}
// Размер скидки за опрос. Через функцию, а не напрямую: config.js у части
// посетителей может быть старым, без этого поля — тогда 0, и всё, что
// связано со скидкой, просто не показывается.
function surveyDiscount(){
  return Number(CONFIG.surveyDiscount) || 0;
}
function priceAfterSurvey(product){
  return Math.max(product.price - surveyDiscount(), 0);
}
// Цена с зачёркнутой базовой и итоговой после опроса. Оба числа настоящие:
// 6 700 платит тот, кто опрос не проходит, 5 000 — кто прошёл. Без скидки
// в конфиге остаётся просто цена, как было.
function priceBlockHtml(p, note){
  const d = surveyDiscount();
  if (!d){
    return `<div class="price">${formatPrice(p.price)}${note ? ` <span class="price-note mono">${escapeHtml(note)}</span>` : ''}</div>`;
  }
  // Одна цена — та, что человек платит, — и рядом размер скидки отдельной
  // плашкой. Двух цен в ценнике намеренно нет: крупное число всегда совпадает
  // с тем, что стоит на кнопке и уйдёт в заказ.
  return `
    <div class="price-row">
      <span class="price">${formatPrice(p.price)}</span>
      <span class="price-badge mono">−${formatPrice(surveyDiscount())} за опрос</span>
      ${note ? `<span class="price-note mono">${escapeHtml(note)}</span>` : ''}
    </div>`;
}
// Сумму скидки на кнопке не повторяем: она уже названа плашкой у цены.
function surveyButtonHtml(product, cls){
  return `<button class="btn-outline ${cls}" data-open-survey="${product.id}">Пройти опрос</button>`;
}
// Общая карточка товара — используется и в сетке "Мерч", и на главной,
// чтобы карточки везде были одного размера и вида. tagText — необязательная
// плашка в углу ("Популярное" / "Новый дроп"), null — без плашки.
function productCardHtml(p, tagText){
  const st = stockLabel(p);
  return `
    <div class="merch-card" data-open-product="${p.id}">
      ${tagText ? `<div class="popular-tag">${escapeHtml(tagText)}</div>` : ''}
      ${productPhoto(p)}
      <div class="card-body">
        <h3>${escapeHtml(p.name)}</h3>
        ${priceBlockHtml(p)}
        <div class="stock-flag ${st.cls}">${st.text}</div>
        ${buyButtonHtml(p)}
        ${surveyButtonHtml(p, 'survey-btn')}
      </div>
    </div>`;
}
function renderMerch(){
  const shown = visibleMerch();
  const categories = [ALL_CATEGORY, ...new Set(shown.map(p=>p.category))];
  // Категория могла исчезнуть с витрины, пока фильтр был на ней выбран
  // (последний товар категории выключили в админке) — кнопки такой категории
  // больше нет, и без сброса раздел молча оставался бы пустым.
  if (!categories.includes(activeFilter)) activeFilter = ALL_CATEGORY;
  const filtered = activeFilter === ALL_CATEGORY
    ? shown
    : shown.filter(p=>p.category===activeFilter);

  const cards = filtered.length
    ? filtered.map(p => productCardHtml(p, p.popular ? 'Популярное' : null)).join('')
    : `<div class="stock-note mono">Здесь пока пусто — скоро вернёмся с новым дропом.</div>`;

  return `
  <section style="border-top:none;">
    <div class="wrap">
      <div class="section-head">
        <h2>Мерч</h2>
      </div>
      ${categories.length > 2 ? `
      <div class="filters">
        ${categories.map(c=>`<button data-filter="${escapeHtml(c)}" class="${c===activeFilter?'active':''}">${escapeHtml(c)}</button>`).join('')}
      </div>` : ''}
      <div class="merch-grid">${cards}</div>
    </div>
  </section>
  `;
}

/* =====================================================================
   MAIN RENDER
   ===================================================================== */
function render(){
  const app = document.getElementById('app');
  if (currentTab === 'home') app.innerHTML = renderHome();
  else if (currentTab === 'episodes') app.innerHTML = renderEpisodes();
  else if (currentTab === 'merch') app.innerHTML = renderMerch();
  else if (currentTab === 'artist') app.innerHTML = renderArtist(route.artist);
  bindDynamicHandlers();
  fitHeroLayout();
}

// Раскладка hero: фото должно быть ровно по высоте текстового блока
// (заголовок + описание + кнопка). Растянуть фото по высоте нельзя — при 16:9
// это даёт либо обрезку кадра, либо чёрные поля, поэтому вместо высоты
// подбираем ШИРИНУ колонки с фото: при 16:9 нужная ширина = высота текста × 16/9.
// Ширина колонки влияет на высоту текста (переносы), поэтому считаем итеративно.
const HERO_PHOTO_MIN_SHARE = 0.5, HERO_PHOTO_MAX_SHARE = 0.66;
function fitHeroLayout(){
  const grid = document.querySelector('.hero-grid');
  const text = document.querySelector('.hero-text');
  const photo = document.querySelector('.hero-photo');
  if (!grid || !text || !photo) return;
  // сбрасываем и колонки, и отступ: иначе посчитанные ранее значения залипнут
  // на мобильной раскладке и при следующем пересчёте
  grid.style.gridTemplateColumns = '';
  grid.style.columnGap = '';
  // на мобильной раскладке колонок нет — там всё в одну ленту
  if (window.matchMedia('(max-width:860px)').matches){ fitHeroTitle(); return; }
  const cs = getComputedStyle(grid);
  const gap = Math.round(parseFloat(cs.columnGap) || 0);
  // clientWidth включает паддинги .wrap — вычитаем их, иначе колонки вылезут за сетку
  const track = Math.floor(
    grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap
  );
  if (track <= 0) return;
  let maxPhoto = track * HERO_PHOTO_MAX_SHARE;
  for (let pass = 0; pass < 3; pass++){
    const perPx = fitHeroTitle(); // кегль зависит от текущей ширины колонки
    // колонке текста нельзя быть уже, чем нужно самому длинному слову заголовка
    // на минимальном кегле — иначе браузер порвёт слово посередине
    if (perPx){
      maxPhoto = Math.max(
        track * HERO_PHOTO_MIN_SHARE,
        Math.min(track * HERO_PHOTO_MAX_SHARE, track - perPx * HERO_TITLE_MIN * 1.02)
      );
    }
    // Округляем до целых пикселей: на дробной ширине правый край кадра попадает
    // на половину пикселя, браузер его сглаживает, и тонкая рамка видоискателя
    // в углу размывается или пропадает.
    const photoWidth = Math.round(Math.min(
      maxPhoto,
      Math.max(track * HERO_PHOTO_MIN_SHARE, text.getBoundingClientRect().height * 16 / 9)
    ));
    grid.style.columnGap = gap + 'px';
    grid.style.gridTemplateColumns = `${track - photoWidth}px ${photoWidth}px`;
  }
  fitHeroTitle();
}

// Заголовок на главной: названия выпусков содержат неразрывные токены вроде
// PRA(KILLA'GRAMM) — на крупном кегле такое слово не влезает в колонку, и браузер
// рвёт его посередине. Меряем самое длинное слово и подбираем кегль так, чтобы
// переносы шли только по пробелам.
// Возвращает «цену» самого длинного слова: его ширину в px на 1px кегля —
// fitHeroLayout по ней считает, сколько места колонке текста нужно минимум.
const HERO_TITLE_MAX = 48, HERO_TITLE_MIN = 26;
function fitHeroTitle(){
  const h1 = document.querySelector('.hero h1');
  if (!h1) return 0;
  h1.style.fontSize = '';
  const colWidth = h1.clientWidth;
  if (!colWidth) return 0;
  const cs = getComputedStyle(h1);
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden;
    font-family:${cs.fontFamily};font-weight:${cs.fontWeight};font-style:${cs.fontStyle};
    text-transform:${cs.textTransform};font-size:100px;`;
  document.body.appendChild(probe);
  let widest = 0;
  h1.textContent.trim().split(/\s+/).forEach(word => {
    probe.textContent = word;
    widest = Math.max(widest, probe.getBoundingClientRect().width);
  });
  probe.remove();
  if (!widest) return 0;
  const perPx = widest / 100; // ширина самого длинного слова на 1px кегля
  // 0.98 — запас: замер линейный, а реальный рендер округляет ширины,
  // и на «впритык» подобранном кегле от слова отрывалась запятая
  const fitted = Math.floor(colWidth / perPx * 0.98);
  h1.style.fontSize = Math.max(HERO_TITLE_MIN, Math.min(HERO_TITLE_MAX, fitted)) + 'px';
  return perPx;
}
function bindDynamicHandlers(){
  document.querySelectorAll('[data-open-product]').forEach(el=>{
    el.addEventListener('click', ()=> openProduct(el.dataset.openProduct));
  });
  document.querySelectorAll('.filters [data-filter]').forEach(el=>{
    el.addEventListener('click', ()=>{ activeFilter = el.dataset.filter; render(); });
  });
  document.querySelectorAll('.sorts [data-sort]').forEach(el=>{
    el.addEventListener('click', ()=>{ episodeSort = el.dataset.sort; render(); });
  });
  document.querySelectorAll('[data-choose-size]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation(); // карточка сама тоже открывает товар — не открывать дважды
      openProduct(el.dataset.chooseSize);
    });
  });
  document.querySelectorAll('[data-open-cart]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation(); // не открывать модалку карточки
      openDrawer();
    });
  });
  // Кнопку внутри карточки товара пропускаем: её навешивает renderModal,
  // передавая туда уже выбранный размер. Иначе на ней повисли бы два
  // обработчика, и второй сбрасывал бы размер, выбранный первым.
  document.querySelectorAll('[data-open-survey]').forEach(el=>{
    if (el.closest('#modalContent')) return;
    el.addEventListener('click', (e)=>{
      e.stopPropagation(); // не открывать модалку карточки
      openSurvey(el.dataset.openSurvey);
    });
  });
  document.querySelectorAll('[data-random-episode]').forEach(el=>{
    el.addEventListener('click', openRandomEpisode);
  });
  document.querySelectorAll('[data-share]').forEach(el=>{
    el.addEventListener('click', ()=>shareEpisode(el.dataset.share, el));
  });
}

// «Случайный выпуск» — для тех, кто зашёл впервые и не знает, с чего начать.
// Не уводит на YouTube: подсвечивает карточку в архиве, рядом остальные.
function openRandomEpisode(){
  const eps = CONFIG.episodes;
  if (!eps.length) return;
  const current = route.episode;
  const pool = eps.filter(e => episodeSlug(e) !== current);
  const pick = pool[Math.floor(Math.random() * pool.length)] || eps[0];
  navigate('#/episode/' + episodeSlug(pick));
}

// Поделиться выпуском. На телефоне — системное меню «Поделиться»,
// на десктопе копируем ссылку: она ведёт прямо на этот выпуск.
async function shareEpisode(slug, btn){
  const ep = findEpisodeBySlug(slug);
  if (!ep) return;
  // Делимся сразу ссылкой на YouTube, а не на страницу сайта — так человек,
  // получивший ссылку, попадает прямо на видео, а не на промежуточный экран.
  // Если ссылки на ролик ещё нет (youtubeUrl не заполнен), делимся адресом
  // на сайте — там же есть подпись «ссылка появится позже».
  const url = ep.youtubeUrl || absoluteUrl('#/episode/' + slug);
  const title = `SPOTTER LIVE — ${ep.title}`;
  if (navigator.share){
    try{ await navigator.share({ title, text: title, url }); return; }
    catch(e){ if (e && e.name === 'AbortError') return; } // человек закрыл меню — не подменяем на копирование
  }
  try{
    await navigator.clipboard.writeText(url);
    flashButton(btn, 'Ссылка скопирована');
  }catch(e){
    // адресную строку сайта тут не подменить внешней ссылкой на YouTube —
    // остаётся просто открыть ролик, раз скопировать не вышло
    flashButton(btn, 'Открываем YouTube');
    window.open(url, '_blank', 'noopener');
  }
}
function flashButton(btn, text){
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = text;
  btn.classList.add('flash');
  setTimeout(()=>{ btn.textContent = original; btn.classList.remove('flash'); }, 2000);
}

/* =====================================================================
   PRODUCT MODAL
   ===================================================================== */
function openProduct(id, fromRoute){
  modalProduct = findProduct(id);
  if (!modalProduct) return;
  // Размер намеренно не выбран заранее: с предвыбранным размером легко купить
  // не тот, просто не заметив поле. Кнопка добавления будет заблокирована,
  // пока покупатель не выберет размер сам.
  modalSize = null;
  modalQty = 1;
  modalPhoto = 0;
  modalMsg = '';
  renderModal();
  document.getElementById('productOverlay').classList.add('open');
  lockScroll(true);
  trapFocus(document.getElementById('productOverlay'));
  // адрес товара — часть истории браузера, «назад» закрывает карточку
  if (!fromRoute) navigate('#/product/' + id);
}
function closeProduct(fromRoute){
  document.getElementById('productOverlay').classList.remove('open');
  modalProduct = null;
  releaseFocus();
  // корзина может быть открыта поверх карточки — тогда прокрутку не возвращаем
  if (!isOpen('cartDrawer')) lockScroll(false);
  // Сверяемся с адресом, а не с разобранным route: hashchange приходит
  // следующей задачей, и сразу после открытия карточки route ещё старый —
  // тогда закрытие не возвращало адрес назад, и карточка открывалась снова.
  if (!fromRoute && location.hash.indexOf('#/product/') === 0) navigate('#/merch');
}

/* =====================================================================
   ОПРОС ПРО МЕРЧ. Ответы уходят тем же способом, что и заказ без оплаты
   на сайте: черновик открывается в Telegram, отправляет его сам человек.
   Скидку по итогам присылают вручную в переписке — на сайте нет ни
   промокодов, ни их учёта.

   Вопрос без options — открытый, с полем для текста. С options — выбор
   вариантов, всегда множественный. other:true добавляет вариант «Другое»,
   который открывает строку для своего ответа.
   ===================================================================== */
const SURVEY_OTHER = 'Другое';
const SURVEY_QUESTIONS = [
  { q: 'Как вы узнали о проекте SPOTTER?' },
  {
    q: 'Что для вас важно при покупке мерча?',
    options: ['Цена', 'Качество', 'Причастность к проекту', 'Способ поддержать проект'],
    other: true
  },
  {
    q: 'Какие страхи и переживания вы испытываете при покупке мерча?',
    options: ['Долгая доставка', 'Качество', 'Отсутствие возврата'],
    other: true
  },
  { q: 'Для чего вы покупаете мерч?' },
  { q: 'Что для вас SPOTTER?' },
  {
    q: 'Что вы бы хотели видеть из одежды и аксессуаров от SPOTTER в дальнейшем?',
    options: ['Футболки', 'Худи, зип-худи', 'Верхняя одежда', 'Аксессуары (сумки, шапки, кепки, картхолдеры)'],
    other: true
  },
  { q: 'Чей мерч вы бы никогда не купили и почему?' },
  { q: 'Был ли у вас неудачный опыт покупки мерча? Если да, опишите какой и почему.' }
];
let surveyProduct = null;
let surveyStep = 0;
let surveyAnswers = [];
let surveySize = null;       // размер, выбранный на последнем шаге опроса
let surveyQty = 1;
let surveyMsg = '';          // подтверждение добавления на последнем шаге
let surveyError = '';        // «ответьте на вопрос» под текущим шагом
// Идентификатор прохождения: по нему ответы и оформленный заказ сходятся
// в одну строку таблицы. Живёт вместе с ответами в localStorage.
let surveyId = '';
// Пройденный опрос, который ждёт отправки вместе с заказом. Лежит в
// localStorage рядом с корзиной: ответы на восемь вопросов жалко терять
// из-за случайного обновления страницы между опросом и оформлением.
let surveyResult = null;
const SURVEY_KEY = 'spotter-survey-v1';

function saveSurveyResult(){
  // Вопрос сохраняем вместе с ответом: если формулировки потом поменяются,
  // уже отправленные ответы не должны разъехаться с новыми вопросами.
  surveyResult = {
    id: surveyId,
    product: surveyProduct ? surveyProduct.name : '',
    discount: surveyDiscount(),
    lines: SURVEY_QUESTIONS.map((def,i)=>({ q: def.q, a: surveyAnswerText(i) }))
  };
  try{ localStorage.setItem(SURVEY_KEY, JSON.stringify(surveyResult)); }catch(e){}
}
function loadSurveyResult(){
  try{
    const raw = localStorage.getItem(SURVEY_KEY);
    const data = raw ? JSON.parse(raw) : null;
    surveyResult = (data && Array.isArray(data.lines)) ? data : null;
    if (surveyResult && surveyResult.id) surveyId = surveyResult.id;
  }catch(e){ surveyResult = null; }
}
function clearSurveyResult(){
  surveyResult = null;
  try{ localStorage.removeItem(SURVEY_KEY); }catch(e){}
}
function surveyResultText(){
  if (!surveyResult) return '';
  return 'Ответы на опрос:\n\n' + surveyResult.lines
    .map((l,i)=>`${i+1}. ${l.q}\n${l.a || '— пропущено'}`)
    .join('\n\n');
}

// Варианты вопроса вместе с «Другое» — в одном списке, чтобы «Другое»
// вело себя как обычный переключатель и просто открывало строку ввода.
function surveyOptions(def){
  return def.other ? [...def.options, SURVEY_OTHER] : def.options;
}
function blankSurveyAnswers(){
  return SURVEY_QUESTIONS.map(()=>({ text:'', picked:[], other:'' }));
}

// Пустой ответ дальше не пускает: опрос ради скидки легко «протыкать»
// насквозь, и тогда в таблице лежат восемь пустых строк вместо мнений.
// Просим минимум: одну непробельную букву в открытом вопросе, один
// выбранный вариант — в вопросе с вариантами.
function surveyStepError(i){
  const def = SURVEY_QUESTIONS[i];
  const a = surveyAnswers[i] || { text:'', picked:[], other:'' };
  if (!def.options){
    return (a.text || '').trim() ? '' : 'Ответьте на вопрос — хотя бы парой слов.';
  }
  if (!a.picked.length) return 'Выберите хотя бы один вариант.';
  // «Другое» без расшифровки — тот же пустой ответ, только окольным путём
  if (a.picked.includes(SURVEY_OTHER) && !(a.other || '').trim()){
    return 'Допишите свой вариант в поле под списком.';
  }
  return '';
}

/* ---------------------------------------------------------------------
   ОТПРАВКА ОТВЕТОВ В GOOGLE-ТАБЛИЦУ.

   Идёт параллельно телеграму и ничего не блокирует: таблица нужна, чтобы
   читать ответы структурно, а не выуживать их из переписки. Приёмник —
   Google Apps Script (see serverless/google-sheets), он принимает POST и
   дописывает строку.

   Content-Type: text/plain — не каприз. С ним браузер шлёт запрос
   напрямую, без предварительного OPTIONS, который Apps Script
   не обрабатывает. А вот ответ читается нормально: Google отдаёт
   Access-Control-Allow-Origin на обоих шагах, и на редиректе тоже, —
   проверено. Поэтому таблица может не только принимать, но и отвечать,
   на чём и держится выдача номера заказа.
   --------------------------------------------------------------------- */
function sendToSheet(payload){
  const url = CONFIG.surveySheetUrl;
  if (!url) return Promise.resolve(null); // приёмник не настроен
  return fetch(url, {
    method: 'POST',
    keepalive: true, // запрос доживёт, даже если страница уже уходит в телеграм
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(r => r.ok ? r.json() : null)
  .catch(()=> null); // таблица не должна мешать заказу
}
// Ответы уезжают один раз — в момент, когда человек дошёл до конца опроса.
// Дальше он может добавлять размеры и передумывать, ответы от этого
// не меняются, а дубли строк в таблице нам не нужны.
let surveySheetSent = false;
function sendSurveyToSheet(){
  if (surveySheetSent || !surveyId) return;
  surveySheetSent = true;
  sendToSheet({
    type: 'survey',
    id: surveyId,
    ts: new Date().toISOString(),
    product: surveyProduct ? surveyProduct.name : '',
    discount: surveyDiscount(),
    answers: SURVEY_QUESTIONS.map((def,i)=>({ q: def.q, a: surveyAnswerText(i) }))
  });
}

// Оверлей опроса берём из разметки, а если его там нет — создаём сами.
// index.html живёт в кэше у посетителя и на CDN своей жизнью и обновляется
// не одновременно с js: у части людей свежий app.js встречается со старым
// html, где этого блока ещё нет, и кнопка опроса просто молчала. Так фича
// не зависит от того, какая версия разметки досталась посетителю.
function surveyOverlayEl(){
  let el = document.getElementById('surveyOverlay');
  if (!el){
    el = document.createElement('div');
    el.className = 'overlay';
    el.id = 'surveyOverlay';
    el.innerHTML = '<div class="survey-card" id="surveyModalContent"></div>';
    document.body.appendChild(el);
  }
  if (!el.dataset.backdropBound){
    el.addEventListener('click', (e)=>{ if (e.target.id === 'surveyOverlay') closeSurvey(); });
    el.dataset.backdropBound = '1';
  }
  return el;
}
function openSurvey(productId, presetSize){
  surveyProduct = findProduct(productId);
  surveyStep = 0;
  surveyAnswers = blankSurveyAnswers();
  // Размер, уже выбранный в карточке товара, доезжает до последнего шага —
  // человек не выбирает его дважды.
  surveySize = presetSize || null;
  surveyQty = 1;
  surveyMsg = '';
  surveyError = '';
  surveyId = 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // Новое прохождение — новый id и новая строка в таблице. Без сброса
  // второй опрос за сессию (закрыл, передумал, прошёл заново) молча
  // никуда не уезжал.
  surveySheetSent = false;
  const overlay = surveyOverlayEl();
  renderSurvey();
  overlay.classList.add('open');
  lockScroll(true);
  trapFocus(overlay);
}
function closeSurvey(){
  const el = document.getElementById('surveyOverlay');
  if (el) el.classList.remove('open');
  releaseFocus('surveyOverlay');
  if (!isOpen('productOverlay') && !isOpen('cartDrawer')) lockScroll(false);
}
// Ответ одной строкой: у открытого вопроса это сам текст, у вопроса с
// вариантами — выбранное через запятую, причём «Другое» разворачивается
// в то, что человек вписал руками.
function surveyAnswerText(i){
  const def = SURVEY_QUESTIONS[i];
  const a = surveyAnswers[i] || { text:'', picked:[], other:'' };
  if (!def.options) return (a.text || '').trim();
  const other = (a.other || '').trim();
  return a.picked
    .map(opt => (opt === SURVEY_OTHER && other) ? `другое: ${other}` : opt)
    .join(', ');
}
// Добавление из опроса работает как в обычной карточке товара: окно
// остаётся открытым, счётчик сбрасывается, и можно тут же добавить другой
// размер. Иначе заказать S, M и L по одному было невозможно — окно
// закрывалось после первого же добавления.
function addSurveyItem(){
  if (!surveyProduct || !surveySize) return;
  // Ответы сохраняем при первом же добавлении: скидка должна быть засчитана,
  // даже если человек потом просто закроет окно и вернётся к корзине позже.
  saveSurveyResult();
  const asked = surveyQty;
  const ok = addToCart(surveyProduct.id, surveySize, asked);
  surveyMsg = ok
    ? `Добавлено: размер ${surveySize}, ${asked} шт.`
    : `Добавлено меньше — не хватило остатка размера ${surveySize}.`;
  surveyQty = 1;
  renderSurvey();
  render(); // карточка в сетке переключается на «Посмотреть корзину»
}
// Заказ собран — отдаём человека в обычное оформление, там уже есть поля
// контакта и доставки, дублировать их внутри опроса незачем. В Telegram
// потом уйдёт одно сообщение: заказ, скидка и ответы вместе.
function goToCartFromSurvey(){
  closeSurvey();
  if (modalProduct) closeProduct();
  openDrawer();
}
function renderSurvey(){
  const el = document.getElementById('surveyModalContent');
  const total = SURVEY_QUESTIONS.length;

  // Последний шаг — что именно заказываем. Опрос заканчивается не «спасибо,
  // отправьте ответы», а готовым заказом: иначе человеку пришлось бы отдельно
  // идти оформлять предзаказ, а нам — сводить два сообщения в одно.
  if (surveyStep >= total){
    const p = surveyProduct;
    const d = surveyDiscount();
    // Тираж общий, поэтому недоступных размеров по отдельности не бывает:
    // либо в партии ещё есть место, либо её разобрали целиком.
    const freeLeft = p ? availableFor(p.id) : 0;
    const sizesHtml = p ? p.sizes.map(s => {
      return `<button class="size-btn ${s===surveySize?'active':''} ${freeLeft<=0?'sold-out':''}" ${freeLeft<=0?'disabled':''} data-survey-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`;
    }).join('') : '';
    const leftForSize = freeLeft;
    const surveyQtyCap = Math.max(leftForSize, 1);
    const canAdd = !!(p && surveySize && leftForSize > 0);
    const inCartTotal = cartTotalQty();

    el.innerHTML = `
      <button class="modal-close" id="surveyCloseBtn" aria-label="Закрыть">×</button>
      <div class="survey-body">
        <div class="survey-progress mono">готово</div>
        <div class="survey-bar"><div class="survey-bar-fill" style="width:100%"></div></div>
        <h2 class="survey-q">Спасибо. Что заказываем?</h2>
        ${p ? `
        <p class="order-hint">${escapeHtml(p.name)} — ${formatPrice(p.price)}${d ? `, со скидкой за опрос ${formatPrice(priceAfterSurvey(p))}` : ''}.</p>
        <div>
          <span class="field-label">Размер</span>
          <div class="size-row">${sizesHtml}</div>
        </div>
        <div>
          <span class="field-label">Количество</span>
          <div class="qty-row">
            <button class="qty-btn" id="surveyQtyMinus" ${surveyQty<=1?'disabled':''}>−</button>
            <span class="qty-val">${surveyQty}</span>
            <button class="qty-btn" id="surveyQtyPlus" ${surveyQty < surveyQtyCap ? '' : 'disabled'}>+</button>
            <span class="stock-note">${surveySize ? `осталось: ${Math.max(leftForSize,0)}` : 'выберите размер'}</span>
          </div>
        </div>` : ''}
      </div>
      <div class="survey-nav survey-nav-final">
        ${p ? `<button class="btn btn-full" id="surveyAddBtn" ${canAdd ? '' : 'disabled style="opacity:.4;cursor:not-allowed;"'}>${!surveySize ? 'Выберите размер' : (leftForSize > 0 ? 'Добавить в корзину' : 'Этого размера нет')}</button>` : ''}
        ${surveyMsg ? `<div class="add-msg">${escapeHtml(surveyMsg)}</div>` : ''}
        ${inCartTotal > 0 ? `<button class="btn-outline btn-full" id="surveyCartBtn">Перейти в корзину · ${inCartTotal} шт.</button>` : ''}
        <div class="survey-nav-row">
          <button class="link-btn" id="surveyBackBtn">Назад к вопросам</button>
          <button class="link-btn" id="surveyDoneBtn">Ответы отправлены, закрыть</button>
        </div>
      </div>
    `;
    document.getElementById('surveyCloseBtn').addEventListener('click', closeSurvey);
    document.getElementById('surveyBackBtn').addEventListener('click', ()=>{ surveyStep = total-1; renderSurvey(); });
    el.querySelectorAll('[data-survey-size]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        surveySize = btn.dataset.surveySize;
        surveyQty = 1;
        surveyMsg = ''; // подтверждение относилось к прошлому размеру
        renderSurvey();
      });
    });
    const minus = document.getElementById('surveyQtyMinus');
    if (minus) minus.addEventListener('click', ()=>{ surveyQty = Math.max(1, surveyQty-1); renderSurvey(); });
    const plus = document.getElementById('surveyQtyPlus');
    if (plus) plus.addEventListener('click', ()=>{ surveyQty = Math.min(surveyQtyCap, surveyQty+1); renderSurvey(); });
    const addBtn = document.getElementById('surveyAddBtn');
    if (addBtn) addBtn.addEventListener('click', ()=>{ if (canAdd) addSurveyItem(); });
    const cartBtn = document.getElementById('surveyCartBtn');
    if (cartBtn) cartBtn.addEventListener('click', goToCartFromSurvey);
    // Раньше тут была ссылка «просто отправить ответы» в телеграм. Теперь
    // ответы уезжают сами, как только человек дошёл до конца, — ссылка
    // ничего не добавляла и только подсовывала t.me, который без VPN
    // у части людей отвечает ошибкой.
    bindEl('surveyDoneBtn', 'click', closeSurvey);
    return;
  }

  const def = SURVEY_QUESTIONS[surveyStep];
  const answer = surveyAnswers[surveyStep];
  const fieldHtml = def.options ? `
      <div class="survey-hint mono">можно выбрать несколько</div>
      <div class="survey-opts">
        ${surveyOptions(def).map(opt => `
          <button class="survey-opt ${answer.picked.includes(opt)?'active':''}" data-opt="${escapeHtml(opt)}">
            <span class="survey-box"></span>${escapeHtml(opt)}
          </button>`).join('')}
      </div>
      ${answer.picked.includes(SURVEY_OTHER)
        ? `<input class="survey-other" id="surveyOther" placeholder="Что именно?" value="${escapeHtml(answer.other)}">`
        : ''}
    ` : `
      <textarea class="survey-input" id="surveyInput" rows="5" placeholder="Пишите как есть — можно коротко, можно развёрнуто">${escapeHtml(answer.text)}</textarea>
    `;

  el.innerHTML = `
    <button class="modal-close" id="surveyCloseBtn" aria-label="Закрыть">×</button>
    <div class="survey-body">
      <div class="survey-progress mono">${surveyStep+1} / ${total}</div>
      <div class="survey-bar"><div class="survey-bar-fill" style="width:${Math.round((surveyStep/total)*100)}%"></div></div>
      <h2 class="survey-q">${escapeHtml(def.q)}</h2>
      ${fieldHtml}
      <div class="checkout-error mono${surveyError ? ' show' : ''}" id="surveyErr">${escapeHtml(surveyError)}</div>
    </div>
    <div class="survey-nav">
      ${surveyStep > 0 ? `<button class="btn-outline" id="surveyBackBtn">Назад</button>` : `<span></span>`}
      <button class="btn" id="surveyNextBtn">${surveyStep === total-1 ? 'Завершить' : 'Далее'}</button>
    </div>
  `;
  document.getElementById('surveyCloseBtn').addEventListener('click', closeSurvey);
  // Ошибку гасим прямо на вводе, не перерисовывая шаг: перерисовка сбросила бы
  // каретку в начало поля посреди набора текста.
  const dropError = ()=>{
    if (!surveyError) return;
    surveyError = '';
    const errEl = document.getElementById('surveyErr');
    if (errEl) errEl.classList.remove('show');
  };
  const input = document.getElementById('surveyInput');
  if (input){
    input.addEventListener('input', ()=>{ answer.text = input.value; dropError(); });
    input.focus();
  }
  el.querySelectorAll('[data-opt]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const opt = btn.dataset.opt;
      const at = answer.picked.indexOf(opt);
      if (at === -1) answer.picked.push(opt);
      else answer.picked.splice(at, 1);
      surveyError = '';
      renderSurvey(); // перерисовка нужна: «Другое» открывает и прячет поле ввода
    });
  });
  const other = document.getElementById('surveyOther');
  if (other){
    other.addEventListener('input', ()=>{ answer.other = other.value; dropError(); });
    if (!answer.other) other.focus();
  }
  const backBtn = document.getElementById('surveyBackBtn');
  if (backBtn) backBtn.addEventListener('click', ()=>{ surveyError = ''; surveyStep--; renderSurvey(); });
  document.getElementById('surveyNextBtn').addEventListener('click', ()=>{
    const err = surveyStepError(surveyStep);
    if (err){ surveyError = err; renderSurvey(); return; }
    surveyError = '';
    surveyStep++;
    // Дошли до конца — ответы уезжают в таблицу сразу, не дожидаясь заказа:
    // человек может закрыть окно и не купить ничего, ответы всё равно ценны.
    if (surveyStep >= total) sendSurveyToSheet();
    renderSurvey();
  });
}

function renderModal(){
  const p = modalProduct;
  // Место в тираже общее на все размеры, поэтому и остаток один на всех
  const freeLeft = availableFor(p.id);
  const availableForSize = modalSize ? freeLeft : 0;
  const inCart = qtyInCartForProduct(p.id);
  // Размеры гасятся только когда разобрали всю партию: отдельного остатка
  // по размеру больше нет.
  const sizesHtml = p.sizes.map(s=>{
    return `<button class="size-btn ${s===modalSize?'active':''} ${freeLeft<=0?'sold-out':''}" data-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`;
  }).join('');

  const images = productImages(p);
  const galleryHtml = images.length > 1 ? `
    <div class="thumb-row">
      ${images.map((src,i)=>`
        <button class="thumb ${i===modalPhoto?'active':''}" data-photo="${i}" aria-label="Фото ${i+1}">
          <img src="${src}" alt="" loading="lazy" decoding="async">
        </button>`).join('')}
    </div>` : '';

  // Состояния основной кнопки: размер не выбран → готово к добавлению.
  // Отдельного «нет в наличии» нет намеренно: любой размер кликабелен и
  // ведёт к предзаказу, поэтому кнопка зовёт выбрать размер, а не сообщает
  // тупик. Выбранный распроданный размер сюда не доходит — там свой блок.
  let addLabel = 'Добавить в корзину', addDisabled = false;
  if (!modalSize){ addLabel = 'Выберите размер'; addDisabled = true; }
  else if (availableForSize <= 0){ addLabel = 'Этого размера нет'; addDisabled = true; }

  const qtyCap = availableForSize;

  document.getElementById('modalContent').innerHTML = `
    <button class="modal-close" id="modalCloseBtn" aria-label="Закрыть">×</button>
    <div class="modal-media">
      <button class="zoom-open" id="zoomOpenBtn" aria-label="Открыть фото на весь экран">
        ${productPhoto(p, modalPhoto)}
        <span class="zoom-hint mono">увеличить</span>
      </button>
      ${galleryHtml}
    </div>
    <div class="modal-info">
      <h2 id="modalTitle">${escapeHtml(p.name)}</h2>
      ${priceBlockHtml(p)}
      <p class="desc">${escapeHtml(p.description)}</p>
      <div>
        <span class="field-label">Размер</span>
        <div class="size-row">${sizesHtml}</div>
      </div>
      <div>
        <span class="field-label">Количество</span>
        <div class="qty-row">
          <button class="qty-btn" id="qtyMinus" ${modalQty<=1?'disabled':''}>−</button>
          <span class="qty-val" id="qtyVal">${modalQty}</span>
          <button class="qty-btn" id="qtyPlus" ${modalSize && modalQty < qtyCap ? '' : 'disabled'}>+</button>
          <span class="stock-note">${modalSize ? `осталось: ${Math.max(availableForSize,0)}` : 'выберите размер'}</span>
        </div>
      </div>
      <button class="btn" id="addToCartBtn" ${addDisabled?'disabled style="opacity:.4;cursor:not-allowed;"':''}>${addLabel}</button>
      ${modalMsg ? `<div class="add-msg">${escapeHtml(modalMsg)}</div>` : ''}
      ${inCart > 0 ? `<button class="btn-outline" id="modalCartBtn">Посмотреть корзину</button>` : ''}
      ${surveyDiscount() ? `
      <div class="survey-offer">
        <div class="survey-offer-title mono">Скидка ${formatPrice(surveyDiscount())}</div>
        <p class="survey-offer-note">Ответьте на несколько вопросов о мерче — пришлём скидку в Telegram, и ${escapeHtml(p.name)} выйдет в ${formatPrice(priceAfterSurvey(p))}.</p>
        ${surveyButtonHtml(p, 'btn-full')}
      </div>` : ''}
    </div>
  `;
  document.getElementById('modalCloseBtn').addEventListener('click', ()=>closeProduct());
  const zoomBtn = document.getElementById('zoomOpenBtn');
  if (zoomBtn){
    zoomBtn.addEventListener('click', ()=>openLightbox(images, modalPhoto, p.name));
    // Каждое переключение фото — новая картинка со своими пропорциями,
    // поэтому решение принимается заново, а не один раз при открытии.
    autoFitPhoto(zoomBtn);
  }
  document.querySelectorAll('.size-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      modalSize = btn.dataset.size;
      modalQty = 1;
      modalMsg = '';
      renderModal();
    });
  });
  document.querySelectorAll('.thumb').forEach(btn=>{
    btn.addEventListener('click', ()=>{ modalPhoto = Number(btn.dataset.photo) || 0; renderModal(); });
  });
  document.getElementById('qtyMinus').addEventListener('click', ()=>{
    modalQty = Math.max(1, modalQty-1); renderModal();
  });
  document.getElementById('qtyPlus').addEventListener('click', ()=>{
    modalQty = Math.min(Math.max(qtyCap,1), modalQty+1); renderModal();
  });
  const addBtn = document.getElementById('addToCartBtn');
  if (addBtn) addBtn.addEventListener('click', ()=>{
    if (addDisabled) return;
    const asked = modalQty;
    const ok = addToCart(p.id, modalSize, asked);
    // modalMsg — состояние, а не запись в DOM: раньше текст писали в элемент,
    // который тут же затирался перерисовкой, и подтверждение не было видно.
    modalMsg = ok
      ? `Добавлено: размер ${modalSize}, ${asked} шт.`
      : `Добавлено меньше — не хватило остатка размера ${modalSize}.`;
    modalQty = 1;
    renderModal();
    render(); // кнопка на карточке в списке переключается на «Посмотреть корзину»
  });
  bindModalCartBtn();
}
function bindModalCartBtn(){
  const cartBtn = document.getElementById('modalCartBtn');
  if (cartBtn) cartBtn.addEventListener('click', ()=>{ closeProduct(); openDrawer(); });
  // Кнопки внутри модалки навешиваются здесь: bindDynamicHandlers() проходит
  // по странице после render(), а модалку рисует renderModal() отдельно.
  //
  // Товар берём из modalProduct, а не из локальной p: p живёт внутри
  // renderModal, здесь её нет, и обработчик падал с ReferenceError —
  // кнопка опроса в карточке не работала совсем. На витрине та же кнопка
  // работала от bindDynamicHandlers, поэтому со стороны выглядело так,
  // будто её ломает выбор размера.
  const modalSurveyBtn = document.querySelector('#modalContent [data-open-survey]');
  if (modalSurveyBtn && modalProduct){
    modalSurveyBtn.addEventListener('click', ()=>openSurvey(modalProduct.id, modalSize));
  }
}
bindEl('productOverlay', 'click', e=>{
  if (e.target.id === 'productOverlay') closeProduct();
});

/* =====================================================================
   ФОТО НА ВЕСЬ ЭКРАН.

   Фотографии мерча сняты крупно, но в карточке товара обрезаны под сетку
   (object-fit:cover), и деталей принта на них не разглядеть. Здесь фото
   показывается целиком (contain) и по клику приближается вдвое: точка
   увеличения следует за курсором/пальцем, так что можно «поводить» по
   принту, не таская картинку руками.

   Свой набор фокуса и Esc, а не общие trapFocus/releaseFocus: просмотрщик
   открывается ПОВЕРХ карточки товара, а releaseFocus снимает ловушки сразу
   со всех окон — закрыв фото, мы бы разломали карточку под ним.
   ===================================================================== */
const LIGHTBOX_ZOOM = 2;
let lbState = null; // { images, index, title, prevFocus }

function openLightbox(images, index, title){
  if (!images || !images.length) return;
  lbState = { images, index: index || 0, title: title || '', prevFocus: document.activeElement };
  document.getElementById('lightbox').classList.add('open');
  lockScroll(true);
  renderLightbox();
}
function closeLightbox(){
  const box = document.getElementById('lightbox');
  box.classList.remove('open');
  box.innerHTML = '';
  const prev = lbState && lbState.prevFocus;
  lbState = null;
  // под фото может остаться открытая карточка товара или корзина — тогда
  // прокрутку страницы отпускать рано
  const productOpen = isOpen('productOverlay');
  const drawerOpen = isOpen('cartDrawer');
  if (!productOpen && !drawerOpen) lockScroll(false);
  if (prev && document.contains(prev)) prev.focus();
}
function lightboxStep(delta){
  if (!lbState || lbState.images.length < 2) return;
  const n = lbState.images.length;
  lbState.index = (lbState.index + delta + n) % n;
  renderLightbox();
}
function renderLightbox(){
  if (!lbState) return;
  const { images, index, title } = lbState;
  const many = images.length > 1;
  const box = document.getElementById('lightbox');
  box.innerHTML = `
    <button class="lb-close" data-lb="close" aria-label="Закрыть">×</button>
    ${many ? `<button class="lb-nav lb-prev" data-lb="prev" aria-label="Предыдущее фото">‹</button>` : ''}
    <div class="lb-stage" id="lbStage">
      <img id="lbImg" src="${images[index]}" alt="${escapeHtml(title)}" draggable="false">
    </div>
    ${many ? `<button class="lb-nav lb-next" data-lb="next" aria-label="Следующее фото">›</button>` : ''}
    <div class="lb-bar mono">${many ? `${index+1} / ${images.length} · ` : ''}<span id="lbHint">нажмите на фото, чтобы приблизить</span></div>
  `;
  box.querySelectorAll('[data-lb]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const act = btn.dataset.lb;
      if (act === 'close') closeLightbox();
      else lightboxStep(act === 'next' ? 1 : -1);
    });
  });
  bindLightboxZoom();
  const close = box.querySelector('.lb-close');
  if (close) close.focus();
}
// Зум по тапу + перетаскивание пальцем/мышью, как в обычной галерее.
// Раньше вместо перетаскивания точка увеличения (transform-origin) сама
// прыгала туда, где сейчас палец — из-за этого сдвиг казался «наоборот»:
// origin двигается в направлении пальца, а видимая часть картинки от
// этого едет в противоположную сторону. Теперь origin всегда в центре,
// а перетаскивание — обычный translate на разницу координат: палец
// вправо — картинка ровно настолько же вправо.
function bindLightboxZoom(){
  const img = document.getElementById('lbImg');
  const stage = document.getElementById('lbStage');
  const hint = document.getElementById('lbHint');
  if (!img || !stage) return;
  let zoomed = false, dragging = false, moved = false;
  let panX = 0, panY = 0;      // сдвиг картинки в «родных» (до масштаба) px
  let lastX = 0, lastY = 0;

  const apply = () => {
    img.style.transform = zoomed ? `scale(${LIGHTBOX_ZOOM}) translate(${panX}px, ${panY}px)` : '';
  };
  // Не даём утащить увеличенное фото так, чтобы за краем потянулась пустота.
  const clamp = () => {
    const baseW = img.offsetWidth, baseH = img.offsetHeight; // не зависит от transform
    const overX = Math.max(0, (baseW * LIGHTBOX_ZOOM - stage.clientWidth) / 2 / LIGHTBOX_ZOOM);
    const overY = Math.max(0, (baseH * LIGHTBOX_ZOOM - stage.clientHeight) / 2 / LIGHTBOX_ZOOM);
    panX = Math.min(overX, Math.max(-overX, panX));
    panY = Math.min(overY, Math.max(-overY, panY));
  };

  stage.addEventListener('pointerdown', e=>{
    if (!zoomed) return;
    dragging = true; moved = false;
    lastX = e.clientX; lastY = e.clientY;
    img.style.transition = 'none'; // иначе перетаскивание тянется за пальцем с 180мс запозданием
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e=>{
    if (!zoomed || !dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    lastX = e.clientX; lastY = e.clientY;
    panX += dx / LIGHTBOX_ZOOM; panY += dy / LIGHTBOX_ZOOM;
    clamp();
    apply();
  });
  const endDrag = () => { dragging = false; img.style.transition = ''; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('click', e=>{
    e.stopPropagation(); // клик по фону закрывает — по самому фото не должен
    if (moved){ moved = false; return; } // это было перетаскивание, не тап
    zoomed = !zoomed;
    if (!zoomed){ panX = 0; panY = 0; }
    apply();
    stage.classList.toggle('zoomed', zoomed);
    if (hint) hint.textContent = zoomed ? 'ведите по фото · нажмите, чтобы отдалить' : 'нажмите на фото, чтобы приблизить';
  });
}
// Клик мимо фото закрывает просмотрщик
bindEl('lightbox', 'click', e=>{
  if (e.target.id === 'lightbox') closeLightbox();
});
// Стрелками листаем галерею
document.addEventListener('keydown', e=>{
  if (!lbState) return;
  if (e.key === 'ArrowRight') lightboxStep(1);
  else if (e.key === 'ArrowLeft') lightboxStep(-1);
});

/* =====================================================================
   ДОСТУПНОСТЬ ДИАЛОГОВ — карточка товара и корзина.

   Пока их не было: фон прокручивался под открытым окном, Esc не работал,
   Tab уводил фокус на ссылки за окном, а после закрытия фокус улетал
   в начало страницы вместо кнопки, которой окно открыли.
   ===================================================================== */
let lastFocused = null;
function lockScroll(on){
  document.body.style.overflow = on ? 'hidden' : '';
}
function trapFocus(container){
  lastFocused = document.activeElement;
  const focusables = container.querySelectorAll('a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])');
  if (focusables.length) focusables[0].focus();
  container._trap = (e)=>{
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll('a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length-1];
    if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', container._trap);
}
// only — снять ловушку только с этого оверлея. Нужно, когда опрос открыт
// поверх карточки товара: закрывая опрос, нельзя разряжать ловушку карточки,
// которая остаётся открытой под ним.
function releaseFocus(only){
  (only ? [only] : ['productOverlay','cartDrawer','surveyOverlay']).forEach(id=>{
    const el = document.getElementById(id);
    if (el && el._trap){ el.removeEventListener('keydown', el._trap); el._trap = null; }
  });
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}
// Esc закрывает то, что открыто сверху: сначала карточку товара, потом корзину
document.addEventListener('keydown', e=>{
  if (e.key !== 'Escape') return;
  if (lbState) closeLightbox();
  else if (isOpen('surveyOverlay')) closeSurvey();
  else if (isOpen('productOverlay')) closeProduct();
  else if (isOpen('cartDrawer')) closeDrawer();
});

/* =====================================================================
   CART DRAWER
   ===================================================================== */
function openDrawer(){
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('cartDrawer').classList.add('open');
  renderDrawer();
  lockScroll(true);
  trapFocus(document.getElementById('cartDrawer'));
}
function closeDrawer(){
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('cartDrawer').classList.remove('open');
  releaseFocus();
  // карточка товара может остаться открытой под корзиной — тогда замок не снимаем
  if (!isOpen('productOverlay')) lockScroll(false);
}
bindEl('cartOpenBtn', 'click', openDrawer);
bindEl('drawerCloseBtn', 'click', closeDrawer);
bindEl('drawerOverlay', 'click', closeDrawer);

function renderDrawer(){
  const body = document.getElementById('drawerBody');
  const foot = document.getElementById('drawerFoot');

  // Экран оформленного заказа. Показывается вместо корзины и переживает
  // перезагрузку: вернувшийся через час человек должен увидеть свой заказ,
  // а не пустую корзину, из которой непонятно, прошло что-то или нет.
  // Повторно оформить отсюда нельзя — только начать новый заказ осознанно.
  // Пока корзина пуста — показываем последний заказ. Как только человек
  // осознанно положил что-то ещё, уступаем место корзине: иначе он просто
  // не смог бы оформить второй заказ.
  if (placedOrder && cart.length === 0){
    const items = (placedOrder.lines || []).map(l=>`
      <div class="ordered-item">
        <span class="ordered-check">✓</span>
        <span>
          ${escapeHtml(l.name)} · ${escapeHtml(l.size)} · ${l.qty} шт.
          ${l.numbers && l.numbers.length ? `<span class="unit-no mono">${l.numbers.map(n=>'№'+n).join(' ')}</span>` : ''}
        </span>
      </div>`).join('');

    const shop = '@' + CONFIG.telegramUsername;
    // Заказ дошёл — человеку больше ничего делать не надо, и говорить ему
    // про Telegram-ссылки незачем: у части людей t.me без VPN отвечает
    // ошибкой, и именно это раньше ломало оформление.
    body.innerHTML = placedOrder.delivered ? `
      <div class="order-done">
        <div class="order-no mono">Заказ ${escapeHtml(placedOrder.number)}</div>
        <h3>Спасибо за заказ</h3>
        <div class="ordered-list">${items}</div>
        <p class="order-hint">Заказ у нас. <b>С вами свяжутся в Telegram</b> с аккаунта <b>${escapeHtml(shop)}</b> — там подтвердим наличие и расскажем про оплату.</p>
        <p class="order-hint">Запишите номер заказа: <b>${escapeHtml(placedOrder.number)}</b>.</p>
      </div>` : `
      <div class="order-done">
        <div class="order-no mono">Заказ ${escapeHtml(placedOrder.number)}</div>
        <h3>Заказ собран, но не отправлен</h3>
        <div class="ordered-list">${items}</div>
        <p class="order-hint"><b>Отправить его автоматически не получилось</b> — похоже, нет связи. Пришлите заказ нам сами: скопируйте текст ниже и отправьте в Telegram на ${escapeHtml(shop)}.</p>
        <pre class="order-text" id="orderText">${escapeHtml(placedOrder.text)}</pre>
      </div>`;
    foot.innerHTML = placedOrder.delivered ? `
      <a class="btn-outline btn-full" href="https://t.me/${escapeHtml(CONFIG.telegramUsername)}" target="_blank" rel="noopener">Написать нам в Telegram</a>
      <button class="link-btn" id="newOrderBtn">Оформить ещё один заказ</button>` : `
      <button class="btn btn-full" id="copyBtn">Скопировать заказ</button>
      <a class="btn-outline btn-full" href="${escapeHtml(placedOrder.url)}" target="_blank" rel="noopener">Открыть Telegram</a>
      <div class="add-msg" id="copyMsg"></div>
      <button class="link-btn" id="newOrderBtn">Оформить ещё один заказ</button>`;
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) copyBtn.addEventListener('click', ()=>copyOrder(placedOrder.text));
    // Единственный путь к новому заказу — осознанное нажатие. Именно это
    // и защищает от «кажется, не прошло, оформлю ещё разок».
    document.getElementById('newOrderBtn').addEventListener('click', ()=>{
      clearPlacedOrder();
      renderDrawer();
      render();
    });
    return;
  }

  const noticeHtml = cartNotice
    ? `<div class="dup-warn">${escapeHtml(cartNotice)}</div>` : '';

  if (cart.length === 0){
    body.innerHTML = noticeHtml + `<div class="empty-cart">Корзина пуста</div>`;
    foot.innerHTML = '';
    return;
  }

  body.innerHTML = noticeHtml + cart.map(item=>{
    const p = findProduct(item.productId);
    if (!p) return '';
    const max = capForSize(item.productId, item.size);
    return `
    <div class="cart-item">
      ${productPhoto(p)}
      <div class="ci-info">
        <h4>${escapeHtml(p.name)}</h4>
        <div class="ci-meta">размер: ${escapeHtml(item.size)}</div>
        <div class="ci-controls">
          <button class="qty-btn" data-dec="${p.id}|${item.size}">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" data-inc="${p.id}|${item.size}" ${item.qty>=max?'disabled':''}>+</button>
          <span class="ci-price mono">${formatPrice(p.price*item.qty)}</span>
          <button class="remove" data-remove="${p.id}|${item.size}">удалить</button>
        </div>
      </div>
    </div>`;
  }).join('');

  foot.innerHTML = `
    ${(()=>{ const d = duplicateInCart(); return d.length
      ? `<div class="dup-warn">В недавнем заказе <b>${escapeHtml(placedOrder.number)}</b> уже есть ${escapeHtml(d.join(', '))}. Убедитесь, что это не повтор.</div>`
      : ''; })()}
    <div class="total-row"><b>Итого</b><span class="mono">${formatPrice(cartTotalPrice())}</span></div>
    ${surveyResult && surveyResult.discount ? `
    <div class="total-row discount-row"><span>Скидка за опрос</span><span class="mono">−${formatPrice(surveyResult.discount)}</span></div>
    <div class="total-row"><b>С учётом скидки</b><span class="mono">${formatPrice(Math.max(cartTotalPrice() - surveyResult.discount, 0))}</span></div>` : ''}

    <div>
      <span class="field-label">Формат получения</span>
      <div class="radio-row">
        <label class="radio-opt"><input type="radio" name="delivery" value="Самовывоз" ${checkoutForm.delivery==='Самовывоз'?'checked':''}> Самовывоз <span class="opt-note">(только Москва)</span></label>
        <label class="radio-opt"><input type="radio" name="delivery" value="Доставка" ${checkoutForm.delivery==='Доставка'?'checked':''}> Доставка <span class="opt-note">(до ближайшего СДЭК)</span></label>
      </div>
    </div>
    <div class="field">
      <span class="field-label">Фамилия и имя</span>
      <input type="text" id="nameField" autocomplete="name" placeholder="Иванов Иван" value="${escapeHtml(checkoutForm.name)}"${badAttr('name')}>
      ${errHtml('name')}
    </div>
    <div class="field">
      <span class="field-label">Телефон</span>
      <input type="tel" id="phoneField" autocomplete="tel" inputmode="tel" placeholder="+7 900 000-00-00" value="${escapeHtml(checkoutForm.phone)}"${badAttr('phone')}>
      ${errHtml('phone')}
    </div>
    <div class="field">
      <span class="field-label">Ник в Telegram</span>
      <input type="text" id="telegramField" placeholder="@username" value="${escapeHtml(checkoutForm.telegram)}"${badAttr('telegram')}>
      ${errHtml('telegram')}
      <p class="field-note">По нему свяжемся по заказу. Нет ника — напишите номер телефона.</p>
    </div>
    <div class="field" id="deliveryBlock"></div>
    <div>
      <span class="field-label">Комментарий к заказу (необязательно)</span>
      <textarea id="commentField" rows="2" placeholder="Пожелания по размеру, удобное время связи и т.д.">${escapeHtml(checkoutForm.comment)}</textarea>
    </div>
    <div class="checkout-error mono" id="checkoutError"></div>
    <button class="btn btn-full" id="checkoutBtn">Оформить заказ</button>
  `;

  body.querySelectorAll('[data-inc]').forEach(b=>b.addEventListener('click', ()=>{
    const [id,size] = b.dataset.inc.split('|');
    setCartQty(id, size, qtyInCart(id,size)+1);
  }));
  body.querySelectorAll('[data-dec]').forEach(b=>b.addEventListener('click', ()=>{
    const [id,size] = b.dataset.dec.split('|');
    setCartQty(id, size, qtyInCart(id,size)-1);
  }));
  body.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click', ()=>{
    const [id,size] = b.dataset.remove.split('|');
    removeFromCart(id, size);
  }));
  // Поля пишут прямо в состояние: подвал корзины перерисовывается при любом
  // изменении количества, и без этого набранное имя пропадало бы.
  const bindField = (id, key)=>{
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', ()=>{
      checkoutForm[key] = el.value;
      // Претензию снимаем прямо в DOM, без перерисовки: перерисовка бросила бы
      // каретку в начало поля посреди набора.
      if (checkoutErrors[key]){
        delete checkoutErrors[key];
        el.classList.remove('bad');
        const msg = foot.querySelector(`[data-err="${key}"]`);
        if (msg) msg.remove();
      }
    });
  };
  bindField('nameField', 'name');
  bindField('phoneField', 'phone');
  bindField('telegramField', 'telegram');
  bindField('commentField', 'comment');
  foot.querySelectorAll('input[name=delivery]').forEach(r=>{
    r.addEventListener('change', ()=>{
      checkoutForm.delivery = r.value;
      renderDeliveryBlock(); // меняется только блок получения, остальное не трогаем
    });
  });
  renderDeliveryBlock();
  document.getElementById('checkoutBtn').addEventListener('click', handleCheckout);
}

/* Блок «куда получать». Живёт отдельной функцией, потому что перерисовывается
   сам по себе: при смене формата, при поиске ПВЗ и при выборе пункта. */
function renderDeliveryBlock(){
  const box = document.getElementById('deliveryBlock');
  if (!box) return;

  if (checkoutForm.delivery === 'Самовывоз'){
    box.innerHTML = `<p class="field-note">Самовывоз только в Москве. Место и время согласуем в Telegram после заказа.</p>`;
    return;
  }

  // Интеграция со СДЭК не настроена — спрашиваем адрес текстом, как раньше.
  if (!cdekEnabled()){
    box.innerHTML = `
      <span class="field-label">Пункт выдачи СДЭК</span>
      <textarea id="addressField" rows="2" placeholder="Город, улица, дом — ближайший к вам пункт СДЭК"${checkoutErrors.destination ? ' class="bad"' : ''}>${escapeHtml(checkoutForm.city)}</textarea>
      ${errHtml('destination')}
      <p class="field-note">Доставляем до пункта выдачи, курьером до двери не возим.</p>`;
    const a = document.getElementById('addressField');
    if (a) a.addEventListener('input', ()=>{
      checkoutForm.city = a.value;
      if (checkoutErrors.destination){
        delete checkoutErrors.destination;
        a.classList.remove('bad');
        const m = box.querySelector('[data-err="destination"]');
        if (m) m.remove();
      }
    });
    return;
  }

  const p = checkoutForm.point;
  const listHtml = cdekState === 'loading'
    ? `<div class="cdek-note mono">Ищу пункты выдачи…</div>`
    : cdekState === 'error'
      ? `<div class="cdek-note mono">Не получилось получить список СДЭК. Попробуйте ещё раз или напишите адрес в комментарии.</div>`
      : cdekState === 'empty'
        ? `<div class="cdek-note mono">В этом городе пунктов не нашлось — проверьте название.</div>`
        : cdekPoints.length
          ? `<div class="cdek-list">${cdekPoints.slice(0, 40).map(pt=>`
              <button class="cdek-item ${p && p.code===pt.code ? 'active':''}" data-cdek="${escapeHtml(pt.code)}">
                <span class="cdek-addr">${escapeHtml(pt.address || pt.name || '')}</span>
                <span class="cdek-meta mono">${pt.dist != null && isFinite(pt.dist) ? `${pt.dist.toFixed(1)} км · ` : ''}${escapeHtml(pt.work_time || '')}</span>
              </button>`).join('')}</div>`
          : '';

  box.innerHTML = `
    <span class="field-label">Пункт выдачи СДЭК</span>
    ${errHtml('destination')}
    ${p ? `
      <div class="cdek-picked">
        <div>
          <b>${escapeHtml(p.address || p.name || '')}</b>
          <div class="cdek-meta mono">${escapeHtml(p.city || '')}${p.work_time ? ' · ' + escapeHtml(p.work_time) : ''}</div>
        </div>
        <button class="link-btn" id="cdekResetBtn">выбрать другой</button>
      </div>` : (cdekMapEnabled() && !cdekWidgetBroken ? `
      <button class="btn-outline btn-full" id="cdekMapBtn">Выбрать пункт на карте</button>
      <p class="field-note">Откроется карта СДЭК: выберите пункт — адрес подставится сам.</p>
    ` : `
      <div class="cdek-search">
        <input type="text" id="cdekCityField" placeholder="Город — например, Москва" value="${escapeHtml(checkoutForm.city)}">
        <button class="btn-outline" id="cdekFindBtn">Найти</button>
      </div>
      ${navigator.geolocation ? `<button class="link-btn" id="cdekGeoBtn">Сначала ближайшие ко мне</button>` : ''}
      ${listHtml}
    `)}`;

  const cityEl = document.getElementById('cdekCityField');
  if (cityEl){
    cityEl.addEventListener('input', ()=>{ checkoutForm.city = cityEl.value; });
    cityEl.addEventListener('keydown', e=>{
      if (e.key === 'Enter'){ e.preventDefault(); searchCdekPoints(); }
    });
  }
  bindEl('cdekMapBtn', 'click', openCdekWidget);
  bindEl('cdekFindBtn', 'click', searchCdekPoints);
  bindEl('cdekGeoBtn', 'click', ()=>{
    // Координаты сортируют уже найденный список, поэтому если его ещё нет —
    // сначала ищем по городу, иначе кнопка визуально ничего не делает.
    if (!cdekPoints.length) searchCdekPoints().then(useMyLocation);
    else useMyLocation();
  });
  bindEl('cdekResetBtn', 'click', ()=>{ checkoutForm.point = null; renderDeliveryBlock(); });
  box.querySelectorAll('[data-cdek]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      checkoutForm.point = cdekPoints.find(x => x.code === btn.dataset.cdek) || null;
      delete checkoutErrors.destination; // пункт выбран, претензия снята
      renderDeliveryBlock();
    });
  });
}

/* =====================================================================
   КОНТАКТНЫЕ ДАННЫЕ.

   ФИО и телефон — отдельными полями и обязательные в обоих форматах
   получения. Раньше было одно поле «имя, телефон или ник», и в заказ
   приходило что угодно: то один ник без связи, то имя без телефона.
   Для ПВЗ СДЭК фамилия нужна по-настоящему — посылку выдают по документу.
   ===================================================================== */
function phoneDigits(raw){
  return String(raw || '').replace(/\D/g, '');
}
// Российский номер в любом написании: +7, 8, без кода — лишь бы
// набралось 10 значащих цифр. Чужие номера тоже пропускаем, если это
// похоже на международный: запрещать человеку с +375 оформить заказ глупо.
function phoneError(raw){
  const d = phoneDigits(raw);
  if (!d) return 'Оставьте телефон — по нему подтверждаем заказ.';
  if (d.length < 10) return 'Телефон выглядит коротким — проверьте номер.';
  if (d.length > 15) return 'Телефон выглядит слишком длинным — проверьте номер.';
  return '';
}
function formatPhone(raw){
  const d = phoneDigits(raw);
  // 8 и 7 в начале — один и тот же российский номер, приводим к +7
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')){
    const n = d.slice(1);
    return `+7 ${n.slice(0,3)} ${n.slice(3,6)}-${n.slice(6,8)}-${n.slice(8)}`;
  }
  if (d.length === 10) return `+7 ${d.slice(0,3)} ${d.slice(3,6)}-${d.slice(6,8)}-${d.slice(8)}`;
  return '+' + d;
}
// Контакт в Telegram — теперь основной канал связи: заказ уходит нам на
// почту сам, а отвечаем мы покупателю в телеграме. Принимаем и ник в любом
// написании (@ник, t.me/ник, просто ник), и номер телефона — у части людей
// ника просто нет, отказывать им в заказе было бы глупо.
function normalizeTelegram(raw){
  let v = String(raw || '').trim();
  v = v.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '').replace(/^telegram\.me\//i, '');
  v = v.replace(/^@+/, '').trim();
  return v;
}
function telegramError(raw){
  const v = normalizeTelegram(raw);
  if (!v) return 'Укажите ник в Telegram — по нему мы свяжемся с вами.';
  if (/^\+?\d[\d\s()-]{8,}$/.test(v)) return ''; // дали телефон вместо ника
  // Ограничения самого телеграма: 5–32 символа, буквы, цифры и подчёркивание
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v)){
    return 'Похоже на опечатку. Ник выглядит так: @username (латиница, от 5 символов).';
  }
  return '';
}
function telegramDisplay(raw){
  const v = normalizeTelegram(raw);
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v) ? '@' + v : v;
}

function nameError(raw){
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Укажите фамилию и имя.';
  // Посылку в ПВЗ выдают по паспорту на конкретное ФИО, одного имени мало
  if (parts.length < 2 || parts.some(p => p.length < 2)){
    return 'Нужны фамилия и имя полностью — по ним выдают заказ.';
  }
  return '';
}

/* =====================================================================
   ПУНКТЫ ВЫДАЧИ СДЭК.

   Список ПВЗ отдаёт только API СДЭК, и только по токену: публичный
   pvzlist закрыт (410), api.cdek.ru/v2 без авторизации отвечает 401.
   Ключи в браузер класть нельзя, да и CORS там нет, поэтому между сайтом
   и СДЭК стоит своя функция — serverless/cdek-points. Она держит токен,
   ходит за списком и отдаёт нам уже урезанный JSON.

   Пока адрес функции в CONFIG.cdekPointsUrl пустой, блок с картой ПВЗ
   не показывается вообще, а адрес доставки спрашиваем текстом — сайт
   работает и без настроенной интеграции.
   ===================================================================== */
function cdekEnabled(){ return !!(CONFIG.cdekPointsUrl || '').trim(); }
// Карта — только когда есть оба ключа. Без ключа Яндекс.Карт виджет
// не покажет ничего, поэтому в таком случае остаёмся на простом списке.
function cdekMapEnabled(){ return cdekEnabled() && !!(CONFIG.cdekWidgetKey || '').trim(); }

/* ---------------------------------------------------------------------
   ВИДЖЕТ СДЭК С КАРТОЙ.

   Официальный виджет (@cdek-it/widget), лежит у нас же в js/vendor.
   Грузится лениво, по нажатию «Выбрать на карте»: он весит под 700 КБ,
   и платить этим весом за каждый заход на сайт — при том что до корзины
   дойдут единицы — незачем.

   Если файл не загрузился или виджет упал (нет ключа, не отвечает
   функция), молча остаёмся на списке пунктов: выбрать ПВЗ человек
   должен в любом случае.
   --------------------------------------------------------------------- */
const CDEK_WIDGET_SRC = 'js/vendor/cdek-widget.4.0.0.umd.js';
let cdekWidget = null;
let cdekWidgetBroken = false;

function loadCdekWidgetScript(){
  if (window.CDEKWidget) return Promise.resolve(true);
  if (loadCdekWidgetScript.pending) return loadCdekWidgetScript.pending;
  loadCdekWidgetScript.pending = new Promise(resolve=>{
    const s = document.createElement('script');
    s.src = CDEK_WIDGET_SRC;
    s.onload = ()=>resolve(!!window.CDEKWidget);
    s.onerror = ()=>resolve(false);
    document.head.appendChild(s);
  });
  return loadCdekWidgetScript.pending;
}

async function openCdekWidget(){
  const btn = document.getElementById('cdekMapBtn');
  if (btn){ btn.disabled = true; btn.textContent = 'Открываю карту…'; }
  const ok = await loadCdekWidgetScript();
  if (!ok){
    cdekWidgetBroken = true;
    renderDeliveryBlock(); // молча переключаемся на список
    return;
  }
  try{
    if (!cdekWidget){
      cdekWidget = new window.CDEKWidget({
        apiKey: CONFIG.cdekWidgetKey,
        servicePath: CONFIG.cdekPointsUrl,
        popup: true,
        // Курьером до двери не возим: у проекта нет ни тарифа, ни склада
        // отправки — только выдача в пункте.
        hideDeliveryOptions: { door: true, office: false },
        defaultLocation: (checkoutForm.city || '').trim() || CONFIG.cdekDefaultCity || 'Москва',
        onChoose: (type, tariff, office)=>{
          if (!office || !office.code) return;
          checkoutForm.point = {
            code: office.code,
            name: office.name || '',
            address: office.address || office.name || '',
            city: office.city || '',
            work_time: office.work_time || ''
          };
          if (office.city) checkoutForm.city = office.city;
          delete checkoutErrors.destination;
          cdekWidget.close();
          renderDeliveryBlock();
        }
      });
    }
    cdekWidget.open();
  }catch(e){
    cdekWidgetBroken = true;
  }
  renderDeliveryBlock();
}

// Расстояние по прямой, км. Нужно только для сортировки «сначала ближние»,
// поэтому землю считаем шаром — разница с настоящей геодезией здесь
// меньше, чем разница между прямой и реальным маршрутом.
function distanceKm(a, b){
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat/2) ** 2 +
            Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function sortCdekPoints(){
  if (!cdekGeo) return;
  cdekPoints.forEach(p=>{
    p.dist = (typeof p.lat === 'number' && typeof p.lon === 'number')
      ? distanceKm(cdekGeo, p) : Infinity;
  });
  cdekPoints.sort((a,b)=>a.dist - b.dist);
}
async function searchCdekPoints(){
  const city = (checkoutForm.city || '').trim();
  if (!city || !cdekEnabled()) return;
  cdekState = 'loading';
  cdekPoints = [];
  renderDeliveryBlock();
  try{
    const res = await fetch(`${CONFIG.cdekPointsUrl}?city=${encodeURIComponent(city)}`);
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    cdekPoints = Array.isArray(data.points) ? data.points : [];
    sortCdekPoints();
    cdekState = cdekPoints.length ? '' : 'empty';
  }catch(e){
    cdekState = 'error';
  }
  renderDeliveryBlock();
}
// Геолокация — не обязательный шаг, а ускоритель: она только пересортировывает
// уже найденный по городу список. Город всё равно спрашиваем руками, потому
// что по координатам СДЭК город не отдаёт, а гадать за покупателя не стоит.
function useMyLocation(){
  if (!navigator.geolocation) return;
  const btn = document.getElementById('cdekGeoBtn');
  if (btn){ btn.disabled = true; btn.textContent = 'Определяю…'; }
  navigator.geolocation.getCurrentPosition(
    pos=>{
      cdekGeo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      sortCdekPoints();
      renderDeliveryBlock();
    },
    ()=>{
      cdekGeo = null;
      renderDeliveryBlock(); // браузер отказал — просто остаёмся на списке по городу
    },
    { timeout: 8000, maximumAge: 300000 }
  );
}

/* ---------------------------------------------------------------------
   ОФОРМЛЕННЫЙ ЗАКАЗ.

   Номер выдаёт таблица — единственное место, общее для всех покупателей.
   В браузере сквозной номер получить неоткуда: у каждого свой счётчик,
   и первый заказ был бы первым у всех сразу.
   --------------------------------------------------------------------- */
// Запасной номер, когда таблица не ответила. По нему заказ всё так же
// находится в переписке, просто он не сквозной — и это видно по виду.
function localOrderNumber(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `SP-${p(d.getDate())}${p(d.getMonth()+1)}-` +
         Math.random().toString(36).slice(2, 6).toUpperCase();
}
function savePlacedOrder(){
  try{ localStorage.setItem(ORDER_KEY, JSON.stringify(placedOrder)); }catch(e){}
}
function loadPlacedOrder(){
  try{
    const raw = localStorage.getItem(ORDER_KEY);
    const data = raw ? JSON.parse(raw) : null;
    placedOrder = (data && data.number) ? data : null;
  }catch(e){ placedOrder = null; }
}
function clearPlacedOrder(){
  placedOrder = null;
  try{ localStorage.removeItem(ORDER_KEY); }catch(e){}
}

/* Совпадения корзины с недавним заказом — то, ради чего предупреждение
   вообще нужно: «забыл, что уже брал это, и заказал второй раз».

   Считаем повтором только точное совпадение товара И размера. Худи L и
   худи XL — это не дубль, а осознанная покупка двух разных вещей, и
   ругаться на неё значит приучить не читать предупреждения вообще.

   Три дня — потому что забывчивость живёт часами, а не месяцами. Человек,
   вернувшийся через неделю за второй такой же вещью, делает это нарочно. */
const DUP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
function duplicateInCart(){
  if (!placedOrder || !placedOrder.at) return [];
  const at = new Date(placedOrder.at).getTime();
  if (!at || Date.now() - at > DUP_WINDOW_MS) return [];
  const ordered = placedOrder.lines || [];
  return cart.map(item=>{
    const p = findProduct(item.productId);
    const name = p ? p.name : item.productId;
    // id появился не сразу — у заказов, сохранённых раньше, сверяемся по названию
    const same = ordered.find(l => (l.id ? l.id === item.productId : l.name === name)
                                   && l.size === item.size);
    return same ? `${name} ${item.size}` : null;
  }).filter(Boolean);
}

/* =====================================================================
   CHECKOUT — валидация остатков на клиенте + переход в Telegram
   с готовым сообщением. Реальная оплата и подтверждение заказа
   происходят вручную в переписке с продавцом — сайт ничего не списывает
   как "оплаченное", только резервирует остаток и формирует заявку.
   ===================================================================== */
async function handleCheckout(){
  const errEl = document.getElementById('checkoutError');
  const name = (checkoutForm.name || '').trim();
  const phone = (checkoutForm.phone || '').trim();
  const comment = (checkoutForm.comment || '').trim();
  const delivery = checkoutForm.delivery;

  // ФИО и телефон нужны в обоих форматах: на самовывозе — чтобы отдать заказ
  // тому, кто за ним пришёл, при доставке — потому что СДЭК без них посылку
  // не примет.
  checkoutErrors = {};
  const nameErr = nameError(name);
  if (nameErr) checkoutErrors.name = nameErr;
  const phoneErr = phoneError(phone);
  if (phoneErr) checkoutErrors.phone = phoneErr;
  const tgErr = telegramError(checkoutForm.telegram);
  if (tgErr) checkoutErrors.telegram = tgErr;

  let destination = '';
  if (delivery === 'Доставка'){
    if (cdekEnabled()){
      if (!checkoutForm.point){
        checkoutErrors.destination = 'Выберите пункт выдачи СДЭК — туда приедет заказ.';
      }else{
        const p = checkoutForm.point;
        destination = `ПВЗ СДЭК ${p.code}${p.city ? ', ' + p.city : ''}: ${p.address || p.name || ''}`;
      }
    }else if (!(checkoutForm.city || '').trim()){
      checkoutErrors.destination = 'Напишите адрес пункта СДЭК, куда привезти заказ.';
    }else{
      destination = checkoutForm.city.trim();
    }
  }

  const bad = Object.keys(checkoutErrors);
  if (bad.length){
    renderDrawer();
    // Подсветили всё разом, но курсор ставим в первое поле сверху — чтобы
    // человек начинал чинить с начала формы, а не с того, что мы проверили
    // первым по коду.
    const order = ['name', 'phone', 'telegram', 'destination'];
    const firstKey = order.find(k => checkoutErrors[k]);
    const focusId = { name:'nameField', phone:'phoneField', telegram:'telegramField',
                      destination: cdekEnabled() ? 'cdekCityField' : 'addressField' }[firstKey];
    const el = focusId && document.getElementById(focusId);
    if (el) el.focus();
    return;
  }
  const telegram = telegramDisplay(checkoutForm.telegram);

  if (cart.length === 0) return;

  // Проверка по актуальному каталогу: тираж мог поменять продавец, пока
  // товар лежал в корзине. Лимит общий на товар, поэтому идём по товарам
  // и режем позиции, пока набранное не уложится в остаток.
  const shortages = [];
  [...new Set(cart.map(c => c.productId))].forEach(id=>{
    const p = findProduct(id);
    let room = p ? editionLeft(p) - (reservedStock[id] || 0) : 0;
    cart.filter(c => c.productId === id).forEach(item=>{
      const allowed = Math.max(Math.min(item.qty, room), 0);
      if (allowed < item.qty){
        item.qty = allowed;
        shortages.push(item);
      }
      room -= allowed;
    });
  });
  cart = cart.filter(c => c.qty > 0);
  saveCart();

  if (shortages.length > 0){
    errEl.textContent = 'Часть позиций разобрали, пока товар лежал в корзине — количество скорректировано, проверь заказ и повтори.';
    errEl.classList.add('show');
    renderCartCount();
    renderDrawer();
    return;
  }
  errEl.classList.remove('show');

  // Номер приходит из таблицы, а туда надо сходить по сети. Кнопку на это
  // время запираем: два нажатия подряд — это два номера и два заказа.
  const btn = document.getElementById('checkoutBtn');
  if (btn){
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Оформляю…';
  }

  const items = cart.map(i=>{
    const p = findProduct(i.productId);
    const it = { id: i.productId, name: p ? p.name : i.productId, size: i.size, qty: i.qty,
                 price: p ? p.price : 0 };
    // Тираж отдаём таблице только когда резерв включён. Поле именно
    // отсутствует, а не равно null: null скрипт прочитал бы как тираж «ноль»
    // и отклонил бы любой заказ.
    if (reserveEnabled()){
      const limit = stockLimitFor(i.productId, i.size);
      if (typeof limit === 'number') it.limit = limit;
    }
    return it;
  });
  const total = cartTotalPrice();
  const discount = (surveyResult && surveyResult.discount) || 0;
  const orderId = surveyResult && surveyResult.id ? surveyResult.id : ('O' + Date.now().toString(36));

  // Заказ уезжает в ту же таблицу и той же строкой, что и ответы опроса
  // (сходятся по id). Так видно не только что люди отвечали, но и кто из
  // них в итоге заказал. Ответом она возвращает номер заказа и номера вещей.
  const res = await sendToSheet({
    type: 'order',
    id: orderId,
    ts: new Date().toISOString(),
    name,
    phone: formatPhone(phone),
    telegram,
    delivery,
    destination,
    comment,
    items,
    total,
    discount
  });

  // Размер разобрали, пока человек заполнял форму. Таблица проверяет это
  // заново, без кэша, и в таком случае не выдаёт номер и ничего не пишет —
  // заказ не состоялся. Возвращаем покупателя в корзину с честным остатком.
  if (res && res.ok === false && Array.isArray(res.oversold) && res.oversold.length){
    applyReserved(res.reserved);
    cart = cart.filter(c=>{
      const miss = res.oversold.find(o => o.id === c.productId && o.size === c.size);
      if (!miss) return true;
      c.qty = Math.min(c.qty, miss.left);
      return c.qty > 0;
    });
    saveCart();
    const what = res.oversold.map(o=>`${o.name || ''} ${o.size}`.trim()).join(', ');
    cartNotice = `Пока вы оформляли, это разобрали: ${what}. Корзину поправили — проверьте и оформите заново.`;
    renderCartCount();
    renderDrawer();
    render();
    return;
  }

  // Дошёл ли заказ до нас. От этого зависит, что мы скажем покупателю:
  // обещать «с вами свяжутся», когда заказ никуда не уехал, нельзя —
  // человек будет ждать звонка, которого не будет.
  const delivered = !!(res && res.order);

  // Таблица не ответила (не настроена, нет сети) — заказ всё равно должен
  // оформиться: номер тогда местный, по дате и случайному хвосту. Он так же
  // годится, чтобы найти заказ в переписке, просто не сквозной.
  const number = delivered ? res.order : localOrderNumber();
  if (res && res.reserved) applyReserved(res.reserved); // витрина сразу видит новый остаток
  const unitsById = {};
  if (res && Array.isArray(res.units)){
    res.units.forEach(u=>{ unitsById[(u.id || '') + '|' + (u.size || '')] = u.numbers || []; });
  }
  const lines = items.map(it=>({
    id: it.id, name: it.name, size: it.size, qty: it.qty,
    numbers: unitsById[it.id + '|' + it.size] || []
  }));

  const msg = [`Заказ ${number} с сайта SPOTTER:`];
  lines.forEach(l=>{
    const nums = l.numbers.length ? `, ${l.numbers.map(n=>'№'+n).join(', ')}` : '';
    const p = items.find(i=>i.name === l.name && i.size === l.size);
    msg.push(`— ${l.name}, размер ${l.size}, ${l.qty} шт.${nums}, ${formatPrice((p ? p.price : 0) * l.qty)}`);
  });
  msg.push(`Итого: ${formatPrice(total)}`);
  if (discount){
    msg.push(`Скидка за опрос: −${formatPrice(discount)}`);
    msg.push(`С учётом скидки: ${formatPrice(Math.max(total - discount, 0))}`);
  }
  msg.push(`Формат получения: ${delivery}`);
  if (destination) msg.push(`Куда: ${destination}`);
  msg.push(`ФИО: ${name}`);
  msg.push(`Телефон: ${formatPhone(phone)}`);
  msg.push(`Telegram: ${telegram}`);
  if (comment) msg.push(`Комментарий: ${comment}`);
  // Ответы опроса едут тем же сообщением, что и заказ: иначе продавцу
  // пришлось бы сводить два разных сообщения от одного человека.
  const text = msg.join('\n') + (surveyResult ? '\n\n' + surveyResultText() : '');

  placedOrder = {
    number, text, lines, total, discount, delivered,
    at: new Date().toISOString(),
    // Ссылка нужна только запасному сценарию — когда заказ до нас не дошёл
    // и человеку приходится прислать его руками.
    url: `https://t.me/${CONFIG.telegramUsername}?text=${encodeURIComponent(text)}`
  };
  savePlacedOrder();

  // Корзину чистим сразу, как только заказ получил номер. Раньше она жила
  // до подтверждения «я отправил», и это был прямой путь к дублю: человек
  // возвращался, видел свои вещи на месте и оформлял их второй раз.
  // Состав никуда не делся — он в экране заказа и в тексте сообщения.
  cart = [];
  cartNotice = '';
  saveCart();
  clearSurveyResult(); // скидка уже учтена в этом заказе
  renderCartCount();
  renderDrawer();
  render();
}

// Копирование заказа — страховка на случай, если t.me не открывается
// (у части провайдеров домен заблокирован) или человек пишет с другого устройства.
async function copyOrder(text){
  const msg = document.getElementById('copyMsg');
  try{
    await navigator.clipboard.writeText(text);
    if (msg) msg.textContent = 'Скопировано — пришлите текст нам в Telegram.';
  }catch(e){
    // clipboard API недоступен (нет https или отказ) — выделяем текст,
    // чтобы человек мог скопировать вручную
    const pre = document.getElementById('orderText');
    if (pre){
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    if (msg) msg.textContent = 'Не удалось скопировать автоматически — текст выделен, скопируйте вручную.';
  }
}

/* =====================================================================
   INIT
   ===================================================================== */
function init(){
  document.getElementById('year').textContent = new Date().getFullYear();
  loadCart();
  loadSurveyResult();
  loadPlacedOrder();
  renderCartCount();
  applyRoute(); // разбирает адрес и рисует нужный раздел
  refreshViews(); // не ждём: страница уже нарисована со снимком просмотров
  loadContentData(); // не ждём: то же самое, но для выпусков и мерча из админки
  loadReservedStock(); // и остатки с учётом уже оформленных заказов
  // шрифты грузятся асинхронно: до их загрузки ширина слов другая — пересчитываем
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeroLayout);
  let resizeTimer;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitHeroLayout, 120);
  });
}
init();
