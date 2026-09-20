/* =====================================================================
   ИНТЕРФЕЙС РЕДАКТОРА.

   Формы строятся по SCHEMAS, а не пишутся руками: полей два десятка,
   и дублировать их разметкой значит однажды забыть обновить одно из мест.
   ===================================================================== */

let current = 'merch';      // какая коллекция открыта
let openIndex = -1;         // какая запись развёрнута
let busy = false;

const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function say(msg, kind){
  const el = $('#status');
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}
function setBusy(on, msg){
  busy = on;
  document.body.classList.toggle('busy', on);
  if (msg) say(msg, on ? 'work' : 'ok');
}

/* ---------------------------------------------------------------------
   ВХОД
   --------------------------------------------------------------------- */
function showLogin(err){
  $('#login').hidden = false;
  $('#workspace').hidden = true;
  if (err) { $('#loginErr').textContent = err; $('#loginErr').hidden = false; }
  else $('#loginErr').hidden = true;
}
async function tryLogin(value){
  const t = (value || '').trim();
  if (!t) return showLogin('Вставьте токен.');
  token = t;
  $('#loginErr').hidden = true;
  $('#loginBtn').disabled = true;
  $('#loginBtn').textContent = 'Проверяю…';
  try{
    // Проверяем не «валиден ли токен вообще», а «пускает ли он в наш
    // репозиторий» — токен может быть живым, но выданным не на тот проект.
    const probe = await fetch(`${API}/repos/${REPO}`, { headers: authHeaders() });
    if (!probe.ok) throw new Error(await describeError(probe));
    saveToken(t, $('#rememberField').checked);
    $('#login').hidden = true;
    $('#workspace').hidden = false;
    await loadAll();
  }catch(e){
    token = '';
    showLogin(e.message);
  }finally{
    $('#loginBtn').disabled = false;
    $('#loginBtn').textContent = 'Войти';
  }
}
function logout(){
  if (Object.values(state).some(s => s && s.dirty) &&
      !confirm('Есть несохранённые правки. Всё равно выйти?')) return;
  forgetToken();
  token = '';
  location.reload();
}

/* ---------------------------------------------------------------------
   ЗАГРУЗКА
   --------------------------------------------------------------------- */
async function loadCollection(name){
  const s = SCHEMAS[name];
  const file = await ghGet(s.file);
  if (!file) throw new Error(`В репозитории нет файла ${s.file}`);
  const json = JSON.parse(base64ToUtf8(file.content));
  state[name] = { data: json[s.key] || [], sha: file.sha, dirty: false };
}
async function loadAll(){
  setBusy(true, 'Загружаю данные…');
  try{
    await Promise.all(Object.keys(SCHEMAS).map(loadCollection));
    render();
    setBusy(false, 'Данные загружены.');
  }catch(e){
    setBusy(false);
    say(e.message, 'err');
  }
}

/* ---------------------------------------------------------------------
   ОТРИСОВКА
   --------------------------------------------------------------------- */
function render(){
  $('#tabs').innerHTML = Object.keys(SCHEMAS).map(n=>{
    const s = SCHEMAS[n], st = state[n];
    return `<button class="tab ${n===current?'active':''}" data-tab="${n}">
      ${esc(s.title)}${st && st.dirty ? ' •' : ''}</button>`;
  }).join('');

  const s = SCHEMAS[current], st = state[current];
  if (!st){ $('#list').innerHTML = ''; return; }

  $('#list').innerHTML = st.data.map((item, i)=>{
    const head = `
      <div class="row-head" data-open="${i}">
        <span class="row-title">${esc(s.summary(item))}</span>
        <span class="row-tools">
          <button class="mini" data-move="${i}|-1" title="Выше" ${i===0?'disabled':''}>↑</button>
          <button class="mini" data-move="${i}|1" title="Ниже" ${i===st.data.length-1?'disabled':''}>↓</button>
          <button class="mini danger" data-del="${i}" title="Удалить">×</button>
        </span>
      </div>`;
    const body = i === openIndex
      ? `<div class="row-body">${s.fields.map(f => fieldHtml(f, item, i)).join('')}</div>`
      : '';
    return `<div class="row ${i===openIndex?'open':''}">${head}${body}</div>`;
  }).join('') || `<div class="empty">Пока ничего нет.</div>`;

  $('#addBtn').textContent = `Добавить ${s.one}`;
  $('#saveBtn').disabled = !st.dirty;
  $('#saveBtn').textContent = st.dirty ? `Сохранить «${s.title}»` : 'Всё сохранено';
}

