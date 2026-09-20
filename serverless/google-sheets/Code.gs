/* =====================================================================
   ПРИЁМНИК ОТВЕТОВ ОПРОСА И ЗАКАЗОВ -> GOOGLE-ТАБЛИЦА.

   Ставится как веб-приложение Google Apps Script (инструкция в README.md
   рядом). Сайт шлёт сюда POST с JSON, скрипт дописывает строку.

   Строка одна на человека: ответы опроса и оформленный заказ сходятся
   по id, который сайт кладёт в оба сообщения. Прийти они могут в любом
   порядке и с любым разрывом во времени — кто пришёл первым, тот и
   заводит строку, второй дописывает недостающее в неё же.

   Отсюда и раскладка колонок: слева всё, что известно заранее (дата,
   id, товар, поля заказа), справа — ответы, которых может стать больше
   или меньше при смене вопросов. Так позиции колонок заказа не зависят
   от того, сколько в опросе вопросов и дошёл ли опрос вообще.
   ===================================================================== */

var SHEET_NAME = 'Ответы';

// Лист резерва: по строке на каждую заказанную позицию. Сделан отдельным
// и открытым, а не скрытым счётчиком, ровно для одного действия: если
// покупатель пропал и не оплатил, в колонке «Отменён» ставится что угодно,
// и вещь тут же возвращается в продажу. Без этого неоплаченные заказы
// навсегда съедали бы тираж, и витрина показывала бы «разобрали», когда
// на самом деле не продано ничего.
var RESERVE_SHEET = 'Резерв';
var RESERVE_COLUMNS = ['Номер заказа', 'Дата', 'ID товара', 'Товар', 'Размер', 'Кол-во', 'Отменён'];

// Куда уходит письмо о новом заказе. Адрес держим здесь, а не в конфиге
// сайта: js/config.js открыт любому посетителю, и почта из него уехала бы
// в спам-базы. Пустая строка — письма не шлются, заказ только пишется
// в таблицу. Несколько адресов — через запятую.
var ORDER_EMAIL = 'altunin.04@gmail.com';

// Левая, неизменная часть таблицы. Позиции этих колонок жёсткие:
// заказ пишется в них, ничего не зная про вопросы.
var BASE_COLUMNS = ['Дата', 'ID', 'Товар'];
var ORDER_COLUMNS = [
  'Номер заказа',
  'Заказ оформлен',
  'ФИО',
  'Телефон',
  'Telegram',
  'Получение',
  'Куда',
  'Состав заказа',
  'Сумма',
  'Скидка',
  'Комментарий'
];
var FIXED_COLUMNS = BASE_COLUMNS.concat(ORDER_COLUMNS);

