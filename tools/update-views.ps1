# =====================================================================
#  ОБНОВЛЕНИЕ ПРОСМОТРОВ
#
#  Запуск:  правой кнопкой -> "Выполнить с помощью PowerShell"
#           либо в терминале:  powershell -File tools\update-views.ps1
#
#  Что делает: берёт ключ из .env, спрашивает у YouTube API просмотры
#  всех выпусков из js/config.js и переписывает там блок EPISODE_VIEWS.
#
#  Ключ никуда не уезжает: он читается с диска, используется для одного
#  запроса и в файлы сайта не попадает. Поэтому его не нужно ограничивать
#  по домену — в отличие от варианта, когда ключ вписывают в config.js
#  и он уходит в браузер каждому посетителю.
#
#  Стоимость запроса — 1 единица квоты из 10 000 бесплатных в сутки,
#  так что запускать можно хоть каждый день.
# =====================================================================

$ErrorActionPreference = 'Stop'
$root       = Split-Path -Parent $PSScriptRoot
$envPath    = Join-Path $root '.env'
$configPath = Join-Path $root 'js\config.js'

function Fail($text){ Write-Host $text -ForegroundColor Red; exit 1 }

if (-not (Test-Path $envPath))    { Fail "Не найден файл .env рядом с сайтом: $envPath" }
if (-not (Test-Path $configPath)) { Fail "Не найден js/config.js: $configPath" }

# --- ключ ---
$envText = [System.IO.File]::ReadAllText($envPath, [System.Text.Encoding]::UTF8)
$key = ([regex]::Match($envText, 'youtubeApiKey\s*=\s*"?([^"\r\n]+)"?')).Groups[1].Value.Trim()
if (-not $key) { Fail "В .env нет строки youtubeApiKey=..." }

# --- идентификаторы роликов берём из самого конфига,
#     чтобы новые выпуски подхватывались без правки скрипта ---
$config = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
$ids = [regex]::Matches($config, 'youtubeUrl:\s*''https://www\.youtube\.com/watch\?v=([\w-]{11})') |
       ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
if ($ids.Count -eq 0) { Fail "В config.js не нашлось ни одной ссылки на YouTube" }
Write-Host "Выпусков в конфиге: $($ids.Count)"

# --- запрос (API принимает до 50 идентификаторов за раз) ---
$views = @{}
for ($i = 0; $i -lt $ids.Count; $i += 50) {
  $chunk = $ids[$i..([Math]::Min($i+49, $ids.Count-1))] -join ','
  $url = "https://www.googleapis.com/youtube/v3/videos?part=statistics&id=$chunk&key=$key"
  try {
    $resp = Invoke-RestMethod $url -TimeoutSec 60
  } catch {
    # в тексте ошибки может оказаться ключ — вырезаем перед показом
    $msg = $_.Exception.Message
    if ($_.ErrorDetails.Message) { $msg = $_.ErrorDetails.Message }
    Fail ("Запрос к YouTube не прошёл: " + ($msg -replace [regex]::Escape($key), '<КЛЮЧ>'))
  }
  foreach ($item in $resp.items) {
    $n = 0
    if ([int]::TryParse($item.statistics.viewCount, [ref]$n)) { $views[$item.id] = $n }
  }
}
if ($views.Count -eq 0) { Fail "API ответил, но просмотров не вернул" }

$missing = $ids | Where-Object { -not $views.ContainsKey($_) }
if ($missing) { Write-Host ("Не ответили (ролик удалён или скрыт): " + ($missing -join ', ')) -ForegroundColor Yellow }

# --- собираем новый блок, сохраняя подписи вида // гл.2 ep.07 ---
$oldBlock = [regex]::Match($config, '(?s)const EPISODE_VIEWS = \{.*?\};')
if (-not $oldBlock.Success) { Fail "В config.js не найден блок EPISODE_VIEWS" }

$comments = @{}
foreach ($m in [regex]::Matches($oldBlock.Value, "'([\w-]{11})'\s*:\s*\d+\s*,?\s*(//[^\r\n]*)?")) {
  if ($m.Groups[2].Success) { $comments[$m.Groups[1].Value] = $m.Groups[2].Value.Trim() }
}

$lines = @()
$ordered = $ids | Where-Object { $views.ContainsKey($_) }
for ($i = 0; $i -lt $ordered.Count; $i++) {
  $id = $ordered[$i]
  $comma = if ($i -lt $ordered.Count - 1) { ',' } else { '' }
  $line = "  '$id': $($views[$id])$comma"
  if ($comments.ContainsKey($id)) { $line = $line.PadRight(28) + ' ' + $comments[$id] }
  $lines += $line
}
$newBlock = "const EPISODE_VIEWS = {`r`n" + ($lines -join "`r`n") + "`r`n};"

$updated = $config.Remove($oldBlock.Index, $oldBlock.Length).Insert($oldBlock.Index, $newBlock)
$updated = [regex]::Replace($updated, 'Обновлён: \d{2}\.\d{2}\.\d{4}', ('Обновлён: ' + (Get-Date -Format 'dd.MM.yyyy')))

# без BOM — иначе он попадёт в начало JS-файла
[System.IO.File]::WriteAllText($configPath, $updated, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "`nГотово. Обновлено выпусков: $($views.Count)" -ForegroundColor Green
$ordered | ForEach-Object { "  {0}  {1,9:N0}" -f $_, $views[$_] }