function fieldHtml(f, item, i){
  const v = item[f.name];
  const id = `f-${i}-${f.name}`;
  const hint = f.hint ? `<div class="hint">${esc(f.hint)}</div>` : '';
  let control = '';

  switch (f.type){
    case 'text':
      control = `<input id="${id}" type="text" data-field="${f.name}" value="${esc(v)}">`;
      break;
    case 'textarea':
      control = `<textarea id="${id}" rows="3" data-field="${f.name}">${esc(v)}</textarea>`;
      break;
    case 'number':
      control = `<input id="${id}" type="number" data-field="${f.name}" value="${v == null ? '' : esc(v)}">`;
      break;
    case 'bool':
      return `<label class="field check">
        <input id="${id}" type="checkbox" data-field="${f.name}" ${v ? 'checked' : ''}>
        <span>${esc(f.label)}</span>${hint}</label>`;
    case 'strings':
      control = `<textarea id="${id}" rows="${Math.max((v||[]).length, 2)}" data-list="${f.name}"
        >${esc((v || []).join('\n'))}</textarea>`;
      break;
    case 'object':
      control = `<div class="obj">${(f.keys || []).map(k=>`
        <label class="obj-cell"><span>${esc(k)}</span>
          <input type="number" data-obj="${f.name}|${k}" value="${esc((v||{})[k] ?? 0)}"></label>`).join('')}</div>`;
      break;
    case 'image':
      control = `<div class="img-one">
        ${v ? `<img src="../${esc(v)}" alt="" class="thumb">` : '<div class="thumb empty-thumb">нет фото</div>'}
        <div class="img-side">
          <input type="text" data-field="${f.name}" value="${esc(v)}" placeholder="assets/episodes/…">
          <label class="upload">Загрузить<input type="file" accept="image/*" data-upload-one="${f.name}|${f.folder}" hidden></label>
        </div></div>`;
      break;
    case 'images':
      control = `<div class="img-list">
        ${(v || []).map((src, k)=>`
          <div class="img-item">
            <img src="../${esc(src)}" alt="" class="thumb">
            <div class="img-side">
              <code>${esc(src.split('/').pop())}</code>
              <div class="img-tools">
                <button class="mini" data-imgmove="${f.name}|${k}|-1" ${k===0?'disabled':''}>↑</button>
                <button class="mini" data-imgmove="${f.name}|${k}|1" ${k===(v||[]).length-1?'disabled':''}>↓</button>
                <button class="mini danger" data-imgdel="${f.name}|${k}">×</button>
              </div>
            </div>
          </div>`).join('')}
        <label class="upload">Добавить фото<input type="file" accept="image/*" multiple data-upload-many="${f.name}|${f.folder}" hidden></label>
      </div>`;
      break;
  }
  return `<div class="field${f.collapsed ? ' quiet' : ''}">
    <label for="${id}">${esc(f.label)}</label>${control}${hint}</div>`;
}

/* ---------------------------------------------------------------------
   ПРАВКИ
   --------------------------------------------------------------------- */
function item(){ return state[current].data[openIndex]; }
function touch(){ state[current].dirty = true; $('#saveBtn').disabled = false;
                  $('#saveBtn').textContent = `Сохранить «${SCHEMAS[current].title}»`;
                  say('Есть несохранённые правки.', 'work'); }

