/* =====================================================================
   CONFIG — ВСЁ РЕДАКТИРУЕМОЕ СОДЕРЖИМОЕ САЙТА ЛЕЖИТ ЗДЕСЬ.
   Пришлёшь реальные тексты/цены/фото/цвета — просто заменишь значения
   в этом объекте, остальной код трогать не нужно.
   ===================================================================== */
const CONFIG = {
  // Аккаунт магазина, без @. Показывается покупателю как контакт («с вами
  // свяжутся в Telegram») и используется в запасной ссылке, если заказ
  // не удалось отправить автоматически.
  telegramUsername: 'spottershop',

  // Скидка за пройденный опрос, ₽. Цена «после опроса» считается от неё сама,
  // руками её нигде дублировать не надо. 0 — предложение со скидкой нигде
  // не показывается, опрос остаётся просто опросом.
  // Скидку присылают вручную в переписке: промокодов на сайте нет.
  surveyDiscount: 1700,

  // Приёмник ответов опроса — веб-приложение Google Apps Script.
  // Пустая строка — ответы никуда не отправляются и живут только в заказе
  // в Telegram. Как получить адрес — serverless/google-sheets/README.md.
  // Выглядит так: 'https://script.google.com/macros/s/AKfy..../exec'
  surveySheetUrl: 'https://script.google.com/macros/s/AKfycbwCNeyVaUMrbzu_wfAzUkaIoqzx_wmyHTCix1HpuB1-XsVAlsRiD2Smabmwk10ElG8yMw/exec',

  // Адрес функции, которая отдаёт пункты выдачи СДЭК.
  // Пустая строка — при доставке спрашиваем адрес обычным текстовым полем,
  // никакого СДЭК на сайте нет. Ключи СДЭК лежат в функции, не здесь:
  // всё, что в этом файле, видно любому посетителю.
  // Как поднять функцию — serverless/cdek-points/README.md.
  cdekPointsUrl: '',

  // Ключ Яндекс.Карт для виджета СДЭК с картой («JavaScript API и HTTP
  // Геокодер»). Пустая строка — карта не показывается, пункты выдачи
  // выбираются простым списком по городу; всё остальное работает.
  // Этот ключ по своей природе виден в исходниках страницы — поэтому
  // в кабинете Яндекса его обязательно надо ограничить доменом
  // spotterlive.ru, иначе квоту израсходуют чужие сайты.
  cdekWidgetKey: '',

  // С какого города открывается карта, пока покупатель не ввёл свой.
  cdekDefaultCity: 'Москва',

  // Ключ YouTube Data API v3. Пустая строка — сайт берёт просмотры из снимка
  // EPISODE_VIEWS внизу файла. Если ключ задан, числа обновляются живьём
  // при заходе на сайт (один запрос на все выпуски, кэш на 6 часов).
  // Ключ виден всем в исходниках страницы — это нормально ТОЛЬКО если
  // в Google Cloud Console ограничить его: по домену (HTTP referrer)
  // и по одному API (YouTube Data API v3). Иначе квоту израсходуют чужие.
  youtubeApiKey: '',

  // Анонс следующего выпуска. null — блок на главной не показывается.
  // Чтобы показать, заполни по образцу:
  // upcoming: {
  //   title: 'CHAPTER II, EP.08',
  //   date: '12 сентября',            // как хочешь, так и напишется
  //   place: 'бар BTK, Москва',
  //   lineup: ['REDO', 'TILLS'],      // можно пустым массивом
  //   note: 'Съёмка закрытая, попасть — по анкете в телеграме.',
  //   link: 'https://t.me/spotterglobal'   // необязательно
  // },
  upcoming: null,

  // Источник — реальные посты с канала (скрины прислал Юрий): пост самого SPOTTER LIVE
  // на годовщину + два поста основателя REDO с историей запуска. Ниже — сжатый пересказ,
  // не дословная цитата (в оригинале мат и неформальный тон Telegram). Про поддержку от
  // Wiley — это заявление самого REDO, я его не проверял, поэтому со ссылкой на источник.
  aboutParagraphs: [
    `SPOTTER LIVE — Первое грайм шоу в России, где артисты читают вживую под сэт
    инструменталов, в один заход, без десятков дублей.`,

    `Идею основатель REDO вынашивал ещё с 2018 года — тогда проект должен был
    называться GREEN STREET и выходить в Петербурге, но так и не состоялся.`,

    `В 2023-м REDO полгода пытался предложить концепцию организаторам, но получал
    отказ за отказом. Один из лейблов прямо сказал, что такой грайм никому не нужен.
    Тогда REDO решил не ждать разрешения и запустил проект самостоятельно. К работе
    он пригласил режиссёра Матвея Николаева — того самого, чьи клипы сегодня выходят
    на канале — чтобы с самого начала сформировать узнаваемый визуальный язык SPOTTER.`,

    `За первый год SPOTTER вышел за пределы русскоязычной сцены. Сегодня около 30%
    аудитории проекта приходится на Европу и Великобританию, остальные 70% — на
    русскоязычных зрителей, которые следят за SPOTTER с первых дней. Проект заметили
    и за пределами России: по словам REDO, его поддержал Wiley — один из пионеров
    британского грайма.`
  ],
  aboutQuote: `Талант не требует разрешения — ему нужна только платформа.`,

  // Сезоны подтвердились через реальные названия видео на YouTube (проверил через поиск).
  // У проекта два сезона: оригинальный без официального названия (условно "Сезон 1" —
  // сами они так не подписывали) и официально озаглавленный "CHAPTER II".
  // description — необязательное поле. У выпусков с составом подписи берутся
  // из ARTIST_BIOS внизу файла (по одной строке на участника), поэтому
  // description пустой. Заполняй его, только если про выпуск есть что сказать
  // отдельно от состава — тогда текст встанет над списком участников.
  // ВАЖНО: этот массив — только запасной снимок на случай, если data/episodes.json
  // недоступен (например, открыли файл напрямую, без сервера). Настоящий источник
  // данных для сайта и админки — data/episodes.json, его правит Decap CMS (/admin).
  // Руками этот блок обычно трогать не нужно.
  episodes: [
    {
      chapter: 1,
      number: 1,
      title: 'REDO, TILLS, JEWELZ PART II, FOLKPRO x DJ CHAPO',
      artists: ['REDO', 'TILLS', 'JEWELZ', 'FOLKPRO', 'DJ CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=wGEtGLTBDcU',
      duration: '11:45',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ep01-redo-tills-jewelz-folkpro.jpg'
    },
    {
      chapter: 1,
      number: 2,
      title: "PRA(KILLA'GRAMM), RAYBAX, JOLLO, KODZIMA, LONGLIVE x DJ CHAPO",
      artists: ["PRA(KILLA'GRAMM)", 'RAYBAX', 'JOLLO', 'KODZIMA', 'LONGLIVE', 'DJ CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=T3JxilxxaPg',
      duration: '14:45',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ep02-prakillagramm-raybax-jollo-kodzima-longlive.jpg'
    },
    {
      chapter: 1,
      number: 3,
      title: 'RAM, TILLS, CHENOSKE, SPIESKEY, JEWELZ PART II, VERLIEBER x DJ CHAPO',
      artists: ['RAM', 'TILLS', 'CHENOSKE', 'SPIESKEY', 'JEWELZ', 'VERLIEBER', 'DJ CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=XlTIW2OH4yA',
      duration: '13:41',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ep03-ram-tills-chenoske-spieskey-verlieber.jpg'
    },
    {
      chapter: 1,
      number: 4,
      title: 'REDO, TVETH, МЕЗАМЕР, ESKI M x DJ CHAPO',
      artists: ['REDO', 'TVETH', 'МЕЗАМЕР', 'ESKI M', 'DJ CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=tBQRqC42uiU',
      duration: '11:58',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ep04-redo-tveth-mezamer-eskim.jpg'
    },
    {
      chapter: 2,
      number: 3,
      title: 'RAYBAX, STEPPA STYLE, SPIESKEY, HUMSLEEP, ESKI M x ODDKUT',
      artists: ['RAYBAX', 'STEPPA STYLE', 'SPIESKEY', 'HUMSLEEP', 'ESKI M', 'ODDKUT'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=QHlIJr8498A',
      duration: '24:39',
      dj: 'ODDKUT',
      cover: 'assets/episodes/ch2-ep03-raybax-steppastyle-spieskey-humsleep-eskim.jpg'
    },
    {
      chapter: 2,
      number: 4,
      title: 'BUMBLE BEEZY, REDO, JOLLO, RECEPT x DJ CHAPO',
      artists: ['BUMBLE BEEZY', 'REDO', 'JOLLO', 'RECEPT', 'DJ CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=RMI1BhYkSyM',
      duration: '18:21',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ch2-ep04-bumblebeezy-redo-jollo-recept.jpg'
    },
    {
      chapter: 2,
      number: 5,
      title: 'ВОВА КЛЕВЕР, JEWELZ, T!MMI, EEUGENE SPEED, YA DIGG KAPUSTU x DJ CHAPO',
      artists: ['ВОВА КЛЕВЕР', 'JEWELZ PART II', 'T!MMI', 'EEUGENE SPEED', 'YA DIGG KAPUSTU!', 'DJ CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=Y9GGNxYPWEU',
      duration: '16:51',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ch2-ep05-vovaklever-jewelz-timmi-eeugenespeed-doctorkapustu.jpg'
    },
    {
      chapter: 2,
      number: 6,
      title: 'МАЙК СТИКС, TILLS, GD4, LONGLIVE x FIRRY',
      artists: ['МАЙК СТИКС', 'TILLS', 'GD4', 'LONGLIVE', 'FIRRY'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=6biEVwSK8Qk',
      duration: '17:25',
      dj: 'FIRRY',
      cover: 'assets/episodes/ch2-ep06-gd4-maikstiks-longlive-tills.jpg'
    },
    {
      chapter: 2,
      number: 7,
      title: "PRA(KILLA'GRAMM), MAGU, КАЖЭ ОБОЙМА, LORD POLO x CHAPO",
      artists: ["PRA(KILLA'GRAMM)", 'MAGU', 'КАЖЭ ОБОЙМА', 'LORD POLO', 'CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=RQcJe7P_1dk',
      duration: '16:18',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ch2-ep07-prakillagramm-magu-lordpolo-kazheoboyma.jpg'
    },
    {
      chapter: 2,
      number: 1,
      title: 'НОКТУ, VITO, ALONE30, AMMIAK x DJ CHAPO',
      artists: ['НОКТУ', 'VITO', 'ALONE30', 'AMMIAK', 'DJ CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=i4no-mDA64s',
      duration: '17:31',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ch2-ep01-noktu-vito-ammiak-alone30.jpg'
    },
    {
      chapter: 2,
      number: 2,
      title: 'МАКСИ ГРИН, MATI BOY, KODZIMA, MELLOW G, БАЧ x DJ CHAPO',
      artists: ['МАКСИ ГРИН', 'MATI BOY', 'KODZIMA', 'MELLOW G', 'БАЧ', 'DJ CHAPO'],
      description: '',
      youtubeUrl: 'https://www.youtube.com/watch?v=Rn3scIXh1sE',
      duration: '20:00',
      dj: 'DJ CHAPO',
      cover: 'assets/episodes/ch2-ep02-maksigreen-matiboy-kodzima-mellowg-bach.jpg'
    },
    {
      chapter: null,
      standalone: true,
      number: null,
      title: 'SPOTTER - REDO /s1',
      artists: ['REDO'],
      description: 'Самый первый выпуск SPOTTER, сделанный задолго до создания формата SPOTTER LIVE, в котором REDO исполняет трек PANDORA BLOCK.',
      youtubeUrl: 'https://www.youtube.com/watch?v=YifSk_JCF7k',
      duration: '2:48',
      cover: 'assets/episodes/standalone-redo-s1.jpg'
    }
  ],

  // Порядок в этом массиве = порядок карточек в разделе «Мерч».
  // Сверху держим то, что хотим продавать в первую очередь: сначала популярное,
  // следом товары со съёмкой на модели — они заметно лучше продают, чем
  // предметное фото на белом.
  // ВАЖНО: последний товар в списке показывается на главной как «Новый дроп»,
  // поэтому новинку дописывай в конец.
  // Тот же принцип, что и у episodes выше: это запасной снимок, настоящий
  // источник — data/merch.json, его правит Decap CMS (/admin).
  // active: false — товар остаётся в данных (не теряется), но не показывается
  // на сайте. Включается/выключается из админки (/admin) чекбоксом "Показывать
  // на сайте" — так товары можно прятать и возвращать, ничего не удаляя.
  merch: [
    {
      id: 'rewinding-riddims',
      name: 'Футболка REWINDING RIDDIMS',
      category: 'Футболки',
      price: 3490,
      description: 'Оверсайз-футболка, белая. Принт спереди: рукопожатие и логотип REWINDING RIDDIMS.',
      sizes: ['S','M','L','XL'],
      stock: { S: 6, M: 8, L: 6, XL: 3 },
      popular: true,
      active: false,
      images: ['assets/merch/rewinding-riddims.jpg']
    },
    {
      id: 'spotter-blue',
      name: 'Футболка SPOTTER Blue',
      category: 'Футболки',
      price: 3490,
      description: 'Оверсайз-футболка, чёрная. Принт спереди: логотип SPOTTER в синем градиенте.',
      sizes: ['S','M','L','XL'],
      stock: { S: 6, M: 8, L: 6, XL: 3 },
      popular: false,
      active: false,
      images: [
        'assets/merch/spotter-blue.jpg',
        'assets/merch/spotter-blue-1.jpg',
        'assets/merch/spotter-blue-2.jpg',
        'assets/merch/spotter-blue-3.jpg',
        'assets/merch/spotter-blue-4.jpg',
        'assets/merch/spotter-blue-5.jpg'
      ]
    },
    {
      id: 'spotter-logo-pink',
      name: 'Футболка SPOTTER Logo Pink',
      category: 'Футболки',
      price: 3499,
      description: 'Футболка, белая. Принт спереди: логотип SPOTTER в розовом градиенте.',
      sizes: ['S','M','L','XL'],
      stock: { S: 6, M: 8, L: 6, XL: 3 },
      popular: false,
      active: false,
      images: [
        'assets/merch/spotter-logo-pink.jpg',
        'assets/merch/spotter-pink-1.jpg',
        'assets/merch/spotter-pink-2.jpg',
        'assets/merch/spotter-pink-3.jpg'
      ]
    },
    {
      id: 'spotter-green',
      name: 'Футболка SPOTTER Green',
      category: 'Футболки',
      price: 3490,
      description: 'Оверсайз-футболка, чёрная. Принт спереди: логотип SPOTTER в зелёном градиенте.',
      sizes: ['S','M','L','XL'],
      stock: { S: 6, M: 8, L: 6, XL: 3 },
      popular: false,
      active: false,
      images: ['assets/merch/spotter-green.jpg']
    },
    {
      id: 'rewinding-business-black',
      name: 'Футболка REWIND BUSINESS Black',
      category: 'Футболки',
      price: 3499,
      description: 'Футболка, чёрная. Принт спереди: пачка долларов с логотипом SPOTTER и надписью REWIND BUSINESS.',
      sizes: ['S','M','L','XL'],
      stock: { S: 6, M: 8, L: 6, XL: 3 },
      popular: false,
      active: false,
      images: ['assets/merch/rewinding-business-black.jpg']
    },
    {
      id: 'rewinding-business-white',
      name: 'Футболка REWIND BUSINESS White',
      category: 'Футболки',
      price: 3499,
      description: 'Футболка, белая. Принт спереди: пачка долларов с логотипом SPOTTER и надписью REWIND BUSINESS.',
      sizes: ['S','M','L','XL'],
      stock: { S: 6, M: 8, L: 6, XL: 3 },
      popular: false,
      active: false,
      images: ['assets/merch/rewinding-business-white.jpg']
    },
    {
      id: 'spotter-logo-white',
      name: 'Футболка SPOTTER Logo',
      category: 'Футболки',
      price: 3499,
      description: 'Футболка, белая. Принт спереди: чёрный логотип SPOTTER.',
      sizes: ['S','M','L','XL'],
      stock: { S: 6, M: 8, L: 6, XL: 3 },
      popular: false,
      active: false,
      images: ['assets/merch/spotter-logo-white.jpg']
    },
    {
      id: 'spotter-hoodie-black',
      name: 'Худи SPOTTER',
      category: 'Худи',
      price: 6700,
      description: 'Худи, чёрное. Принт на груди: логотип SPOTTER с синей обводкой.',
      sizes: ['S','M','L','XL'],
      stock: { S: 5, M: 5, L: 5, XL: 5 },
      popular: true,
      active: true,
      images: ['assets/merch/spotter-hoodie-black.jpg']
    }
  ]
};

/* =====================================================================
   ПРОСМОТРЫ — снимок с YouTube.
   Обновлён: 06.09.2026

   Не правь числа руками: запусти tools/update-views.ps1, он сходит
   в YouTube API с ключом из .env и перепишет этот блок сам.
   Ключ при этом остаётся на твоём компьютере и в браузер не попадает.

   Ключ объекта — идентификатор ролика (то, что стоит после watch?v=),
   потому что ровно в таком виде числа приходят из API.
   ===================================================================== */
const EPISODE_VIEWS = {
  'wGEtGLTBDcU': 35228,      // гл.1 ep.01
  'T3JxilxxaPg': 95961,      // гл.1 ep.02
  'XlTIW2OH4yA': 26126,      // гл.1 ep.03
  'tBQRqC42uiU': 24880,      // гл.1 ep.04
  'QHlIJr8498A': 68418,      // гл.2 ep.03
  'RMI1BhYkSyM': 83364,      // гл.2 ep.04
  'Y9GGNxYPWEU': 16274,      // гл.2 ep.05
  '6biEVwSK8Qk': 24200,      // гл.2 ep.06
  'RQcJe7P_1dk': 28196,      // гл.2 ep.07
  'i4no-mDA64s': 40202,      // гл.2 ep.01
  'Rn3scIXh1sE': 26915,      // гл.2 ep.02
  'YifSk_JCF7k': 35882       // сольник REDO
};

/* =====================================================================
   ОДНИ И ТЕ ЖЕ ЛЮДИ ПОД РАЗНЫМИ ПОДПИСЯМИ.
   В названиях роликов один и тот же человек подписан по-разному, и без
   этой таблицы он превращается в двух разных участников: в бегущей строке
   мелькает дважды, а на странице участника выпуски разъезжаются по двум
   карточкам. Слева — как встречается в данных, справа — каноничная форма.
   Добавляя выпуск, проверь, нет ли нового написания уже известного имени.
   ===================================================================== */
const ARTIST_ALIASES = {
  'JEWELZ': 'JEWELZ PART II',
  'CHAPO': 'DJ CHAPO'
};

/* =====================================================================
   КТО ЕСТЬ КТО — короткая подпись под каждым участником.
   Одна строка на человека, а не на выпуск: один и тот же МС выходит
   на площадку по нескольку раз, и если писать подпись внутри эпизода,
   один и тот же текст расползается по конфигу и рано или поздно
   разъезжается. Здесь правишь в одном месте — меняется везде.
   Ключ — каноничное имя (после ARTIST_ALIASES выше). Если человека
   в таблице нет, подпись просто не показывается — это нормально,
   так сейчас у диджеев.
   ===================================================================== */
const ARTIST_BIOS = {
  "PRA(KILLA'GRAMM)": 'участник объединения PDVL Firma',
  'MAGU': 'участник группы «Чёрная Экономика»',
  'LORD POLO': 'участник объединения ART LORDS',
  'КАЖЭ ОБОЙМА': 'экс-участник объединения DEF JOINT',

  'GD4': 'яркая звезда Reels, артист',
  'МАЙК СТИКС': 'участник CRAM SQUAD и KLAN NOGI',
  'LONGLIVE': 'участник TEAM SPOTTER и GOH',
  'TILLS': 'один из ветеранов жанра, прославившийся своими выступлениями на GUNFINGER',

  'ВОВА КЛЕВЕР': 'боец TOP DOG, начавший свою музыкальную карьеру',
  'JEWELZ PART II': 'один из ветеранов жанра, участвовал на GUNFINGER, широко известен за пределами РФ и СНГ',
  'T!MMI': 'участник команды «Нищета и Собаки»',
  'EEUGENE SPEED': 'участник объединения WEEMIX, видный MC с площадки «Триплет»',
  'YA DIGG KAPUSTU!': 'участник объединения WEEMIX, видный MC с площадки «Триплет»',

  'BUMBLE BEEZY': 'знаменитый рэп-артист, автор хитов flowshop, дайджест',
  'REDO': 'основатель площадки SPOTTER, ветеран жанра',
  'JOLLO': 'мультифункциональный артист, мастерски владеющий как роком, так и рэпом, граймом',
  'RECEPT': 'молодой талант в грайме',

  'RAYBAX': 'заметная личность в жанре, вдохновившая многих начать делать грайм',
  'STEPPA STYLE': 'ветеран UK BASS сцены, имеющий за плечами множество релизов',
  'SPIESKEY': 'ярчайший представитель GOH, отличающийся своей лиричностью',
  'HUMSLEEP': 'артист, смешивающий Soundcloud и dark eski эстетики в одно целое',
  'ESKI M': 'молодой талант в жанре, практикующий аутентичный грайм из начала нулевых',

  'МАКСИ ГРИН': 'участник объединения GAZ',
  'MATI BOY': 'мультижанровый, мультиязычный, мультикультурный исполнитель',
  'KODZIMA': 'участник RAPLOGISTICA CREW, завоевавший сердца фанатов своей экспрессией',
  'MELLOW G': 'исполнительница, мастерски владеющая искусством фристайла',
  'БАЧ': 'участник GOH, известный своей манерой играть голосом во время читки',

  'НОКТУ': 'ветеран баттлов, музыкант, известный своей агрессивной подачей',
  'VITO': 'глава ACE Hip-Hop в ACE Music, музыкант',
  'AMMIAK': 'ветеран жанра, вернувшийся из длительного затишья',
  'ALONE30': 'ранее был известен как MUFASAH, ветеран жанра',

  'TVETH': 'участник объединения HELLA HILLZ, экс-участник YUNGRUSSIA',
  'МЕЗАМЕР': 'рок-артист, впервые попробовавший себя в грайме',

  'RAM': 'один из крупнейших артистов, собирающий большие залы по всей России',
  'CHENOSKE': 'участник баттлов на GOH и ЦУМ GRIME CLASH',
  'VERLIEBER': 'участник баттлов на GOH и ЦУМ GRIME CLASH',

  'FOLKPRO': 'звезда UK BASS сцены, широко известный и за её пределами, участник CHARVA MUSIC и JUNGLEGROUND'
};

/* =====================================================================
   STATE
   ===================================================================== */
