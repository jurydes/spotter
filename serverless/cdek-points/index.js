/* =====================================================================
   ПРОСЛОЙКА МЕЖДУ САЙТОМ И API СДЭК.

   Зачем она вообще нужна:
   — список ПВЗ отдаётся только по токену (api.cdek.ru/v2 без авторизации
     отвечает 401), а токен выдают по логину и паролю интеграции;
   — класть этот логин в js сайта нельзя: его видно любому посетителю;
   — у api.cdek.ru нет CORS-заголовков, браузер бы всё равно не пустил.

   Функция отвечает на два разных протокола:

   1. ?city=Москва — простой список ПВЗ для встроенного в сайт выбора
      пунктов списком. Работает без карт и без ключей Яндекса.

   2. ?action=offices|byCoordinate|calculate — протокол официального
      виджета СДЭК с картой. Это порт эталонного service.php из пакета
      @cdek-it/widget: тот же набор действий, те же параметры навылет
      в СДЭК. Виджет сверяет заголовок X-Service-Version и отказывается
      работать, если мажорная версия не совпадает с его собственной, —
      поэтому WIDGET_VERSION ниже обязан совпадать с версией файла
      js/vendor/cdek-widget.<версия>.umd.js.

   Яндекс Cloud Functions, runtime nodejs18. Переменные окружения:
     CDEK_ACCOUNT  — «Клиент» (логин) из личного кабинета СДЭК
     CDEK_PASSWORD — «Секретный ключ» оттуда же
     CDEK_API      — необязательно; https://api.edu.cdek.ru для песочницы
   ===================================================================== */

const API = (process.env.CDEK_API || 'https://api.cdek.ru') + '/v2';
const WIDGET_VERSION = '4.0.0';

// Токен живёт час, поэтому переспрашиваем его не чаще, чем раз в 50 минут.
// Тёплый контейнер переживает много запросов подряд — на каждом просить
// новый токен и невежливо, и медленно.
let tokenCache = { value: '', expires: 0 };

// Список ПВЗ города меняется раз в месяцы, а весит прилично.
// Кэш только для простого протокола: у виджета параметры куда
// разнообразнее, там кэшировать по одному городу нечего.
const CITY_TTL_MS = 24 * 60 * 60 * 1000;
const cityCache = new Map(); // 'москва' -> { at, body }

async function getToken(){
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expires) return tokenCache.value;

  const account = process.env.CDEK_ACCOUNT;
  const password = process.env.CDEK_PASSWORD;
  if (!account || !password) throw new Error('Не заданы CDEK_ACCOUNT / CDEK_PASSWORD');

  const res = await fetch(`${API}/oauth/token?parameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: account,
      client_secret: password
    })
  });
  if (!res.ok) throw new Error(`Авторизация СДЭК: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('СДЭК не вернул токен');

  tokenCache = { value: data.access_token, expires: now + 50 * 60 * 1000 };
  return tokenCache.value;
}

// Запрос к СДЭК. method — путь вида 'deliverypoints'; GET кладёт параметры
// в строку запроса, POST — телом в JSON (так считается тарифный калькулятор).
async function cdekRequest(path, params, token, asJson){
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    // СДЭК просит представляться — по этим заголовкам он отличает
    // трафик виджета от самописных интеграций.
    'X-App-Name': 'widget_pvz',
    'X-App-Version': WIDGET_VERSION
  };
  let url = `${API}/${path}`;
  const opts = { headers };

  if (asJson){
    opts.method = 'POST';
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(params);
  }else{
    const qs = new URLSearchParams();
    Object.keys(params || {}).forEach(k=>{
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    });
    const s = qs.toString();
    if (s) url += '?' + s;
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  return { status: res.status, text };
}

/* ---------------------------------------------------------------------
   ПРОСТОЙ ПРОТОКОЛ: ?city=Москва
   --------------------------------------------------------------------- */