function bindEvents(){
  $('#tabs').addEventListener('click', e=>{
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    current = b.dataset.tab; openIndex = -1; render();
  });

  $('#list').addEventListener('click', e=>{
    const open = e.target.closest('[data-open]');
    const move = e.target.closest('[data-move]');
    const del  = e.target.closest('[data-del]');
    const imgm = e.target.closest('[data-imgmove]');
    const imgd = e.target.closest('[data-imgdel]');
    const st = state[current];

    if (move){
      const [i, d] = move.dataset.move.split('|').map(Number);
      const to = i + d;
      if (to < 0 || to >= st.data.length) return;
      [st.data[i], st.data[to]] = [st.data[to], st.data[i]];
      if (openIndex === i) openIndex = to; else if (openIndex === to) openIndex = i;
      touch(); render(); return;
    }
    if (del){
      const i = Number(del.dataset.del);
      if (!confirm(`Удалить «${SCHEMAS[current].summary(st.data[i])}»? Это правка только здесь — файлы фото останутся.`)) return;
      st.data.splice(i, 1);
      if (openIndex === i) openIndex = -1; else if (openIndex > i) openIndex--;
      touch(); render(); return;
    }
    if (imgm){
      const [name, k, d] = imgm.dataset.imgmove.split('|');
      const arr = item()[name] || [];
      const from = Number(k), to = from + Number(d);
      if (to < 0 || to >= arr.length) return;
      [arr[from], arr[to]] = [arr[to], arr[from]];
      touch(); render(); return;
    }
    if (imgd){
      const [name, k] = imgd.dataset.imgdel.split('|');
      (item()[name] || []).splice(Number(k), 1);
      touch(); render(); return;
    }
    if (open){
      const i = Number(open.dataset.open);
      openIndex = (openIndex === i) ? -1 : i;
      render(); return;
    }
  });

  // Ввод пишем в данные сразу, без перерисовки: перерисовка сбросила бы
  // каретку в начало поля посреди набора.
  $('#list').addEventListener('input', e=>{
    const t = e.target;
    if (openIndex < 0) return;
    const it = item();
    if (t.dataset.field){
      it[t.dataset.field] = t.type === 'number'
        ? (t.value === '' ? null : Number(t.value))
        : (t.type === 'checkbox' ? t.checked : t.value);
      touch();
    } else if (t.dataset.list){
      it[t.dataset.list] = t.value.split('\n').map(s => s.trim()).filter(Boolean);
      touch();
    } else if (t.dataset.obj){
      const [name, k] = t.dataset.obj.split('|');
      it[name] = it[name] || {};
      it[name][k] = t.value === '' ? 0 : Number(t.value);
      touch();
    }
  });
  $('#list').addEventListener('change', e=>{
    if (e.target.type === 'checkbox' && e.target.dataset.field){
      item()[e.target.dataset.field] = e.target.checked;
      touch();
      if (e.target.dataset.field === 'active') render(); // подпись в списке меняется
    }
  });

  // Загрузка фото
  $('#list').addEventListener('change', async e=>{
    const one = e.target.dataset.uploadOne;
    const many = e.target.dataset.uploadMany;
    if (!one && !many) return;
    const [name, folder] = (one || many).split('|');
    const files = [...e.target.files];
    if (!files.length) return;
    setBusy(true, `Загружаю фото (${files.length})…`);
    try{
      const it = item();
      for (const f of files){
        const r = await uploadImage(f, folder);
        if (one) it[name] = r.path;
        else { it[name] = it[name] || []; it[name].push(r.path); }
        say(`${r.path} — ${Math.round(r.before/1024)} КБ → ${Math.round(r.size/1024)} КБ (${r.width}×${r.height})`, 'ok');
      }
      touch(); render();
      setBusy(false);
    }catch(err){
      setBusy(false); say(err.message, 'err');
    }
  });

  $('#addBtn').addEventListener('click', ()=>{
    const st = state[current];
    st.data.push(SCHEMAS[current].blank());
    openIndex = st.data.length - 1;
    touch(); render();
    $('#list').lastElementChild?.scrollIntoView({ block:'nearest' });
  });

  $('#saveBtn').addEventListener('click', save);
  $('#reloadBtn').addEventListener('click', ()=>{
    if (Object.values(state).some(s => s && s.dirty) &&
        !confirm('Есть несохранённые правки. Перезагрузить и потерять их?')) return;
    openIndex = -1; loadAll();
  });
  $('#logoutBtn').addEventListener('click', logout);
  $('#loginBtn').addEventListener('click', ()=> tryLogin($('#tokenField').value));
  $('#tokenField').addEventListener('keydown', e=>{ if (e.key === 'Enter') tryLogin(e.target.value); });

  // Закрыть вкладку с несохранённым — самая обидная потеря из возможных
  window.addEventListener('beforeunload', e=>{
    if (Object.values(state).some(s => s && s.dirty)){ e.preventDefault(); e.returnValue = ''; }
  });
}

async function save(){
  const name = current, s = SCHEMAS[name], st = state[name];
  if (!st.dirty || busy) return;
  setBusy(true, 'Сохраняю…');
  try{
    const json = JSON.stringify({ [s.key]: st.data }, null, 2) + '\n';
    const res = await ghPut(s.file, utf8ToBase64(json), `Правка раздела «${s.title}» из редактора`, st.sha);
    st.sha = res.content.sha;
    st.dirty = false;
    render();
    setBusy(false);
    say('Сохранено. Сайт обновится через пару минут — GitHub пересобирает его сам.', 'ok');
  }catch(e){
    setBusy(false);
    say(e.message, 'err');
  }
}

/* --------------------------------------------------------------------- */
function init(){
  bindEvents();
  const saved = readToken();
  // Галочку выставляем по тому, где токен нашёлся: иначе вход на чужом
  // компьютере при следующем заходе молча переложил бы его в постоянное
  // хранилище — ровно то, чего человек избегал, снимая её.
  try{
    if (saved && !localStorage.getItem(TOKEN_KEY)) $('#rememberField').checked = false;
  }catch(e){}
  if (saved) tryLogin(saved); else showLogin();
}
init();
