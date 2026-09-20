/* =====================================================================
   ПРИЁМНИК ОТВЕТОВ ОПРОСА И ЗАКАЗОВ -> GOOGLE-ТАБЛИЦА.

   Ставится как веб-приложение Google Apps Script (инструкция в README.md
   рядом). Сайт шлёт сюда POST с JSON, скрипт дописывает строку.

   Строка одна на человека: сначала её создают ответы опроса, потом,
   если человек оформил заказ, в ту же строку дописываются ФИО, телефон,
   пункт выдачи и состав. Сходятся по id, который сайт кладёт в оба
   сообщения. Заказ без опроса просто заведёт строку без ответов.
   ===================================================================== */

var SHEET_NAME = 'Ответы';

// Колонки заказа идут после ответов. Вопросов в опросе восемь, но их
// число может поменяться, поэтому заголовки строятся динамически,
// а эти — всегда добавляются справа.
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

function doPost(e) {
  var lock = LockService.getScriptLock();
  // Две вкладки, оформляющие заказ одновременно, иначе могут записать
  // в одну и ту же строку и затереть друг друга.
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_();
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

// Открыть страницу скрипта в браузере — быстрый способ убедиться,
// что веб-приложение вообще опубликовано и доступно.
function doGet() {
  return json_({ ok: true, hint: 'Приёмник опросов SPOTTER работает' });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

function headers_(sheet) {
  if (sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

// Заголовки создаются по первому пришедшему опросу: тексты вопросов
// берутся прямо из него. Поменяются вопросы на сайте — заведите новую
// таблицу, иначе старые и новые ответы окажутся в одних колонках.
function ensureHeaders_(sheet, questions) {
  if (sheet.getLastRow() > 0) return headers_(sheet);
  var row = ['Дата', 'ID', 'Товар'].concat(questions).concat(ORDER_COLUMNS);
  sheet.getRange(1, 1, 1, row.length).setValues([row]);
  sheet.getRange(1, 1, 1, row.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return row;
}

function findRowById_(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return 0;
  var ids = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

function writeSurvey_(sheet, data) {
  var answers = data.answers || [];
  var questions = answers.map(function (a) { return a.q; });
  ensureHeaders_(sheet, questions);

  var row = [new Date(), data.id || '', data.product || ''];
  answers.forEach(function (a) { row.push(a.a || ''); });
  sheet.appendRow(row);
}

function writeOrder_(sheet, data) {
  var head = headers_(sheet);
  if (!head.length) {
    // Заказ пришёл раньше любого опроса — заводим заголовки без вопросов
    head = ensureHeaders_(sheet, []);
  }
  var startCol = head.length - ORDER_COLUMNS.length + 1;
  var values = [
    new Date(),
    data.name || '',
    data.phone || '',
    data.delivery || '',
    data.destination || '',
    data.items || '',
    data.total || '',
    data.discount || '',
    data.comment || ''
  ];

  var row = findRowById_(sheet, data.id);
  if (!row) {
    // Заказ без опроса: заводим строку, колонки ответов остаются пустыми
    sheet.appendRow([new Date(), data.id || '', '']);
    row = sheet.getLastRow();
  }
  sheet.getRange(row, startCol, 1, values.length).setValues([values]);
}
