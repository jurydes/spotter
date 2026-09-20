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

// Левая, неизменная часть таблицы. Позиции этих колонок жёсткие:
// заказ пишется в них, ничего не зная про вопросы.
var BASE_COLUMNS = ['Дата', 'ID', 'Товар'];
var ORDER_COLUMNS = [
  'Заказ оформлен',
  'ФИО',
  'Телефон',
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
      writeOrder_(sheet, data);
    } else {
      writeSurvey_(sheet, data);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Открыть адрес скрипта в браузере — быстрый способ убедиться,
// что веб-приложение опубликовано и доступно без входа в аккаунт.
function doGet() {
  return json_({ ok: true, hint: 'Приёмник опросов SPOTTER работает' });
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

function writeOrder_(sheet, data) {
  var row = rowFor_(sheet, data.id);
  // Колонки заказа идут сразу за базовыми и всегда на одном месте
  var start = BASE_COLUMNS.length + 1;
  sheet.getRange(row, start, 1, ORDER_COLUMNS.length).setValues([[
    new Date(),
    data.name || '',
    data.phone || '',
    data.delivery || '',
    data.destination || '',
    data.items || '',
    data.total || '',
    data.discount || '',
    data.comment || ''
  ]]);
}
