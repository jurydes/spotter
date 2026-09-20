/* =====================================================================
   ПУНКТЫ ВЫДАЧИ СДЭК — прослойка между сайтом и api.cdek.ru.

   Зачем она вообще нужна:
   — список ПВЗ отдаётся только по токену (api.cdek.ru/v2 без авторизации
     отвечает 401), а токен выдают по логину и паролю интеграции;
   — класть этот логин в js сайта нельзя: его видно любому посетителю;
   — у api.cdek.ru нет CORS-заголовков, браузер бы всё равно не пустил.

   Что делает: получает ?city=Москва, находит код города, забирает ПВЗ,
   отдаёт сайту короткий JSON. Токен и списки держит в памяти между
   вызовами, чтобы не ходить в СДЭК на каждый чих.

   Яндекс Cloud Functions, runtime nodejs18. Переменные окружения:
     CDEK_ACCOUNT  — «Клиент» (логин) из личного кабинета СДЭК
     CDEK_PASSWORD — «Секретный ключ» оттуда же
     CDEK_API      — необязательно; https://api.edu.cdek.ru для песочницы
   ===================================================================== */

const API = process.env.CDEK_API || 'https://api.cdek.ru';

// Токен живёт час, поэтому переспрашиваем его не чаще, чем раз в 50 минут.
// Тёплый контейнер переживает много запросов подряд — на каждом просить
// новый токен и невежливо, и медленно.
let tokenCache = { value: '', expires: 0 };

// Список ПВЗ города меняется раз в месяцы, а весит прилично.
// Держим сутки: этого хватает, чтобы почти все запросы обслуживались
// вообще без обращения к СДЭК.
const CITY_TTL_MS = 24 * 60 * 60 * 1000;
const cityCache = new Map(); // 'москва' -> { at, body }

async function getToken(){
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expires) return tokenCache.value;

  const account = process.env.CDEK_ACCOUNT;
  const password = process.env.CDEK_PASSWORD;
  if (!account || !password) throw new Error('Не заданы CDEK_ACCOUNT / CDEK_PASSWORD');

  const res = await fetch(`${API}/v2/oauth/token?parameters`, {
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

async function cdekGet(path, token){
  const res = await fetch(`${API}/v2/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`СДЭК ${path}: ${res.status}`);
  return res.json();
}

// Название города -> код. СДЭК возвращает несколько совпадений
// («Москва», «Московский»), поэтому сначала ищем точное совпадение имени
// и только потом соглашаемся на первое из списка.
async function findCity(name, token){
  const list = await cdekGet(
    `location/cities?country_codes=RU&size=20&city=${encodeURIComponent(name)}`,
    token
  );
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

module.exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    // Запрос уходит с сайта, который лежит на другом домене, — без этого
    // браузер не отдаст ответ странице.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  const reply = (code, body) => ({ statusCode: code, headers, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const params = event.queryStringParameters || {};
  const city = (params.city || '').trim();
  if (!city) return reply(400, { error: 'Не указан город' });

  const key = city.toLowerCase();
  const cached = cityCache.get(key);
  if (cached && Date.now() - cached.at < CITY_TTL_MS){
    return reply(200, cached.body);
  }

  try{
    const token = await getToken();
    const found = await findCity(city, token);
    if (!found) return reply(200, { city, points: [] });

    const points = await cdekGet(
      `deliverypoints?country_code=RU&city_code=${found.code}&type=ALL`,
      token
    );
    const body = {
      city: found.city,
      city_code: found.code,
      points: (Array.isArray(points) ? points : []).map(slimPoint)
    };
    cityCache.set(key, { at: Date.now(), body });
    return reply(200, body);
  }catch(e){
    // Подробности — в лог функции, наружу только факт: текст ошибки СДЭК
    // покупателю ничего не объяснит, а нам в логах он нужен целиком.
    console.error('cdek-points:', e);
    return reply(502, { error: 'Не удалось получить список ПВЗ' });
  }
};
