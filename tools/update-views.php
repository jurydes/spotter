<?php
/* =====================================================================
   ОБНОВЛЕНИЕ ПРОСМОТРОВ НА ОБЫЧНОМ ХОСТИНГЕ (Timeweb, Beget, reg.ru)

   То же, что update-views.sh, но на PHP — потому что на shared-хостинге
   обычно нет ни ssh, ни python3, зато есть PHP и планировщик заданий
   в панели управления.

   Установка:
     1. положить рядом с сайтом .env со строкой youtubeApiKey=ВАШ_КЛЮЧ
     2. в панели хостинга завести cron-задание раз в час:
          php /home/логин/сайт/tools/update-views.php
        (точную команду подскажет хостинг, обычно там есть шаблон «PHP-скрипт»)

   ВАЖНО: файл .env должен лежать ВЫШЕ папки сайта либо быть закрыт
   от скачивания — иначе ключ можно будет забрать по адресу
   https://сайт/.env. Проверьте это сразу после установки.
   ===================================================================== */

$root    = dirname(__DIR__);
$envFile = $root . '/.env';
$config  = $root . '/js/config.js';
$outFile = $root . '/assets/views.json';

function fail($text) { fwrite(STDERR, $text . PHP_EOL); exit(1); }

if (!is_file($envFile)) fail("Нет файла .env рядом с сайтом: $envFile");
if (!is_file($config))  fail("Нет js/config.js: $config");

// --- ключ ---
$env = file_get_contents($envFile);
if (!preg_match('/^\s*youtubeApiKey\s*=\s*"?([^"\r\n]+)"?/m', $env, $m)) {
    fail("В .env нет строки youtubeApiKey=...");
}
$key = trim($m[1]);

/* --- идентификаторы роликов ---
   Сначала data/episodes.json — тот же файл, который правит редактор.
   js/config.js только запасной снимок: выпуск, заведённый через
   редактор, в него не попадает, и просмотры по нему не собирались.
   Формы ссылки — все, включая короткую youtu.be/… от кнопки
   «Поделиться». Тот же разбор в tools/video_ids.py и в js/app.js. */
$patterns = ['/[?&]v=([A-Za-z0-9_-]{11})/', '/youtu\.be\/([A-Za-z0-9_-]{11})/',
             '/\/shorts\/([A-Za-z0-9_-]{11})/', '/\/embed\/([A-Za-z0-9_-]{11})/',
             '/\/live\/([A-Za-z0-9_-]{11})/'];
function videoId($url, $patterns) {
    foreach ($patterns as $re) {
        if (preg_match($re, (string)$url, $m)) return $m[1];
    }
    return null;
}

$ids = [];
$live = $root . '/data/episodes.json';
if (is_file($live)) {
    $data = json_decode(file_get_contents($live), true);
    foreach (($data['episodes'] ?? []) as $ep) {
        $id = videoId($ep['youtubeUrl'] ?? '', $patterns);
        if ($id) $ids[] = $id;
    }
}
if (!$ids) {
    $text = file_get_contents($config);
    foreach ($patterns as $re) {
        preg_match_all($re, $text, $m);
        $ids = array_merge($ids, $m[1]);
    }
}
$ids = array_values(array_unique($ids));
if (!$ids) fail("Не нашлось ссылок на YouTube");

// --- запрос (API принимает до 50 идентификаторов за раз) ---
$views = [];
foreach (array_chunk($ids, 50) as $chunk) {
    $url = 'https://www.googleapis.com/youtube/v3/videos?part=statistics'
         . '&id=' . implode(',', $chunk)
         . '&key=' . urlencode($key);

    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $body = curl_exec($ch);
    if ($body === false) fail("Запрос к YouTube не прошёл: " . curl_error($ch));
    curl_close($ch);

    $data = json_decode($body, true);
    if (isset($data['error'])) fail("YouTube вернул ошибку: " . ($data['error']['message'] ?? '?'));

    foreach ($data['items'] ?? [] as $item) {
        if (isset($item['id'], $item['statistics']['viewCount'])) {
            $views[$item['id']] = (int) $item['statistics']['viewCount'];
        }
    }
}
if (!$views) fail("Просмотры не получены");

// Пишем во временный файл и подменяем одним движением: если скрипт упадёт
// на середине, посетитель не увидит обрезанный JSON.
$payload = json_encode(
    ['updated' => gmdate('c'), 'views' => $views],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
);
$tmp = $outFile . '.tmp';
if (file_put_contents($tmp, $payload) === false) fail("Не удалось записать $tmp");
if (!rename($tmp, $outFile)) fail("Не удалось заменить $outFile");

echo "Обновлено выпусков: " . count($views) . PHP_EOL;
echo "Записано: $outFile" . PHP_EOL;