function doPost(e) {
  var lock = LockService.getScriptLock();
  // Без замка два одновременных запроса могут оба не найти строку по id
  // и завести её дважды — ровно та гонка, из-за которой раскладка
  // и переделывалась.
  lock.waitLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = ensureSheet_();
    if (data.type === 'order') {
      return json_(writeOrder_(sheet, data));
    }
    writeSurvey_(sheet, data);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ?stock=1 — сколько уже зарезервировано; этим сайт уменьшает остатки.
// Без параметров — просто признак жизни: открыть адрес в браузере и
// убедиться, что веб-приложение опубликовано и доступно без входа.
function doGet(e) {
  if (e && e.parameter && e.parameter.stock) {
    return json_({ ok: true, reserved: reservedMap_() });
  }
  return json_({ ok: true, hint: 'Приёмник опросов SPOTTER работает' });
}

/* ---------------------------------------------------------------------
   РЕЗЕРВ
   --------------------------------------------------------------------- */
function reserveSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(RESERVE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RESERVE_SHEET);
    sheet.getRange(1, 1, 1, RESERVE_COLUMNS.length).setValues([RESERVE_COLUMNS]);
    sheet.getRange(1, 1, 1, RESERVE_COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Сколько занято по каждому товару и размеру. Ключ — 'id|размер'.
// Строки с непустым «Отменён» не считаем: это и есть способ вернуть
// вещь в продажу, не разбираясь в коде.
function reservedMap_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('reserved');
  if (hit) return JSON.parse(hit);

  var sheet = reserveSheet_();
  var out = {};
  if (sheet.getLastRow() > 1) {
    var rows = sheet.getRange(2, 3, sheet.getLastRow() - 1, 5).getValues(); // ID..Отменён
    rows.forEach(function (r) {
      var id = String(r[0] || '').trim();
      var size = String(r[2] || '').trim();
      var qty = Number(r[3]) || 0;
      var cancelled = String(r[4] || '').trim();
      if (!id || !size || cancelled) return;
      var key = id + '|' + size;
      out[key] = (out[key] || 0) + qty;
    });
  }
  // Минута — компромисс: витрину лишний раз не дёргаем, но «разобрали»
  // появляется почти сразу. Перед самим заказом остаток всё равно
  // пересчитывается заново, без кэша.
  cache.put('reserved', JSON.stringify(out), 60);
  return out;
}

function dropReservedCache_() {
  CacheService.getScriptCache().remove('reserved');
}

function addReserve_(sheet, number, items) {
  var now = new Date();
  var rows = items.map(function (it) {
    return [number, now, it.id || '', it.name || '', it.size || '', Number(it.qty) || 1, ''];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, RESERVE_COLUMNS.length).setValues(rows);
  dropReservedCache_();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------------
   ЛИСТ И ЗАГОЛОВКИ
   --------------------------------------------------------------------- */
function headers_(sheet) {
  if (sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function writeFixedHeaders_(sheet) {
  sheet.getRange(1, 1, 1, FIXED_COLUMNS.length).setValues([FIXED_COLUMNS]);
  sheet.getRange(1, 1, 1, FIXED_COLUMNS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function ensureSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    writeFixedHeaders_(sheet);
    return sheet;
  }
  // Лист от прошлой версии скрипта с другой раскладкой колонок: дописывать
  // в него нельзя — данные лягут не в те столбцы. Уводим старое в сторону
  // и начинаем чистый лист, чтобы это не требовало ручной уборки.
  var head = headers_(sheet);
  for (var i = 0; i < FIXED_COLUMNS.length; i++) {
    if (head[i] !== FIXED_COLUMNS[i]) {
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM HH:mm');
      sheet.setName(SHEET_NAME + ' (старое ' + stamp + ')');
      sheet = ss.insertSheet(SHEET_NAME);
      writeFixedHeaders_(sheet);
      break;
    }
  }
  return sheet;
}

// Колонка вопроса по его тексту. Нет такой — заводим новую справа.
// Привязка по тексту, а не по номеру: так добавленный в середину опроса
// вопрос не сдвинет все ответы на колонку вбок.
function questionColumn_(sheet, question) {
  var head = headers_(sheet);
  for (var i = FIXED_COLUMNS.length; i < head.length; i++) {
    if (head[i] === question) return i + 1;
  }
  var col = Math.max(head.length, FIXED_COLUMNS.length) + 1;
  sheet.getRange(1, col).setValue(question).setFontWeight('bold');
  return col;
}

/* ---------------------------------------------------------------------
   СТРОКИ
   --------------------------------------------------------------------- */
// Строка этого человека: найденная по id или новая. Именно здесь
// сходятся опрос и заказ, пришедшие порознь.
function rowFor_(sheet, id) {
  if (sheet.getLastRow() > 1 && id) {
    var ids = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) return i + 2;
    }
  }
  sheet.appendRow([new Date(), id || '']);
  return sheet.getLastRow();
}

function writeSurvey_(sheet, data) {
  var row = rowFor_(sheet, data.id);
  if (data.product) sheet.getRange(row, 3).setValue(data.product);
  (data.answers || []).forEach(function (a) {
    if (!a || !a.q) return;
    sheet.getRange(row, questionColumn_(sheet, a.q)).setValue(a.a || '');
  });
}

/* ---------------------------------------------------------------------
   НУМЕРАЦИЯ.

   Счётчики живут в свойствах скрипта, а не в таблице: их читают и пишут
   под тем же замком, что и строки, поэтому два одновременных заказа
   не получат один номер. В таблице номер был бы уязвим — достаточно
   кому-то отсортировать или вставить строку.

   Выдаём сразу диапазон: заказ на три худи забирает три номера за один
   раз. Номера закрепляются в момент оформления, так что отменённый
   заказ оставляет в нумерации дыру — это цена того, что покупатель
   узнаёт свой номер сразу, а не через день.
   --------------------------------------------------------------------- */
function takeNumbers_(key, count) {
  var props = PropertiesService.getScriptProperties();
  var used = Number(props.getProperty(key) || 0);
  var first = used + 1;
  props.setProperty(key, String(used + count));
  var out = [];
  for (var i = 0; i < count; i++) out.push(first + i);
  return out;
}

/**
 * Отправить себе тестовое письмо. Запускается ВРУЧНУЮ из редактора:
 * выбрать sendTestEmail в списке функций сверху → «Выполнить».
 *
 * Нужна из-за того, что отправка почты — новое разрешение, а веб-приложение
 * его само не попросит: сайт дергает скрипт без участия человека, показать
 * окно согласия там некому, и MailApp просто молча падает (в ответе сайту
 * видно mailed: false). Разрешение Google спрашивает только тогда, когда
 * функцию запускают руками из редактора — этим и пользуемся.
 *
 * Если письмо пришло на ORDER_EMAIL — заказы тоже будут приходить.
 */
function sendTestEmail() {
  MailApp.sendEmail({
    to: ORDER_EMAIL,
    subject: 'SPOTTER: проверка отправки заказов',
    body: 'Это тестовое письмо.\n\n' +
          'Если оно пришло — уведомления о заказах настроены и будут приходить сюда же.\n' +
          'Осталось писем сегодня: ' + MailApp.getRemainingDailyQuota()
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('Письмо отправлено на ' + ORDER_EMAIL);
}

/**
 * Сбросить нумерацию в ноль. Запускается ВРУЧНУЮ из редактора
 * (выбрать resetCounters в списке функций → «Выполнить») — сайт её
 * не вызывает и вызвать не может.
 *
 * Нужна ровно один раз: после тестовых прогонов, перед настоящим
 * стартом продаж. Иначе первый живой покупатель получит SP-0002
 * и вещь с номером 3.
 *
 * Строки в таблице она не трогает — их удалите руками.
 */
function resetCounters() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  SpreadsheetApp.getActiveSpreadsheet().toast('Нумерация сброшена: следующий заказ — SP-0001');
}

function orderNumber_() {
  var n = takeNumbers_('orderSeq', 1)[0];
  return 'SP-' + ('0000' + n).slice(-4);
}

function writeOrder_(sheet, data) {
  var row = rowFor_(sheet, data.id);

  // Номер заказа выдаём один раз: повторный запрос с тем же id (человек
  // нажал «оформить» дважды, не дошло подтверждение) должен вернуть
  // тот же номер, а не занять новый.
  var numCell = sheet.getRange(row, BASE_COLUMNS.length + 1);
  var existing = String(numCell.getValue() || '');
  if (existing) {
    return { ok: true, order: existing, units: [], repeat: true, reserved: reservedMap_() };
  }

  var items = data.items || [];

  // Проверка тиража. Считаем заново, без кэша: между открытием страницы
  // и нажатием «оформить» могли пройти минуты, и размер мог разобрать
  // кто-то другой. Лимит присылает сайт — он и знает настроенный в админке
  // тираж; скрипту его взять неоткуда.
  dropReservedCache_();
  var reserved = reservedMap_();
  var oversold = [];
  items.forEach(function (it) {
    var limit = Number(it.limit);
    if (!limit && limit !== 0) return; // лимит не прислали — не мешаем заказу
    var key = (it.id || '') + '|' + (it.size || '');
    var left = limit - (reserved[key] || 0);
    if ((Number(it.qty) || 1) > left) {
      oversold.push({ id: it.id, name: it.name, size: it.size, left: Math.max(left, 0) });
    }
  });
  // Номер не выдаём и ничего не пишем: заказ не состоялся, и дыра
  // в нумерации из-за него не нужна.
  if (oversold.length) {
    return { ok: false, oversold: oversold, reserved: reserved };
  }

  var number = orderNumber_();
  var units = [];
  var lines = [];
  items.forEach(function (it) {
    var qty = Number(it.qty) || 1;
    // Свой счётчик на каждый товар: худи нумеруются отдельно от футболок
    var nums = takeNumbers_('unit:' + (it.id || 'item'), qty);
    units.push({ id: it.id, size: it.size, numbers: nums });
    lines.push((it.name || it.id) + ' / ' + it.size + ' / ' + qty + ' шт. / №' + nums.join(', №'));
  });

  var start = BASE_COLUMNS.length + 1;
  sheet.getRange(row, start, 1, ORDER_COLUMNS.length).setValues([[
    number,
    new Date(),
    data.name || '',
    data.phone || '',
    data.telegram || '',
    data.delivery || '',
    data.destination || '',
    lines.join('; '),
    data.total || '',
    data.discount || '',
    data.comment || ''
  ]]);

  // Письмо — единственное, что доносит заказ до человека: сайт больше
  // никуда его не отправляет. Если почта отвалится, заказ всё равно уже
  // записан в таблицу, поэтому валить из-за неё весь запрос нельзя —
  // покупатель остался бы без номера при сохранённом заказе.
  addReserve_(reserveSheet_(), number, items);

  var mailed = false;
  try {
    mailed = mailOrder_(sheet, row, number, lines, data);
  } catch (err) {
    console.error('Письмо о заказе не ушло: ' + err);
  }

  return { ok: true, order: number, units: units, mailed: mailed, reserved: reservedMap_() };
}

function mailOrder_(sheet, row, number, lines, data) {
  if (!ORDER_EMAIL) return false;

  var body = [
    'Новый заказ с сайта SPOTTER',
    '',
    'Номер: ' + number,
    '',
    'ЧТО ЗАКАЗАНО',
    lines.join('\n'),
    '',
    'Сумма: ' + (data.total || 0) + ' руб.'
  ];
  if (data.discount) {
    body.push('Скидка за опрос: -' + data.discount + ' руб.');
    body.push('К оплате: ' + Math.max((data.total || 0) - data.discount, 0) + ' руб.');
  }
  body.push('');
  body.push('ПОКУПАТЕЛЬ');
  body.push('ФИО: ' + (data.name || ''));
  body.push('Телефон: ' + (data.phone || ''));
  body.push('Telegram: ' + (data.telegram || ''));
  body.push('Получение: ' + (data.delivery || ''));
  if (data.destination) body.push('Куда: ' + data.destination);
  if (data.comment) body.push('Комментарий: ' + data.comment);

  // Ответы опроса лежат в этой же строке — тащить их в письмо незачем,
  // проще дать ссылку прямо на строку.
  body.push('');
  body.push('Строка в таблице (там же ответы на опрос):');
  body.push(SpreadsheetApp.getActiveSpreadsheet().getUrl() +
            '#gid=' + sheet.getSheetId() + '&range=A' + row);

  MailApp.sendEmail({
    to: ORDER_EMAIL,
    subject: 'Заказ ' + number + ' — ' + (data.name || 'без имени'),
    body: body.join('\n')
  });
  return true;
}