// Название города -> код. СДЭК возвращает несколько совпадений
// («Москва», «Московский»), поэтому сначала ищем точное совпадение имени
// и только потом соглашаемся на первое из списка.
async function findCity(name, token){
  const { text } = await cdekRequest('location/cities',
    { country_codes: 'RU', size: 20, city: name }, token);
  let list;
  try{ list = JSON.parse(text); }catch(e){ list = null; }
  if (!Array.isArray(list) || !list.length) return null;
  const lower = name.trim().toLowerCase();
  return list.find(c => String(c.city || '').toLowerCase() === lower) || list[0];
}

// Сайту не нужны все сорок полей ПВЗ — отдаём то, что показываем
// в списке, плюс код: он потом едет в заказ.
function slimPoint(p){
  const loc = p.location || {};
  return {
    code: p.code,
    name: p.name,
    address: loc.address_full || loc.address || p.name,
    city: loc.city || '',
    lat: loc.latitude,
    lon: loc.longitude,
    type: p.type,                       // PVZ или POSTAMAT
    work_time: p.work_time || '',
    phone: (p.phones && p.phones[0] && p.phones[0].number) || '',
    note: p.address_comment || ''
  };
}

async function handleSimple(city, reply){
  const key = city.toLowerCase();
  const cached = cityCache.get(key);
  if (cached && Date.now() - cached.at < CITY_TTL_MS) return reply(200, cached.body);

  const token = await getToken();
  const found = await findCity(city, token);
  if (!found) return reply(200, { city, points: [] });

  const { text } = await cdekRequest('deliverypoints',
    { country_code: 'RU', city_code: found.code, type: 'ALL' }, token);
  let points;
  try{ points = JSON.parse(text); }catch(e){ points = []; }

  const body = {
    city: found.city,
    city_code: found.code,
    points: (Array.isArray(points) ? points : []).map(slimPoint)
  };
  cityCache.set(key, { at: Date.now(), body });
  return reply(200, body);
}

/* ---------------------------------------------------------------------
   ПРОТОКОЛ ВИДЖЕТА: ?action=...
   Порт service.php. Параметры не разбираем и не чистим — виджет и СДЭК
   договариваются между собой, наше дело пробросить и вернуть как есть.
   --------------------------------------------------------------------- */
const WIDGET_ACTIONS = {
  offices: { path: 'deliverypoints', json: false },
  byCoordinate: { path: 'deliverypoints/byPolygons', json: false },
  calculate: { path: 'calculator/tarifflist', json: true }
};

module.exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    // Сайт лежит на другом домене, без этого браузер не отдаст ответ странице
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Виджет читает эту версию из ответа и падает, если её не видно.
    // При кросс-доменном запросе браузер прячет все заголовки, кроме
    // разрешённых явно, — поэтому Expose-Headers здесь обязателен.
    'X-Service-Version': WIDGET_VERSION,
    'Access-Control-Expose-Headers': 'X-Service-Version, Server-Timing'
  };
  const reply = (code, body) => ({ statusCode: code, headers, body: JSON.stringify(body) });
  const raw = (code, text) => ({ statusCode: code, headers, body: text });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  // Виджет шлёт часть параметров строкой запроса, часть — телом (calculate).
  // service.php их сливает в одно, повторяем поведение.
  const params = Object.assign({}, event.queryStringParameters || {});
  if (event.body){
    try{
      const parsed = JSON.parse(
        event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
      );
      if (parsed && typeof parsed === 'object') Object.assign(params, parsed);
    }catch(e){ /* тело не JSON — для GET-действий это нормально */ }
  }

  try{
    if (params.action){
      const spec = WIDGET_ACTIONS[params.action];
      if (!spec) return reply(400, { message: 'Unknown action' });
      const token = await getToken();
      // Ответ СДЭК отдаём как есть: виджет разбирает его сам
      const { status, text } = await cdekRequest(spec.path, params, token, spec.json);
      return raw(status, text);
    }

    const city = (params.city || '').trim();
    if (!city) return reply(400, { message: 'Не указан город' });
    return await handleSimple(city, reply);
  }catch(e){
    // Подробности — в лог функции, наружу только факт: текст ошибки СДЭК
    // покупателю ничего не объяснит, а нам в логах он нужен целиком.
    console.error('cdek-points:', e);
    return reply(502, { message: 'Не удалось получить данные СДЭК' });
  }
};
