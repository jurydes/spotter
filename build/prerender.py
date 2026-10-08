#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ПРЕДРЕНДЕР ДЛЯ ПОИСКОВИКОВ.

Зачем. Сайт рисует всё содержимое джаваскриптом, а в исходном html блок
<main> пустой. Робот, который js не исполняет (а Яндекс исполняет его
только по отдельной просьбе и в бете), видел 231 символ: меню, «Корзина»,
подвал. Индексировать было нечего, и сайт не находился ни по одному
запросу. Плюс все разделы жили после решётки (#/episodes), а всё, что
после решётки, поисковик за отдельную страницу не считает — то есть
у сайта в индексе могла быть ровно одна страница вместо тридцати.

Что делает этот скрипт при каждом деплое:
  * вписывает готовый html с текстом выпусков, составов и мерча внутрь
    <main id="app"> в index.html;
  * делает отдельные страницы /episodes/, /merch/ и /episode/<слаг>/ —
    каждую со своим заголовком, описанием и canonical;
  * собирает robots.txt и sitemap.xml.

Важно: это не «другой контент для робота». Текст ровно тот же, что
рисует сайт, из тех же data/*.json. Через сотню миллисекунд js заменяет
этот блок своей версией — посетитель видит обычный сайт.

Запускается в GitHub Actions ПОСЛЕ шага, который проставляет версии в
именах css/js, — чтобы сгенерированные страницы ссылались на те же
версии файлов, что и главная.

Локально: py -3.12 build/prerender.py --dry-run
"""

import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://spotterlive.ru'

# Разделы, которые мы правда хотим видеть в поиске. Корзина, оформление
# и карточки товаров сюда не входят: это рабочие экраны, а не страницы.
STATIC_PAGES = ['episodes', 'merch']

# Порог подсветки остатка — тот же, что LOW_STOCK в js/app.js.
LOW_STOCK = 2


def read_json(rel, key):
    # utf-8-sig, а не utf-8: редакторы под Windows дописывают в начало файла
    # BOM, и json его не переваривает. У data/event.json так и вышло —
    # предрендер молча считал, что события нет, и афиша в готовый html
    # не попадала совсем. Лишние три байта терпеть дешевле, чем ловить это
    # второй раз; на файлах без BOM utf-8-sig ведёт себя как utf-8.
    path = os.path.join(ROOT, rel)
    with open(path, encoding='utf-8-sig') as f:
        data = json.load(f)
    items = data.get(key)
    if not isinstance(items, list) or not items:
        raise SystemExit('ОШИБКА: {} пустой или без ключа {}'.format(rel, key))
    return items


def read_json_optional(rel, key):
    """Для файлов, которых может не быть вовсе, — например data/event.json,
    пока концерт не объявлен. Нет файла — просто пустой список."""
    try:
        return read_json(rel, key)
    except (OSError, ValueError, SystemExit):
        return []


# --- слаги: точь-в-точь как в js/app.js, иначе ссылки разъедутся ----------
TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
    'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}


def slugify(s):
    out = ''.join(TRANSLIT.get(ch, ch) for ch in str(s).lower())
    out = re.sub(r'[^a-z0-9]+', '-', out)
    return out.strip('-')


def episode_slug(ep):
    if ep.get('standalone') or ep.get('chapter') is None:
        return slugify(ep.get('title', ''))
    return 'ch{}-ep{:02d}'.format(ep['chapter'], int(ep.get('number') or 0))


def to_roman(n):
    out, table = '', [(10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]
    for value, letter in table:
        while n >= value:
            out += letter
            n -= value
    return out or str(n)


def chapter_label(ch):
    return 'CHAPTER ' + to_roman(ch)


def esc(s):
    return (str(s or '')
            .replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", '&#39;'))


def multiline(s):
    """Переводы строк — как multilineText() на сайте."""
    text = esc(str(s or '').strip())
    text = re.sub(r'(\r?\n){2,}', '</p><p>', text)
    return text.replace('\n', '<br>')


# --- тексты из config.js -------------------------------------------------
# Псевдонимы и рассказ о проекте лежат в коде, а не в data/*.json. Разбираем
# их регуляркой: блоки простые, а держать их копию здесь — верный способ
# однажды разойтись с сайтом. Не разобралось — работаем без них: на
# индексацию выпусков и мерча это не влияет, поэтому валить деплой нельзя.
def read_config_bits():
    aliases, about, quote = {}, [], ''
    try:
        with open(os.path.join(ROOT, 'js', 'config.js'), encoding='utf-8') as f:
            src = f.read()
    except OSError as e:
        print('ВНИМАНИЕ: не прочитался config.js ({}), текст о проекте пропущен'.format(e))
        return aliases, about, quote

    block = re.search(r'ARTIST_ALIASES\s*=\s*\{(.*?)\n\};', src, re.S)
    if block:
        for key, value in re.findall(r"'([^']+)'\s*:\s*'([^']*)'", block.group(1)):
            aliases[key] = value
    else:
        print('ВНИМАНИЕ: ARTIST_ALIASES не разобрался — имена пойдут как есть')

    block = re.search(r'aboutParagraphs\s*:\s*\[(.*?)\n\s*\],', src, re.S)
    if block:
        for chunk in re.findall(r'`([^`]*)`', block.group(1)):
            about.append(re.sub(r'\s+', ' ', chunk).strip())
    else:
        print('ВНИМАНИЕ: aboutParagraphs не разобрался — блок «О проекте» пропущен')

    block = re.search(r'aboutQuote\s*:\s*`([^`]*)`', src)
    if block:
        quote = re.sub(r'\s+', ' ', block.group(1)).strip()
    return aliases, about, quote


# --- сборка блоков -------------------------------------------------------
def lineup_html(ep, bios, aliases):
    names, seen = [], set()
    for raw in ep.get('artists') or []:
        name = aliases.get(raw, raw)
        if name not in seen:
            seen.add(name)
            names.append(name)
    with_bio = [n for n in names if bios.get(n)]
    rest = [n for n in names if not bios.get(n)]
    parts = []
    if with_bio:
        rows = ''.join(
            '<li><a class="artist-link" href="/#/artist/{}">{}</a>'
            '<span class="bio-dash">—</span>'
            '<span class="bio-text">{}</span></li>'.format(
                slugify(name), esc(name), esc(bios[name]))
            for name in with_bio)
        parts.append('<ul class="lineup-bios">{}</ul>'.format(rows))
    if rest:
        label = 'за пультом' if len(rest) == 1 and rest[0] == aliases.get(
            ep.get('dj'), ep.get('dj')) else 'также'
        links = ''.join(
            '<a class="artist-link" href="/#/artist/{}">{}</a>'.format(
                slugify(name), esc(name)) for name in rest)
        parts.append('<div class="artists lineup-rest">'
                     '<span class="lineup-rest-label">{}</span>{}</div>'.format(label, links))
    if not parts and names:
        parts.append('<div class="artists">{}</div>'.format(', '.join(esc(n) for n in names)))
    return ''.join(parts)


def episode_badge(ep):
    tag = chapter_label(ep['chapter']) if ep.get('chapter') is not None else 'ВНЕ ГЛАВ'
    if ep.get('number') is not None:
        return '{} · EP.{:02d}'.format(tag, int(ep['number']))
    return tag


def latest_episode(episodes):
    numbered = [e for e in episodes if e.get('number') is not None]
    if not numbered:
        return episodes[0]
    chapters = [e['chapter'] for e in numbered if e.get('chapter') is not None]
    if chapters:
        top = max(chapters)
        pool = [e for e in numbered if e.get('chapter') == top]
        if pool:
            return max(pool, key=lambda e: e['number'])
    return numbered[-1]


def episode_card(ep, bios, aliases):
    cover = ep.get('cover')
    photo = ('<div class="ph-photo viewfinder"><img src="/{}" alt="{}" loading="lazy"></div>'
             .format(esc(cover), esc(ep.get('title'))) if cover else '')
    watch = ('<a class="ep-watch" href="{}" rel="noopener">Смотреть на YouTube</a>'
             .format(esc(ep.get('youtubeUrl'))) if ep.get('youtubeUrl') else '')
    return (
        '<div class="ep-card">'
        '<div class="ep-cover">{photo}</div>'
        '<div class="ep-meta"><span>{badge}</span></div>'
        '<div class="ep-body"><h3><a href="/episode/{slug}/">{title}</a></h3>{desc}{lineup}'
        '<div class="ep-actions">{watch}</div></div></div>'
    ).format(photo=photo, badge=esc(episode_badge(ep)), slug=episode_slug(ep),
             title=esc(ep.get('title')),
             desc='<p>{}</p>'.format(multiline(ep['description'])) if ep.get('description') else '',
             lineup=lineup_html(ep, bios, aliases), watch=watch)


def sorted_episodes(episodes):
    """Как в архиве: главы сверху вниз, внутри главы — от большего номера."""
    def key(e):
        return (-(e.get('chapter') if e.get('chapter') is not None else -1),
                -(e.get('number') if e.get('number') is not None else -1))
    return sorted(episodes, key=key)


def stock_flag(p):
    """Та же строка наличия, что рисует сайт (stockFlagHtml в js/app.js).

    showStock — наличие по размерам: «осталось M 5 · L 9 · XL 2», разобранный
    размер остаётся зачёркнутым. editionLeft/editionTotal — общий тираж одним
    числом. Ни того, ни другого — строки нет совсем, как у футболок."""
    if p.get('showStock') is True:
        sizes = p.get('sizes') or []
        stock = p.get('stock') or {}
        nums = [(s, stock.get(s) if isinstance(stock.get(s), int) else 0) for s in sizes]
        if not nums:
            return ''
        if not any(n > 0 for _, n in nums):
            return '<div class="stock-flag stock-out">всё разобрали</div>'
        chips = ''.join(
            '<span class="ss{low}">{s}<b>{n}</b></span>'.format(
                low=' ss-low' if n <= LOW_STOCK else '', s=esc(s), n=n)
            if n > 0 else '<span class="ss ss-out">{}</span>'.format(esc(s))
            for s, n in nums)
        return ('<div class="stock-flag stock-sizes">'
                '<span class="ss-label">осталось</span>{}</div>').format(chips)
    left = p.get('editionLeft')
    total = p.get('editionTotal')
    if isinstance(left, int) and isinstance(total, int):
        return '<div class="stock-flag">осталось {} из {}</div>'.format(left, total)
    return ''


def merch_card(p):
    images = p.get('images') or []
    photo = ('<div class="ph-photo viewfinder"><img src="/{}" alt="{}" loading="lazy"></div>'
             .format(esc(images[0]), esc(p.get('name'))) if images else '')
    stock = stock_flag(p)
    lead = ('<div class="lead-time mono">{}</div>'.format(esc(str(p['leadTime']).strip()))
            if str(p.get('leadTime') or '').strip() else '')
    return (
        '<div class="merch-card">{photo}<div class="card-body">'
        '<h3>{name}</h3><div class="price">{price}&nbsp;₽</div>{stock}{lead}'
        '<p class="desc">{desc}</p></div></div>'
    ).format(photo=photo, lead=lead, name=esc(p.get('name')),
             price='{:,}'.format(int(p.get('price') or 0)).replace(',', ' '),
             stock=stock, desc=multiline(p.get('description')))


def episodes_section(episodes, bios, aliases, heading='Выпуски'):
    cards = ''.join(episode_card(e, bios, aliases) for e in sorted_episodes(episodes))
    return ('<section><div class="wrap"><div class="section-head"><h2>{}</h2></div>'
            '<div class="ep-grid">{}</div></div></section>').format(heading, cards)


def merch_section(merch, heading='Мерч'):
    # Ровно то же правило, что в visibleMerch() на сайте: скрыт только тот,
    # у кого явно active: false. Товар без поля показывается.
    shown = [p for p in merch if p.get('active') is not False]
    # И тот же порядок, что в merchOrdered(): отмеченное «Новое» и
    # «Популярное» — наверх. Иначе робот видел бы витрину в одном порядке,
    # а посетитель в другом.
    shown = ([p for p in shown if p.get('isNew')]
             + [p for p in shown if p.get('popular') and not p.get('isNew')]
             + [p for p in shown if not p.get('isNew') and not p.get('popular')])
    if not shown:
        return ''
    cards = ''.join(merch_card(p) for p in shown)
    return ('<section><div class="wrap"><div class="section-head"><h2>{}</h2></div>'
            '<div class="merch-grid">{}</div></div></section>').format(heading, cards)


def hero_section(ep, bios, aliases):
    cover = ep.get('cover')
    photo = ('<div class="hero-photo viewfinder"><div class="ph-photo">'
             '<img src="/{}" alt="{}"></div></div>'
             .format(esc(cover), esc(ep.get('title'))) if cover else '')
    btn = ('<a class="btn" href="{}" rel="noopener">Смотреть выпуск</a>'
           .format(esc(ep.get('youtubeUrl'))) if ep.get('youtubeUrl') else '')
    return (
        '<section class="hero"><div class="wrap hero-grid"><div class="hero-text">'
        '<div class="badge-rec">НОВЫЙ ВЫПУСК · {badge}</div><h1>{title}</h1>{desc}{lineup}{btn}'
        '</div>{photo}</div></section>'
    ).format(badge=esc(episode_badge(ep)), title=esc(ep.get('title')),
             desc='<p class="lead">{}</p>'.format(multiline(ep['description'])) if ep.get('description') else '',
             lineup=lineup_html(ep, bios, aliases), btn=btn, photo=photo)


def parse_lineup(lines):
    """«ЖАНР: имя, имя» -> [(жанр, [имена])]. Повторяет parseLineup в app.js."""
    out = []
    for raw in lines or []:
        text = str(raw or '').strip()
        if not text:
            continue
        genre, _, rest = text.partition(':')
        if not rest:
            genre, rest = '', text
        names = [n.strip() for n in rest.split(',') if n.strip()]
        if names:
            out.append((genre.strip(), names))
    return out


def event_section(ev):
    """Афиша в тексте страницы. Концерт — самое «ищущееся», что есть на
    сайте: дата, место и два десятка имён, которые люди набирают руками."""
    if not ev:
        return ''
    groups = ''.join(
        '<div class="ev-genre">{}<ul class="ev-names">{}</ul></div>'.format(
            '<div class="ev-genre-tag mono">{}</div>'.format(esc(genre)) if genre else '',
            ''.join('<li>{}</li>'.format(esc(n)) for n in names))
        for genre, names in parse_lineup(ev.get('lineup')))
    poster = ('<div class="ph-photo viewfinder"><img class="ph-img" src="/{}" alt="Афиша {}"></div>'
              .format(esc(ev['poster']), esc(ev.get('title'))) if ev.get('poster') else '')
    when = ' · '.join(x for x in [ev.get('date'), ev.get('place')] if x)
    return (
        '<section class="hero ev-hero"><div class="wrap ev-grid">'
        '<div class="ev-poster">{poster}</div>'
        '<div class="ev-info">'
        '<div class="badge-rec">Offline ивент{age}</div>'
        '<h1>{title}</h1><div class="ev-when mono">{when}</div>'
        '{note}<div class="ev-lineup">{groups}</div>{howto}'
        '<p class="ev-rules">{terms}Вход{age2}, <b>паспорт обязателен</b>.</p>'
        '</div></div></section>'
    ).format(poster=poster, age=(' · ' + esc(ev['age'])) if ev.get('age') else '',
             title=esc(ev.get('title') or 'SPOTTER LIVE'), when=esc(when),
             note='<p class="lead">{}</p>'.format(multiline(ev['note'])) if ev.get('note') else '',
             groups=groups, howto=event_howto(ev),
             terms='' if ticket_url(ev) else 'Билет придёт в Telegram после оформления. ',
             age2=(' ' + esc(ev['age'])) if ev.get('age') else '')


def plural(n, one, few, many):
    """«1 место / 2 места / 5 мест» — как plural() в js/app.js."""
    mod10, mod100 = n % 10, n % 100
    if mod10 == 1 and mod100 != 11:
        return one
    if 2 <= mod10 <= 4 and not (12 <= mod100 <= 14):
        return few
    return many


def event_is_over(ev):
    """То же правило, что eventIsOver() в js/app.js: афиша уходит в 6 утра
    по Москве в день endsAt. Деплой после этой даты не должен вписать
    в готовый html прошедший концерт."""
    day = str(ev.get('endsAt') or '').strip()
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', day):
        return False
    msk = timezone(timedelta(hours=3))
    end = datetime.strptime(day, '%Y-%m-%d').replace(hour=6, tzinfo=msk)
    return datetime.now(msk) >= end


def ticket_url(ev):
    url = ev.get('ticketUrl') if ev else None
    return str(url).strip() if isinstance(url, str) and url.strip() else ''


def event_howto(ev):
    """Порядок действий и ссылка — то же, что рисует eventHowToHtml на сайте.

    Ссылки наружу поисковику видеть полезно, а вот шаги важнее для человека,
    который дошёл до страницы из выдачи: он должен понять условие («нужна
    подписка») до того, как уйдёт по ссылке."""
    url = ticket_url(ev)
    if not url:
        price = ev.get('ticketPrice')
        return ('<div class="ev-buy-row"><span class="ev-price mono">Билет {} ₽</span></div>'
                .format(esc(price if price is not None else '')))
    tier = str(ev.get('boostyTier') or '').strip()
    steps = [
        ('Подписка на Boosty',
         'Уровень «{}» или выше'.format(tier) if tier else 'Нужен действующий уровень подписки'),
        ('Пост по ссылке', 'Дальше — по указаниям из самого поста'),
    ]
    items = ''.join(
        '<li class="ev-step"><span class="ev-step-n mono">{n}</span>'
        '<span class="ev-step-text"><b>{t}</b>'
        '<span class="ev-step-note">{d}</span></span></li>'.format(n=i + 1, t=esc(t), d=esc(d))
        for i, (t, d) in enumerate(steps))
    return ('<div class="ev-howto"><div class="ev-howto-title mono">как попасть</div>'
            '<ol class="ev-steps">{items}</ol>'
            '<div class="ev-buy-row">'
            '<a class="btn ev-buy" href="{url}" target="_blank" rel="noopener">'
            'Открыть пост на Boosty</a></div></div>'
            ).format(items=items, url=esc(url))


def about_section(about, quote):
    if not about:
        return ''
    body = ''.join('<p>{}</p>'.format(esc(p)) for p in about)
    if quote:
        body += '<div class="about-quote">{}</div>'.format(esc(quote))
    return ('<section><div class="wrap about-cols"><h2>О проекте</h2>'
            '<div>{}</div></div></section>').format(body)


# --- разметка для поисковиков (Schema.org) -------------------------------
def event_json_ld(ev):
    """Разметка концерта. По ней поисковик показывает карточку события —
    с датой, местом и ценой прямо в выдаче."""
    if not ev:
        return ''
    block = {
        '@context': 'https://schema.org', '@type': 'MusicEvent',
        'name': '{} · {}'.format(ev.get('title') or 'SPOTTER LIVE', ev.get('date') or ''),
        'url': SITE + '/',
        'eventStatus': 'https://schema.org/EventScheduled',
        'eventAttendanceMode': 'https://schema.org/OfflineEventAttendanceMode',
        'performer': [{'@type': 'MusicGroup', 'name': n}
                      for _, names in parse_lineup(ev.get('lineup')) for n in names],
        'organizer': {'@type': 'Organization', 'name': 'SPOTTER LIVE', 'url': SITE + '/'},
    }
    if ev.get('place'):
        block['location'] = {'@type': 'Place', 'name': ev['place'],
                             'address': {'@type': 'PostalAddress', 'addressLocality': 'Москва',
                                         'streetAddress': ev['place']}}
    if ev.get('poster'):
        block['image'] = '{}/{}'.format(SITE, ev['poster'])
    # Продажа на стороне: в разметке указываем, где покупают, но не цену.
    # Цену там задаёт уровень подписки, и вписать сюда своё число значило бы
    # пообещать в выдаче сумму, которой по ссылке нет.
    if ticket_url(ev):
        block['offers'] = {'@type': 'Offer', 'url': ticket_url(ev),
                           'availability': 'https://schema.org/InStock'}
    elif ev.get('ticketPrice') is not None:
        block['offers'] = {'@type': 'Offer', 'price': ev['ticketPrice'], 'priceCurrency': 'RUB',
                           'url': SITE + '/',
                           'availability': 'https://schema.org/InStock'
                           if (ev.get('ticketsLeft') or 0) > 0 else 'https://schema.org/SoldOut'}
    return '\n<script type="application/ld+json">{}</script>'.format(
        json.dumps(block, ensure_ascii=False))


def json_ld(episodes):
    org = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        'name': 'SPOTTER LIVE',
        'alternateName': ['SPOTTER', 'СПОТТЕР', 'СПОТТЕР ЛАЙВ'],
        'url': SITE + '/',
        'logo': SITE + '/assets/logo.png',
        'description': 'Первое грайм-шоу в России: МС читают вживую под сэт '
                       'инструменталов, в один заход, без десятков дублей.',
        'sameAs': [
            'https://www.youtube.com/@spotterrussia',
            'https://www.instagram.com/spotterrussia/',
            'https://t.me/spotterglobal',
        ],
    }
    items = []
    for i, ep in enumerate(sorted_episodes(episodes)[:20], 1):
        if not ep.get('youtubeUrl'):
            continue
        items.append({
            '@type': 'ListItem', 'position': i,
            'url': '{}/episode/{}/'.format(SITE, episode_slug(ep)),
            'name': ep.get('title'),
        })
    site = {
        '@context': 'https://schema.org', '@type': 'WebSite',
        'name': 'SPOTTER LIVE', 'url': SITE + '/',
    }
    blocks = [org, site]
    if items:
        blocks.append({'@context': 'https://schema.org', '@type': 'ItemList',
                       'itemListElement': items})
    return ''.join(
        '\n<script type="application/ld+json">{}</script>'.format(
            json.dumps(b, ensure_ascii=False)) for b in blocks)


# --- сборка страниц ------------------------------------------------------
MAIN_RE = re.compile(r'(<main id="app">)(.*?)(</main>)', re.S)


def build_page(shell, body, title, description, canonical, og_image=None, subpage=False):
    """Одна страница из общего index.html: та же обвязка, свои тексты."""
    html = shell

    # Скрипт правит index.html на месте, и его могли прогнать дважды —
    # локально при проверке, а потом ещё раз в Actions. Содержимое <main>
    # заменяется целиком и от этого не страдает, а вот теги в <head>
    # налипли бы слоями. Поэтому сначала снимаем то, что добавляли сами.
    html = re.sub(r'\s*<base [^>]*>', '', html)
    html = re.sub(r'\s*<link rel="canonical"[^>]*>', '', html)
    html = re.sub(r'\s*<meta property="og:url"[^>]*>', '', html)
    html = re.sub(r'\s*<script type="application/ld\+json">.*?</script>', '', html, flags=re.S)

    # На вложенных адресах относительные пути (css/…, js/…, data/…) ушли бы
    # в /episode/x/css/… — поэтому им нужен явный корень. <base> решает это
    # одной строкой и заодно уводит #-ссылки в шапке на главную.
    if subpage:
        html = html.replace('<head>', '<head>\n<base href="/">', 1)

    html = re.sub(r'<title>.*?</title>', '<title>{}</title>'.format(esc(title)), html, count=1, flags=re.S)
    html = re.sub(r'(<meta name="description" content=")[^"]*(")',
                  lambda m: m.group(1) + esc(description) + m.group(2), html, count=1)
    html = re.sub(r'(<meta property="og:title" content=")[^"]*(")',
                  lambda m: m.group(1) + esc(title) + m.group(2), html, count=1)
    html = re.sub(r'(<meta property="og:description" content=")[^"]*(")',
                  lambda m: m.group(1) + esc(description) + m.group(2), html, count=1)
    if og_image:
        html = re.sub(r'(<meta property="og:image" content=")[^"]*(")',
                      lambda m: m.group(1) + esc(og_image) + m.group(2), html, count=1)

    head_extra = '<link rel="canonical" href="{}">\n<meta property="og:url" content="{}">'.format(
        canonical, canonical)
    html = html.replace('</head>', head_extra + '\n</head>', 1)

    if not MAIN_RE.search(html):
        raise SystemExit('ОШИБКА: в index.html не найден <main id="app"> — предрендер некуда вставить')
    html = MAIN_RE.sub(lambda m: m.group(1) + body + m.group(3), html, count=1)
    return html


def write(rel, text, made):
    path = os.path.join(ROOT, rel)
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    made.append(rel)


def main():
    dry = '--dry-run' in sys.argv
    episodes = read_json('data/episodes.json', 'episodes')
    merch = read_json('data/merch.json', 'merch')
    artists = read_json('data/artists.json', 'artists')
    bios = {a['name']: a.get('bio', '') for a in artists if a.get('name')}
    aliases, about, quote = read_config_bits()
    # Событие необязательно: пока концерт не объявлен, файла может не быть
    # вовсе, и это не повод валить сборку.
    events = read_json_optional('data/event.json', 'event')
    event = next((e for e in events
                  if e and e.get('active') and not event_is_over(e)), None)

    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
        shell = f.read()
    if not MAIN_RE.search(shell):
        raise SystemExit('ОШИБКА: в index.html не найден <main id="app">')

    latest = latest_episode(episodes)
    made = []

    # --- главная ---------------------------------------------------------
    # Объявлен концерт — первый экран его, как и на живом сайте. Выпуск при
    # этом никуда не девается: он ниже, в разделе выпусков.
    first_screen = event_section(event) if event else hero_section(latest, bios, aliases)
    home_body = (first_screen
                 + about_section(about, quote)
                 + episodes_section(episodes, bios, aliases, 'Выпуски')
                 + merch_section(merch))
    if event:
        home_title = '{} · {} — {}'.format(
            event.get('title') or 'SPOTTER LIVE', event.get('date') or '',
            event.get('place') or 'Москва')
        names = [n for _, ns in parse_lineup(event.get('lineup')) for n in ns]
        # Цену в описание ставим только при продаже на сайте: при продаже
        # через Boosty её задаёт уровень подписки, и число из этих полей
        # обещало бы в выдаче сумму, которой по ссылке нет.
        home_desc = 'Живой концерт SPOTTER LIVE {}, {}. {}.{}'.format(
            event.get('date') or '', event.get('place') or '', ', '.join(names[:12]),
            '' if ticket_url(event) else ' Билет {} ₽.'.format(event.get('ticketPrice')))
        home_desc = re.sub(r'\s+', ' ', home_desc).strip()[:300]
    else:
        home_title = 'SPOTTER LIVE — русский грайм вживую, в один заход'
        home_desc = ('SPOTTER LIVE — первое грайм-шоу в России: МС читают вживую под сэт '
                     'инструменталов, в один заход, без десятков дублей. Архив выпусков '
                     'с составами и мерч проекта.')
    # og:image в index.html прописан относительным путём — для превью
    # в мессенджерах он должен быть полным адресом, иначе карточка пустая.
    home_og = '{}/{}'.format(SITE, latest['cover']) if latest.get('cover') else None
    home = build_page(shell, home_body, home_title, home_desc, SITE + '/', og_image=home_og)
    home = home.replace('</head>', json_ld(episodes) + event_json_ld(event) + '\n</head>', 1)
    write('index.html', home, made)

    # --- разделы ---------------------------------------------------------
    sections = {
        'episodes': (
            'Все выпуски SPOTTER LIVE — архив грайм-сессий',
            'Полный архив выпусков SPOTTER LIVE: составы, участники и ссылки на YouTube.',
            episodes_section(episodes, bios, aliases, 'Выпуски'),
        ),
        'merch': (
            'Мерч SPOTTER — худи и футболки проекта',
            'Официальный мерч SPOTTER LIVE: худи и футболки ограниченным тиражом.',
            merch_section(merch) or '<section><div class="wrap"><h2>Мерч</h2></div></section>',
        ),
    }
    for name in STATIC_PAGES:
        title, desc, body = sections[name]
        url = '{}/{}/'.format(SITE, name)
        write('{}/index.html'.format(name),
              build_page(shell, body, title, desc, url, subpage=True), made)

    # --- по выпуску ------------------------------------------------------
    for ep in episodes:
        slug = episode_slug(ep)
        names = [aliases.get(a, a) for a in (ep.get('artists') or [])]
        title = '{} — SPOTTER LIVE'.format(ep.get('title'))
        desc = ep.get('description') or '{}. {} читают вживую под бит, в один заход.'.format(
            episode_badge(ep), ', '.join(names))
        desc = re.sub(r'\s+', ' ', desc).strip()[:300]
        body = ('<section><div class="wrap">'
                + episode_card(ep, bios, aliases)
                + '<p><a href="/episodes/">Все выпуски SPOTTER LIVE</a></p>'
                + '</div></section>')
        url = '{}/episode/{}/'.format(SITE, slug)
        og = '{}/{}'.format(SITE, ep['cover']) if ep.get('cover') else None
        write('episode/{}/index.html'.format(slug),
              build_page(shell, body, title, desc, url, og_image=og, subpage=True), made)

    # --- robots и sitemap ------------------------------------------------
    write('robots.txt',
          'User-agent: *\nAllow: /\n\n'
          'Sitemap: {}/sitemap.xml\n'
          'Host: {}\n'.format(SITE, SITE.replace('https://', '')), made)

    today = date.today().isoformat()
    urls = [(SITE + '/', '1.0')]
    urls += [('{}/{}/'.format(SITE, n), '0.8') for n in STATIC_PAGES]
    urls += [('{}/episode/{}/'.format(SITE, episode_slug(e)), '0.6') for e in sorted_episodes(episodes)]
    body = ''.join(
        '  <url><loc>{}</loc><lastmod>{}</lastmod><priority>{}</priority></url>\n'.format(u, today, p)
        for u, p in urls)
    write('sitemap.xml',
          '<?xml version="1.0" encoding="UTF-8"?>\n'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{}</urlset>\n'.format(body),
          made)

    print('Сгенерировано файлов: {}'.format(len(made)))
    print('  выпусков: {}, товаров: {}, подписей: {}'.format(len(episodes), len(merch), len(bios)))
    print('  адресов в sitemap: {}'.format(len(urls)))
    if dry:
        print('  (--dry-run: файлы всё равно записаны, они не коммитятся — см. .gitignore)')


if __name__ == '__main__':
    main()
