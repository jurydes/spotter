/* =====================================================================
   АНАЛИТИКА — Яндекс Метрика.

   Почему она, а не что-то из Яндекс Облака: в Облаке аналитики
   посетителей нет вообще. Бакет и CDN умеют только логи запросов —
   сколько раз дёрнули файл, с какого адреса, какой код ответа. Ни
   посетителей, ни сессий, ни кликов оттуда не достать, не написав
   собственную обработку логов.

   Метрика бесплатна без ограничений по трафику, и у неё есть Вебвизор —
   запись сеансов: видно, как человек листал карточку, где бросил опрос,
   на каком поле оформления ушёл. Для витрины это полезнее сухих цифр.

   Пока CONFIG.metrikaId пустой, счётчик не грузится совсем: ни запроса,
   ни куки. Заполнили — заработало, без правок кода.

   ВАЖНО про этот сайт: адреса здесь меняются через #-ссылки, страница
   не перезагружается. Метрика сама такие переходы не видит и без
   sendHit засчитала бы один просмотр за весь визит — поэтому каждый
   переход отправляется вручную.
   ===================================================================== */

let metrikaReady = false;

function metrikaId(){
  const id = Number(CONFIG.metrikaId);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function initAnalytics(){
  const id = metrikaId();
  if (!id) return;

  // Официальный загрузчик Метрики. Ничего не считает до ym(...,'init').
  (function(m,e,t,r,i,k,a){
    m[i] = m[i] || function(){ (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    for (let j = 0; j < e.scripts.length; j++){
      if (e.scripts[j].src === r) return;
    }
    k = e.createElement(t); a = e.getElementsByTagName(t)[0];
    k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');

  window.ym(id, 'init', {
    // defer — не отправлять первый просмотр автоматически: адрес на этот
    // момент ещё не разобран, и в отчётах был бы «/» вместо раздела.
    // Первый hit шлём сами, из sendHit после applyRoute.
    defer: true,
    clickmap: true,          // карта кликов
    trackLinks: true,        // клики по внешним ссылкам (YouTube, Telegram)
    accurateTrackBounce: true, // отказ считать только если человек ушёл сразу
    webvisor: true           // запись сеансов
  });
  metrikaReady = true;
}

// Просмотр раздела. Вызывается на каждом переходе, включая самый первый.
function sendHit(){
  const id = metrikaId();
  if (!id || !window.ym) return;
  try{
    window.ym(id, 'hit', location.href, { title: document.title });
  }catch(e){ /* аналитика никогда не должна мешать сайту */ }
}

/* Цель — то, ради чего аналитику и ставят: не «сколько зашло», а «сколько
   дошло до заказа и где отвалились остальные».

   Имена целей задаются в интерфейсе Метрики ровно этими строками:
     product_open    — открыл карточку товара
     survey_start    — начал опрос
     survey_done     — дошёл до конца опроса
     cart_add        — добавил вещь в корзину
     checkout_start  — нажал «Оформить заказ»
     order_done      — заказ оформлен (с суммой)
     episode_open    — ушёл смотреть выпуск
     share           — поделился ссылкой                                  */
function goal(name, params){
  const id = metrikaId();
  if (!id || !window.ym) return;
  try{
    window.ym(id, 'reachGoal', name, params || undefined);
  }catch(e){ /* см. выше */ }
}
