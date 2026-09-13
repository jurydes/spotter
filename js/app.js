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
let checkoutOrder = null;    // сформированный заказ, ждёт подтверждения отправки

/* =====================================================================
   UTIL
   ===================================================================== */
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
function productPhoto(p, index){
  const images = productImages(p);
  const src = images[index || 0] || images[0];
  if (src){
    return `<div class="ph-photo viewfinder">
      <img src="${src}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;display:block;">
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

   Теперь остатки — то, что написано в CONFIG.merch[].stock, и правит их
   продавец руками. Сайт их не списывает: он не знает, дошёл ли заказ до
   продавца и подтверждён ли он. Число рядом с размером — справка
   «сколько есть», а не бронь.

   Настоящая общая на всех посетителей бронь возможна только с бэкендом:
   тогда getStockFor подменяется запросом к нему, остальной код не меняется.
   ===================================================================== */
function getStockFor(productId, size){
  const p = findProduct(productId);
  if (!p || !p.stock) return 0;
  const v = p.stock[size];
  return typeof v === 'number' ? v : 0;
}

/* =====================================================================
   КОРЗИНА — localStorage, переживает перезагрузку и закрытие вкладки.
   Всё в try/catch: в приватном режиме и при запрете хранилища запись
   бросает исключение, и корзина должна просто работать в пределах
   сессии, а не ронять страницу.
   ===================================================================== */
const CART_KEY = 'spotter-cart-v1';
// Предзаказ размера, которого нет в остатке: остатка для проверки нет,
// поэтому просто ограничиваем разумным числом, а не нулём.
const PREORDER_MAX_QTY = 20;
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
  const available = getStockFor(productId, size);
  const already = qtyInCart(productId, size);
  const room = available - already;
  if (room <= 0) return false;
  const add = Math.min(qty, room);
  const existing = cart.find(c => c.productId === productId && c.size === size);
  if (existing) existing.qty += add;
  else cart.push({ productId, size, qty: add });
  saveCart();
  renderCartCount();
  return add === qty;
}
// Предзаказ: размера нет в остатке, но покупатель готов подождать.
// В отличие от addToCart ничем не ограничен, кроме PREORDER_MAX_QTY —
// сверяться тут не с чем, товара физически ещё нет.
function addPreorder(productId, size, qty){
  const add = Math.max(1, Math.min(qty, PREORDER_MAX_QTY));
  const existing = cart.find(c => c.productId === productId && c.size === size);
  if (existing){
    existing.qty = Math.min(existing.qty + add, PREORDER_MAX_QTY);
    existing.preorder = true;
  } else {
    cart.push({ productId, size, qty: add, preorder: true });
  }
  saveCart();
  renderCartCount();
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
  const cap = item.preorder ? PREORDER_MAX_QTY : getStockFor(productId, size);
  item.qty = Math.min(qty, cap);
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
document.getElementById('tabsDesktop').addEventListener('click', e=>{
  const b = e.target.closest('button'); if(!b) return;
  navigate(b.dataset.tab === 'home' ? '#/' : '#/' + b.dataset.tab);
});
document.getElementById('tabsMobile').addEventListener('click', e=>{
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
  const popular = CONFIG.merch.find(p=>p.popular) || CONFIG.merch[0];
  // новинка — последний добавленный товар в CONFIG.merch, но не тот же, что уже
  // показан как популярный (иначе на главной дублировалась одна и та же карточка)
  const newest = [...CONFIG.merch].reverse().find(p => p.id !== popular.id) || CONFIG.merch[0];
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

  <section>
    <div class="wrap">
      <div class="section-head">
        <h2>Мерч</h2>
      </div>
      <div class="merch-grid">
        ${productCardHtml(newest, 'Новый дроп')}
        ${productCardHtml(popular, 'Популярное')}
      </div>
      </div>
    </div>
  </section>
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
function stockLabel(product){
  const total = product.sizes.reduce((a,s)=>a+getStockFor(product.id,s),0);
  if (total <= 0) return { text:'нет в наличии', cls:'stock-out' };
  if (total <= 3) return { text:`осталось ${total}`, cls:'stock-low' };
  return { text:'в наличии', cls:'stock-ok' };
}
// Сколько единиц этого товара уже лежит в корзине — по всем размерам сразу
function qtyInCartForProduct(productId){
  return cart.filter(c => c.productId === productId).reduce((a,c) => a + c.qty, 0);
}
function buyButtonHtml(product){
  const outOfStock = stockLabel(product).cls === 'stock-out';
  if (outOfStock){
    // Остатка нет, но заказать всё равно можно — карточка ведёт в модалку,
    // где для каждого размера открыт путь оформить предзаказ.
    return `<button class="btn-outline buy-btn" data-choose-size="${product.id}">Предзаказ</button>`;
  }
  // Товар уже в корзине — вместо повторного добавления даём переход в корзину.
  if (qtyInCartForProduct(product.id) > 0){
    return `<button class="btn-outline buy-btn" data-open-cart="${product.id}">Посмотреть корзину</button>`;
  }
  // Из списка товар в корзину не кладётся: размер нужно выбрать осознанно,
  // поэтому кнопка ведёт в карточку товара, где есть размеры и количество.
  return `<button class="btn buy-btn" data-choose-size="${product.id}">Выбрать размер</button>`;
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
        <div class="price">${formatPrice(p.price)}</div>
        <div class="stock-flag ${st.cls}">${st.text}</div>
        <div class="delivery-note mono">Доставка от 7 до 14 дней</div>
        ${buyButtonHtml(p)}
      </div>
    </div>`;
}
function renderMerch(){
  const categories = [ALL_CATEGORY, ...new Set(CONFIG.merch.map(p=>p.category))];
  const filtered = activeFilter === ALL_CATEGORY
    ? CONFIG.merch
    : CONFIG.merch.filter(p=>p.category===activeFilter);

  const cards = filtered.map(p => productCardHtml(p, p.popular ? 'Популярное' : null)).join('');

  return `
  <section style="border-top:none;">
    <div class="wrap">
      <div class="section-head">
        <h2>Мерч</h2>
      </div>
      <div class="filters">
        ${categories.map(c=>`<button data-filter="${escapeHtml(c)}" class="${c===activeFilter?'active':''}">${escapeHtml(c)}</button>`).join('')}
      </div>
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
  if (!document.getElementById('cartDrawer').classList.contains('open')) lockScroll(false);
  // Сверяемся с адресом, а не с разобранным route: hashchange приходит
  // следующей задачей, и сразу после открытия карточки route ещё старый —
  // тогда закрытие не возвращало адрес назад, и карточка открывалась снова.
  if (!fromRoute && location.hash.indexOf('#/product/') === 0) navigate('#/merch');
}
function renderModal(){
  const p = modalProduct;
  // сколько ещё можно взять выбранного размера с учётом того, что уже в корзине
  const availableForSize = modalSize ? getStockFor(p.id, modalSize) - qtyInCart(p.id, modalSize) : 0;
  const anySizeLeft = p.sizes.some(s => getStockFor(p.id, s) - qtyInCart(p.id, s) > 0);
  const inCart = qtyInCartForProduct(p.id);
  // Распроданный размер остаётся кликабельным: выбрав его, покупатель видит,
  // что размера нет, и может попросить сообщить о поступлении — вместо
  // молчаливой серой кнопки, по которой непонятно, что делать дальше.
  const sizesHtml = p.sizes.map(s=>{
    const left = getStockFor(p.id, s) - qtyInCart(p.id, s);
    return `<button class="size-btn ${s===modalSize?'active':''} ${left<=0?'sold-out':''}" data-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`;
  }).join('');

  const images = productImages(p);
  const galleryHtml = images.length > 1 ? `
    <div class="thumb-row">
      ${images.map((src,i)=>`
        <button class="thumb ${i===modalPhoto?'active':''}" data-photo="${i}" aria-label="Фото ${i+1}">
          <img src="${src}" alt="" loading="lazy" decoding="async">
        </button>`).join('')}
    </div>` : '';

  // Состояния основной кнопки: нет остатка → размер не выбран → готово к добавлению
  let addLabel = 'Добавить в корзину', addDisabled = false;
  if (!anySizeLeft){ addLabel = 'Нет в наличии'; addDisabled = true; }
  else if (!modalSize){ addLabel = 'Выберите размер'; addDisabled = true; }
  else if (availableForSize <= 0){ addLabel = 'Этого размера нет'; addDisabled = true; }

  const soldOutPicked = modalSize && availableForSize <= 0;
  // Пока размер не выбран — счётчик считает остаток, после выбора распроданного
  // размера тот же счётчик переключается на потолок предзаказа.
  const qtyCap = soldOutPicked ? PREORDER_MAX_QTY : availableForSize;

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
      <div class="price">${formatPrice(p.price)}</div>
      <p class="desc">${escapeHtml(p.description)}</p>
      <div class="delivery-note mono">Доставка от 7 до 14 дней</div>
      <div>
        <span class="field-label">Размер</span>
        <div class="size-row">${sizesHtml}</div>
      </div>
      ${soldOutPicked ? `
      <div class="restock">
        <div class="restock-title mono">Размер ${escapeHtml(modalSize)} разобрали</div>
        <p class="restock-note">Можно оформить предзаказ — сроки и оплату продавец согласует в переписке.</p>
        <div class="qty-row">
          <button class="qty-btn" id="qtyMinus" ${modalQty<=1?'disabled':''}>−</button>
          <span class="qty-val" id="qtyVal">${modalQty}</span>
          <button class="qty-btn" id="qtyPlus" ${modalQty < qtyCap ? '' : 'disabled'}>+</button>
        </div>
        <button class="btn" id="preorderBtn">Оформить предзаказ</button>
        <button class="link-btn" id="restockBtn">Просто сообщить, когда появится</button>
      </div>` : `
      <div>
        <span class="field-label">Количество</span>
        <div class="qty-row">
          <button class="qty-btn" id="qtyMinus" ${modalQty<=1?'disabled':''}>−</button>
          <span class="qty-val" id="qtyVal">${modalQty}</span>
          <button class="qty-btn" id="qtyPlus" ${modalSize && modalQty < qtyCap ? '' : 'disabled'}>+</button>
          <span class="stock-note">${modalSize ? `осталось: ${Math.max(availableForSize,0)}` : 'выберите размер'}</span>
        </div>
      </div>
      <button class="btn" id="addToCartBtn" ${addDisabled?'disabled style="opacity:.4;cursor:not-allowed;"':''}>${addLabel}</button>`}
      ${modalMsg ? `<div class="add-msg">${escapeHtml(modalMsg)}</div>` : ''}
      ${inCart > 0 ? `<button class="btn-outline" id="modalCartBtn">Посмотреть корзину</button>` : ''}
    </div>
  `;
  document.getElementById('modalCloseBtn').addEventListener('click', ()=>closeProduct());
  const zoomBtn = document.getElementById('zoomOpenBtn');
  if (zoomBtn) zoomBtn.addEventListener('click', ()=>openLightbox(images, modalPhoto, p.name));
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
  const restockBtn = document.getElementById('restockBtn');
  if (restockBtn) restockBtn.addEventListener('click', ()=>{
    const text = `Привет! Сообщите, когда появится: ${p.name}, размер ${modalSize}.`;
    window.open(`https://t.me/${CONFIG.telegramUsername}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });
  document.getElementById('qtyMinus').addEventListener('click', ()=>{
    modalQty = Math.max(1, modalQty-1); renderModal();
  });
  document.getElementById('qtyPlus').addEventListener('click', ()=>{
    modalQty = Math.min(Math.max(qtyCap,1), modalQty+1); renderModal();
  });
  const preorderBtn = document.getElementById('preorderBtn');
  if (preorderBtn) preorderBtn.addEventListener('click', ()=>{
    const asked = modalQty;
    addPreorder(p.id, modalSize, asked);
    modalMsg = `Добавлено в предзаказ: размер ${modalSize}, ${asked} шт.`;
    modalQty = 1;
    renderModal();
    render();
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
}
document.getElementById('productOverlay').addEventListener('click', e=>{
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
  const productOpen = document.getElementById('productOverlay').classList.contains('open');
  const drawerOpen = document.getElementById('cartDrawer').classList.contains('open');
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
document.getElementById('lightbox').addEventListener('click', e=>{
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
function releaseFocus(){
  ['productOverlay','cartDrawer'].forEach(id=>{
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
  else if (document.getElementById('productOverlay').classList.contains('open')) closeProduct();
  else if (document.getElementById('cartDrawer').classList.contains('open')) closeDrawer();
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
  checkoutOrder = null; // при следующем открытии — снова корзина, а не экран отправки
  releaseFocus();
  // карточка товара может остаться открытой под корзиной — тогда замок не снимаем
  if (!document.getElementById('productOverlay').classList.contains('open')) lockScroll(false);
}
document.getElementById('cartOpenBtn').addEventListener('click', openDrawer);
document.getElementById('drawerCloseBtn').addEventListener('click', closeDrawer);
document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);

function renderDrawer(){
  const body = document.getElementById('drawerBody');
  const foot = document.getElementById('drawerFoot');

  // Экран «заказ сформирован» — показывается вместо корзины после нажатия
  // «Оформить». Корзина при этом ещё цела: пока покупатель не подтвердит,
  // что отправил сообщение, терять её нельзя.
  if (checkoutOrder){
    body.innerHTML = `
      <div class="order-done">
        <h3>Заказ сформирован</h3>
        <p class="order-hint">Telegram откроется с готовым сообщением — его нужно <b>отправить вручную</b>, само оно не уйдёт. Если Telegram не открылся, скопируйте текст и пришлите его нам любым способом.</p>
        <pre class="order-text" id="orderText">${escapeHtml(checkoutOrder.text)}</pre>
      </div>`;
    foot.innerHTML = `
      <a class="btn btn-full" id="tgBtn" href="${escapeHtml(checkoutOrder.url)}" target="_blank" rel="noopener">Открыть Telegram</a>
      <button class="btn-outline btn-full" id="copyBtn">Скопировать заказ</button>
      <button class="btn-outline btn-full" id="sentBtn">Я отправил — очистить корзину</button>
      <button class="link-btn" id="backToCartBtn">Вернуться к корзине</button>
      <div class="add-msg" id="copyMsg"></div>`;
    document.getElementById('copyBtn').addEventListener('click', ()=>copyOrder(checkoutOrder.text));
    document.getElementById('sentBtn').addEventListener('click', ()=>{
      cart = [];
      saveCart();
      checkoutOrder = null;
      renderCartCount();
      renderDrawer();
      render();
    });
    document.getElementById('backToCartBtn').addEventListener('click', ()=>{
      checkoutOrder = null;
      renderDrawer();
    });
    return;
  }

  if (cart.length === 0){
    body.innerHTML = `<div class="empty-cart">Корзина пуста</div>`;
    foot.innerHTML = '';
    return;
  }

  body.innerHTML = cart.map(item=>{
    const p = findProduct(item.productId);
    if (!p) return '';
    const max = item.preorder ? PREORDER_MAX_QTY : getStockFor(item.productId, item.size);
    return `
    <div class="cart-item">
      ${productPhoto(p)}
      <div class="ci-info">
        <h4>${escapeHtml(p.name)}</h4>
        <div class="ci-meta">размер: ${escapeHtml(item.size)}${item.preorder ? ' <span class="preorder-flag">предзаказ</span>' : ''}</div>
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
    <div class="total-row"><b>Итого</b><span class="mono">${formatPrice(cartTotalPrice())}</span></div>

    <div>
      <span class="field-label">Формат получения</span>
      <div class="radio-row">
        <label class="radio-opt"><input type="radio" name="delivery" value="Самовывоз" checked> Самовывоз</label>
        <label class="radio-opt"><input type="radio" name="delivery" value="Доставка"> Доставка</label>
      </div>
    </div>
    <div>
      <span class="field-label">Имя и контакт для связи</span>
      <input type="text" id="contactField" placeholder="Имя, телефон или ник в Telegram">
    </div>
    <div>
      <span class="field-label">Комментарий к заказу (необязательно)</span>
      <textarea id="commentField" rows="2" placeholder="Адрес доставки, пожелания по размеру и т.д."></textarea>
    </div>
    <div class="checkout-error mono" id="checkoutError">Укажи имя или контакт, чтобы оформить заказ.</div>
    <button class="btn btn-full" id="checkoutBtn">Оформить заказ в Telegram</button>
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
  document.getElementById('checkoutBtn').addEventListener('click', handleCheckout);
}

/* =====================================================================
   CHECKOUT — валидация остатков на клиенте + переход в Telegram
   с готовым сообщением. Реальная оплата и подтверждение заказа
   происходят вручную в переписке с продавцом — сайт ничего не списывает
   как "оплаченное", только резервирует остаток и формирует заявку.
   ===================================================================== */
function handleCheckout(){
  const errEl = document.getElementById('checkoutError');
  const contact = document.getElementById('contactField').value.trim();
  const comment = document.getElementById('commentField').value.trim();
  const delivery = document.querySelector('input[name=delivery]:checked').value;

  if (!contact){
    errEl.textContent = 'Укажи имя или контакт, чтобы оформить заказ.';
    errEl.classList.add('show');
    return;
  }
  if (cart.length === 0) return;

  // Проверка по актуальному каталогу: остатки мог поменять продавец,
  // пока товар лежал в корзине
  const shortages = [];
  cart.forEach(item=>{
    if (item.preorder) return; // остатка для предзаказа нет и не должно быть — сверять не с чем
    const available = getStockFor(item.productId, item.size);
    if (item.qty > available){
      item.qty = Math.max(available, 0);
      shortages.push(item);
    }
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

  const lines = ['Заказ с сайта SPOTTER:'];
  cart.forEach(item=>{
    const p = findProduct(item.productId);
    const tag = item.preorder ? ' — ПРЕДЗАКАЗ' : '';
    lines.push(`— ${p.name}, размер ${item.size}, ${item.qty} шт., ${formatPrice(p.price*item.qty)}${tag}`);
  });
  lines.push(`Итого: ${formatPrice(cartTotalPrice())}`);
  lines.push(`Формат получения: ${delivery}`);
  lines.push(`Контакт: ${contact}`);
  if (comment) lines.push(`Комментарий: ${comment}`);
  const text = lines.join('\n');

  // Ссылка только подставляет черновик — отправляет его человек руками.
  // Поэтому корзину здесь не трогаем: она очистится, когда покупатель
  // подтвердит отправку. Остатки не списываем вообще — сайт не может знать,
  // дошёл ли заказ и подтверждён ли он продавцом.
  checkoutOrder = { text, url: `https://t.me/${CONFIG.telegramUsername}?text=${encodeURIComponent(text)}` };
  renderDrawer();
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
  renderCartCount();
  applyRoute(); // разбирает адрес и рисует нужный раздел
  refreshViews(); // не ждём: страница уже нарисована со снимком просмотров
  loadContentData(); // не ждём: то же самое, но для выпусков и мерча из админки
  // шрифты грузятся асинхронно: до их загрузки ширина слов другая — пересчитываем
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeroLayout);
  let resizeTimer;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitHeroLayout, 120);
  });
}
init();
