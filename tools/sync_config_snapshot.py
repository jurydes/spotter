#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Переписывает запасную копию витрины (merch в js/config.js) из data/merch.json.

Зачем. Сайт берёт товары из data/merch.json, а копия в config.js
показывается, только если этот файл не пришёл: хостинг сбоит, нет сети,
страницу открыли без сервера. Копию правили руками и однажды забыли:
футболки в ней остались выключенными со времён, когда продавали одно худи.
При сбое хостинга сайт показал витрину из одного худи со старыми фото.

Запуск после правок мерча:  py -3.12 tools/sync_config_snapshot.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, 'js', 'config.js')
DATA = os.path.join(ROOT, 'data', 'merch.json')
EVENT = os.path.join(ROOT, 'data', 'event.json')

# Порядок полей — как читать глазами: что за товар, потом флаги, потом фото.
ORDER = ['id', 'name', 'category', 'price', 'description', 'sizes', 'stock',
         'showStock', 'preorder', 'leadTime', 'isNew', 'popular', 'active', 'images']

COMMENT = '''  // ЗАПАСНАЯ КОПИЯ ВИТРИНЫ. Настоящий источник — data/merch.json, его правит
  // редактор. Эта копия показывается, только если data/merch.json не пришёл:
  // хостинг сбоит, нет сети, файл открыли без сервера.
  //
  // Поэтому она обязана совпадать с настоящими данными. Однажды она отстала —
  // футболки в ней остались выключенными со времён, когда продавали одно худи,
  // — и при сбое хостинга сайт показал витрину из одного худи со старыми фото.
  // Собирается из data/merch.json скриптом, руками не правится:
  //   py -3.12 tools/sync_config_snapshot.py
'''


def js_string(s):
    return "'" + (s.replace('\\', '\\\\')
                   .replace("'", "\\'")
                   .replace('\r', '')
                   .replace('\n', '\\n')) + "'"


def lit(v, ind):
    pad = '  ' * ind
    if isinstance(v, str):
        return js_string(v)
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if v is None:
        return 'null'
    if isinstance(v, (int, float)):
        return json.dumps(v)
    if isinstance(v, list):
        flat = all(not isinstance(x, (dict, list)) for x in v)
        if flat and sum(len(lit(x, 0)) for x in v) < 60:
            return '[' + ', '.join(lit(x, 0) for x in v) + ']'
        inner = ',\n'.join(pad + '  ' + lit(x, ind + 1) for x in v)
        return '[\n' + inner + '\n' + pad + ']'
    if isinstance(v, dict):
        flat = all(not isinstance(x, (dict, list)) for x in v.values())
        if flat and len(v) <= 4:
            return '{ ' + ', '.join('{}: {}'.format(k, lit(x, 0)) for k, x in v.items()) + ' }'
        inner = ',\n'.join('{}  {}: {}'.format(pad, k, lit(x, ind + 1)) for k, x in v.items())
        return '{\n' + inner + '\n' + pad + '}'
    raise TypeError(type(v))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    with open(DATA, encoding='utf-8-sig') as f:
        merch = json.load(f)['merch']
    with open(CONFIG, encoding='utf-8') as f:
        src = f.read()

    items = []
    for p in merch:
        keys = [k for k in ORDER if k in p] + [k for k in p if k not in ORDER]
        items.append('    ' + lit({k: p[k] for k in keys}, 2))
    block = '  merch: [\n' + ',\n'.join(items) + '\n  ]'

    # Блок вместе с комментарием над ним: от первой строки комментария
    # (или самого «merch: [», если комментария нет) до закрывающей скобки.
    m = re.search(r'(?:^  //[^\n]*\n)*^  merch: \[\n.*?^  \]', src, re.S | re.M)
    if not m:
        sys.exit('ОШИБКА: в js/config.js не найден блок merch: [ ... ]')
    out = src[:m.start()] + COMMENT + block + src[m.end():]

    # Афиша: сайт держит в CONFIG.event одно событие — первое включённое,
    # ровно как выбирает loadContentData. Нет файла или включённых — null.
    event = None
    try:
        with open(EVENT, encoding='utf-8-sig') as f:
            event = next((e for e in json.load(f).get('event') or []
                          if e and e.get('active')), None)
    except (OSError, ValueError):
        event = None
    if event and not event.get('endsAt'):
        sys.exit('ОШИБКА: у включённого события нет endsAt — без него копия '
                 'афиши провисела бы на главной и после концерта')
    ev_lit = lit(event, 1) if event else 'null'
    out, n = re.subn(r'^  event: (?:null|\{\n.*?^  \}),$', lambda _: '  event: ' + ev_lit + ',',
                     out, count=1, flags=re.S | re.M)
    if n != 1:
        sys.exit('ОШИБКА: в js/config.js не найдено поле event')

    with open(CONFIG, 'w', encoding='utf-8', newline='\n') as f:
        f.write(out)
    print('Копия витрины обновлена: {} товаров'.format(len(merch)))
    for p in merch:
        print('  {:28} active={!s:5} фото: {}'.format(
            p['id'], p.get('active'), len(p.get('images') or [])))
    print('Копия афиши: {}'.format(
        '{} · {} (до {})'.format(event.get('title'), event.get('date'), event['endsAt'])
        if event else 'нет события'))


if __name__ == '__main__':
    main()
