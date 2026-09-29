#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Идентификаторы роликов всех выпусков — одним списком через запятую.

Зачем отдельным файлом: этот разбор нужен и update-views.sh, и вручную
при проверке, а держать две копии регулярок — верный способ однажды
получить ровно то, из-за чего файл и появился.

Две вещи, на которых раньше спотыкались:

1. Список брался из js/config.js. Это запасной снимок, зашитый в код,
   а выпуски давно правятся из редактора и живут в data/episodes.json.
   Восьмого выпуска CHAPTER II в снимке не было вообще, и YouTube про
   него просто не спрашивали. Теперь читаем живой файл, а снимок
   остаётся запасным вариантом.

2. Ссылка разбиралась только в виде watch?v=. А кнопка «Поделиться»
   в самом YouTube даёт короткую: youtu.be/bAYyKvqwrO8?si=... Такая
   ссылка не подходила под шаблон, и выпуск выпадал молча.

Запуск: python3 tools/video_ids.py [корень сайта]
"""

import json
import os
import re
import sys

# Все формы, которыми YouTube отдаёт ссылку на один и тот же ролик.
# Хвост ?si=... и прочие метки отбрасываются сами: идентификатор — ровно
# 11 символов, дальше шаблон не смотрит.
PATTERNS = [
    re.compile(r'[?&]v=([A-Za-z0-9_-]{11})'),        # watch?v=ID
    re.compile(r'youtu\.be/([A-Za-z0-9_-]{11})'),    # короткая ссылка «Поделиться»
    re.compile(r'/shorts/([A-Za-z0-9_-]{11})'),      # шортс
    re.compile(r'/embed/([A-Za-z0-9_-]{11})'),       # встраиваемый плеер
    re.compile(r'/live/([A-Za-z0-9_-]{11})'),        # трансляция
]


def video_id(url):
    """Идентификатор ролика из ссылки любого вида. Не опознали — None."""
    text = str(url or '')
    for pattern in PATTERNS:
        found = pattern.search(text)
        if found:
            return found.group(1)
    return None


def collect(root):
    """Сначала живые данные, и только если их нет — снимок из кода."""
    ids, source = [], ''

    live = os.path.join(root, 'data', 'episodes.json')
    if os.path.isfile(live):
        try:
            with open(live, encoding='utf-8') as f:
                episodes = json.load(f).get('episodes') or []
            ids = [video_id(e.get('youtubeUrl')) for e in episodes]
            ids = [i for i in ids if i]
            source = 'data/episodes.json'
        except (ValueError, OSError) as e:
            print('ВНИМАНИЕ: не прочитался {} ({}), беру снимок из config.js'
                  .format(live, e), file=sys.stderr)

    if not ids:
        config = os.path.join(root, 'js', 'config.js')
        if os.path.isfile(config):
            with open(config, encoding='utf-8') as f:
                text = f.read()
            found = []
            for pattern in PATTERNS:
                found += pattern.findall(text)
            ids = found
            source = 'js/config.js (запасной снимок)'

    # Порядок сохраняем, повторы убираем: один ролик мог попасть
    # и в выпуск, и в текст конфига.
    seen, unique = set(), []
    for i in ids:
        if i not in seen:
            seen.add(i)
            unique.append(i)
    return unique, source


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    ids, source = collect(root)
    if not ids:
        print('Не нашлось ни одной ссылки на YouTube', file=sys.stderr)
        return 1
    print('Роликов найдено: {} (источник: {})'.format(len(ids), source), file=sys.stderr)
    sys.stdout.write(','.join(ids))
    return 0


if __name__ == '__main__':
    sys.exit(main())
