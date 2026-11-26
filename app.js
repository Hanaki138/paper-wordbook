(function () {
  'use strict';

  /* =========================================================
     icons
     ========================================================= */
  const svg = (body) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    body + '</svg>';

  const ICON = {
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>'),
    speaker: svg('<path d="M11 5 6.2 9H3v6h3.2L11 19z"/><path d="M15.2 8.4a5 5 0 0 1 0 7.2"/><path d="M18 6a8.6 8.6 0 0 1 0 12"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>')
  };

  /* =========================================================
     constants
     ========================================================= */
  const KEY = 'paperWordbook.v3';
  const STEPS = [1, 2, 4, 7, 15, 30, 60, 90];
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const GOAL_MIN = 5;
  const GOAL_MAX = 30;
  const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const TRANS_API = 'https://api.mymemory.translated.net/get';
  const THEMES = { paper: '奶油纸', sage: '青瓷', sakura: '樱粉', night: '墨夜', sky: '雾蓝' };
  const THEME_COLOR = { paper: '#f3e9d6', sage: '#e9eee2', sakura: '#f7e8e6', night: '#222a33', sky: '#e7edf0' };
  const CARD_DEFAULT = { paper: '#fbf5e8', sage: '#f7faf0', sakura: '#fff8f5', night: '#2b3540', sky: '#f7fafb' };
  const ACCENTS = ['#b25f4a', '#6c855f', '#5b7d90', '#8b6bb3', '#c48a3f', '#c46a86'];

  /* =========================================================
     tiny utils
     ========================================================= */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const pad2 = (n) => String(n).padStart(2, '0');
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function vibrate(p) {
    if (navigator.vibrate) {
      try { navigator.vibrate(p); } catch (e) { /* noop */ }
    }
  }

  /* =========================================================
     dates
     ========================================================= */
  function keyOf(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function parseKey(k) {
    const p = String(k || '').split('-').map(Number);
    return new Date(p[0] || 2000, (p[1] || 1) - 1, p[2] || 1);
  }
  function shift(k, n) {
    const d = parseKey(k);
    d.setDate(d.getDate() + n);
    return keyOf(d);
  }
  function TODAY() { return keyOf(); }
  function fmtCN(k) {
    const d = parseKey(k);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function fullDate(k) {
    const d = parseKey(k);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
  }
  function dayTitle(k) {
    const t = TODAY();
    if (k === t) return '今天';
    if (k === shift(t, -1)) return '昨天';
    if (k === shift(t, -2)) return '前天';
    return fmtCN(k);
  }
  function monthKicker() {
    const d = new Date();
    return d.getFullYear() + ' · ' + (d.getMonth() + 1) + '月';
  }

  /* =========================================================
     state
     ========================================================= */
  const DEFAULT_SETTINGS = {
    theme: 'paper', goal: 10, autoSpeak: true, texture: true, mode: 'card',
    bgImage: '', bgDim: 15, showStats: false, glassOpacity: 100, glassBlur: 0,
    cardWidth: 100, cardAlign: 'center', cardRadius: 15, cardText: 'left', phonetic: 'inline', showSpeak: true, cardColor: '',
    accent: '', watermark: 'Hanaki'
  };

  function blankSrs() {
    return { stage: 0, due: TODAY(), reps: 0, lapses: 0, last: null };
  }
  function blankState() {
    return {
      version: 4,
      words: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
      days: {},
      recent: [],
      cache: {},
      createdAt: new Date().toISOString()
    };
  }

  function legacySrs(w) {
    const stage = w.status === 'known' ? 6 : w.status === 'learning' ? 2 : 0;
    return {
      stage: stage,
      due: /^\d{4}-\d{2}-\d{2}$/.test(w.nextReview || '') ? w.nextReview : TODAY(),
      reps: Math.max(0, Number(w.reviewed) || 0),
      lapses: 0,
      last: null
    };
  }

  function normalizeWord(raw) {
    const w = raw || {};
    let srs;
    if (w.srs && typeof w.srs === 'object') {
      srs = {
        stage: clamp(Number(w.srs.stage) || 0, 0, 8),
        due: /^\d{4}-\d{2}-\d{2}$/.test(w.srs.due || '') ? w.srs.due : TODAY(),
        reps: Math.max(0, Number(w.srs.reps) || 0),
        lapses: Math.max(0, Number(w.srs.lapses) || 0),
        last: w.srs.last || null
      };
    } else if (w.status) {
      srs = legacySrs(w);
    } else {
      srs = blankSrs();
    }
    return {
      id: w.id || uid(),
      word: String(w.word || '').trim(),
      phonetic: String(w.phonetic || '').trim(),
      meaning: String(w.meaning || '').trim(),
      example: String(w.example || '').trim(),
      exampleZh: String(w.exampleZh || w.examplezh || '').trim(),
      usage: String(w.usage || '').trim(),
      tag: String(w.tag || w.category || '').trim(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(w.date || '') ? w.date : TODAY(),
      createdAt: w.createdAt || new Date().toISOString(),
      srs: srs,
      stats: w.stats && typeof w.stats === 'object'
        ? { correct: Math.max(0, Number(w.stats.correct) || 0), wrong: Math.max(0, Number(w.stats.wrong) || 0) }
        : { correct: 0, wrong: 0 }
    };
  }

  function loadState() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    const st = blankState();
    if (!raw || typeof raw !== 'object') return st;
    st.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
    if (!THEMES[st.settings.theme]) st.settings.theme = 'paper';
    st.settings.goal = clamp(Number(st.settings.goal) || 10, GOAL_MIN, GOAL_MAX);
    if (typeof st.settings.bgImage !== 'string') st.settings.bgImage = '';
    st.settings.showStats = !!st.settings.showStats;
    st.settings.glassOpacity = clamp(Number(st.settings.glassOpacity) || 100, 30, 100);
    st.settings.glassBlur = clamp(Number(st.settings.glassBlur) || 0, 0, 20);
    const cw = Number(st.settings.cardWidth);
    st.settings.cardWidth = clamp(isFinite(cw) && cw ? cw : 100, 60, 100);
    const cr = Number(st.settings.cardRadius);
    st.settings.cardRadius = clamp(isFinite(cr) ? cr : 15, 0, 24);
    if (['left', 'center', 'right'].indexOf(st.settings.cardAlign) < 0) st.settings.cardAlign = 'center';
    if (['left', 'center'].indexOf(st.settings.cardText) < 0) st.settings.cardText = 'left';
    if (['inline', 'below'].indexOf(st.settings.phonetic) < 0) st.settings.phonetic = 'inline';
    st.settings.showSpeak = st.settings.showSpeak !== false;
    st.settings.bgDim = clamp(Number(st.settings.bgDim) || 0, 0, 80);
    if (typeof st.settings.watermark !== 'string') st.settings.watermark = 'Hanaki';
    if (!/^#[0-9a-f]{6}$/i.test(st.settings.accent || '')) st.settings.accent = '';
    st.days = raw.days && typeof raw.days === 'object' ? raw.days : {};
    st.recent = Array.isArray(raw.recent) ? raw.recent.slice(0, 8) : [];
    st.cache = raw.cache && typeof raw.cache === 'object' ? raw.cache : {};
    st.createdAt = raw.createdAt || st.createdAt;
    const list = Array.isArray(raw.words) ? raw.words : [];
    st.words = list.filter((w) => w && w.word && w.meaning).map(normalizeWord);
    if (raw.version !== 4) st.cache = {};
    st.version = 4;
    return st;
  }

  let state = loadState();

  const ui = {
    tab: 'home',
    group: 'date',
    filter: 'all',
    q: '',
    open: null,
    mode: ['card', 'spell', 'listen'].indexOf(state.settings.mode) >= 0 ? state.settings.mode : 'card',
    lookup: null,
    lookupWord: ''
  };

  let storageBlocked = false;
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      storageBlocked = true;
      return false;
    }
  }

  function getWord(id) {
    return state.words.find((w) => w.id === id) || null;
  }

  /* =========================================================
     spaced repetition
     ========================================================= */
  function isDue(w) {
    return !!(w.srs && w.srs.due <= TODAY());
  }
  function dueWords() {
    return state.words
      .filter(isDue)
      .sort((a, b) => (a.srs.due < b.srs.due ? -1 : a.srs.due > b.srs.due ? 1 : a.srs.stage - b.srs.stage));
  }
  function stageOf(w) {
    return w.srs ? w.srs.stage : 0;
  }
  function streak() {
    let n = 0;
    let k = TODAY();
    if (!(state.days[k] && state.days[k].studied)) k = shift(k, -1);
    while (state.days[k] && state.days[k].studied) {
      n++;
      k = shift(k, -1);
    }
    return n;
  }

  function applyGrade(w, grade) {
    const s = w.srs || (w.srs = blankSrs());
    const t = TODAY();
    if (grade === 'again') {
      s.stage = 0;
      s.lapses++;
      s.due = t;
    } else if (grade === 'hard') {
      s.due = shift(t, Math.max(1, Math.round(STEPS[Math.min(s.stage, 7)] * 0.5)));
    } else if (grade === 'easy') {
      const iv = Math.round(STEPS[Math.min(s.stage + 1, 7)] * 1.3);
      s.stage = Math.min(s.stage + 2, 8);
      s.due = shift(t, iv);
    } else {
      const iv = STEPS[Math.min(s.stage, 7)];
      s.stage = Math.min(s.stage + 1, 8);
      s.due = shift(t, iv);
    }
    s.reps++;
    s.last = t;

    w.stats = w.stats || { correct: 0, wrong: 0 };
    if (grade === 'again') w.stats.wrong++;
    else w.stats.correct++;

    const day = state.days[t] || (state.days[t] = { studied: 0, correct: 0 });
    day.studied++;
    if (grade !== 'again') day.correct++;
  }

  /* =========================================================
     theme / render
     ========================================================= */
  function applyTheme() {
    const t = THEMES[state.settings.theme] ? state.settings.theme : 'paper';
    document.documentElement.setAttribute('data-theme', t);
    document.body.classList.toggle('no-texture', !state.settings.texture);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[t]);

    const accent = String(state.settings.accent || '');
    if (/^#[0-9a-f]{6}$/i.test(accent)) {
      document.documentElement.style.setProperty('--accent', accent);
      document.documentElement.style.setProperty('--accent-2', hexToRgba(accent, 0.16));
    } else {
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--accent-2');
    }

    const alpha = clamp(Number(state.settings.glassOpacity) || 100, 30, 100);
    const blur = clamp(Number(state.settings.glassBlur) || 0, 0, 20);
    document.documentElement.style.setProperty('--card-alpha', String(alpha));
    document.documentElement.style.setProperty('--card-blur', blur + 'px');
    document.body.classList.toggle('glass-on', alpha < 100 || blur > 0);

    document.documentElement.style.setProperty('--card-width', clamp(Number(state.settings.cardWidth) || 100, 60, 100) + '%');
    document.documentElement.style.setProperty('--card-radius', clamp(Number(state.settings.cardRadius), 0, 24) + 'px');
    document.body.setAttribute('data-card-align', state.settings.cardAlign || 'center');
    const textCenter = state.settings.cardText === 'center';
    document.documentElement.style.setProperty('--card-text-align', textCenter ? 'center' : 'left');
    document.documentElement.style.setProperty('--card-justify', textCenter ? 'center' : 'flex-start');
    document.body.classList.toggle('phon-below', state.settings.phonetic === 'below');
    document.body.classList.toggle('no-speak', !state.settings.showSpeak);

    const cardColor = String(state.settings.cardColor || '').trim();
    document.documentElement.style.setProperty('--card-bg', cardColor || 'var(--paper-2)');

    const photo = $('#bgPhoto');
    if (photo) {
      const img = state.settings.bgImage;
      if (img) {
        const dim = clamp(Number(state.settings.bgDim) || 0, 0, 80) / 100;
        const tint = hexToRgba(THEME_COLOR[t], dim);
        photo.style.backgroundImage = 'linear-gradient(' + tint + ',' + tint + '), url("' + img + '")';
        photo.classList.add('on');
      } else {
        photo.style.backgroundImage = '';
        photo.classList.remove('on');
      }
    }
  }

  function hexToRgba(hex, alpha) {
    const h = String(hex || '#000000').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function animateView() {
    const v = $('#view');
    if (!v) return;
    v.classList.remove('page-in');
    void v.offsetWidth;
    v.classList.add('page-in');
  }

  function render() {
    applyTheme();
    const v = $('#view');
    if (!v) return;
    if (ui.tab === 'home') v.innerHTML = viewHome();
    else if (ui.tab === 'library') v.innerHTML = viewLibrary();
    else if (ui.tab === 'lookup') v.innerHTML = viewLookup();
    else if (ui.tab === 'study') v.innerHTML = viewStudy();
    else v.innerHTML = viewMe();
    $$('.tab').forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-tab') === ui.tab));
  }

  function switchTab(tab) {
    if (tab === ui.tab) return;
    ui.tab = tab;
    ui.open = null;
    render();
    animateView();
    window.scrollTo(0, 0);
  }

  /* =========================================================
     home + library
     ========================================================= */
  function viewHome() {
    const n = state.words.length;
    const latest = state.words.slice().sort((a, b) => {
      const d = String(b.date || '').localeCompare(String(a.date || ''));
      return d !== 0 ? d : String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    })[0];
    const wm = String(state.settings.watermark || '').trim();
    const rawWord = latest ? latest.word : '记一个词';
    const wordSize = Math.max(26, Math.min(62, Math.floor(320 / (Math.max(4, rawWord.length) * 0.58))));
    return `
  <div class="home-wrap">
  <section class="poster">
    <div class="poster-top">
      <span>${esc(fullDate(TODAY()))}</span>
      <span>${n} 个词</span>
    </div>

    <div class="poster-main">
      <p class="poster-label">${latest ? '最近记录' : 'START HERE'}</p>
      <h1 class="poster-word" style="font-size:${wordSize}px">${esc(rawWord)}</h1>
      ${latest && latest.phonetic ? `<p class="poster-phon">${esc(latest.phonetic)}</p>` : ''}
      <p class="poster-meaning">${esc(latest ? latest.meaning : '遇到就记下，剩下的交给以后。')}</p>
    </div>

    <div class="poster-bottom">
      <button class="poster-add" data-act="open-add"><span>＋</span> 记录新词</button>
      ${n ? `<button class="poster-link" data-act="tab" data-tab="library">词库 ${n}</button>` : ''}
    </div>

    ${wm ? `<p class="watermark">${esc(wm)}</p>` : ''}
  </section>
  </div>`;
  }

  function viewLibrary() {
    const words = state.words;
    const todayCount = words.filter((w) => w.date === TODAY()).length;
    const due = dueWords().length;
    const learned = words.filter((w) => w.srs && w.srs.reps > 0).length;
    return `
  <section class="page-head">
    <div class="kicker">${monthKicker()}</div>
    <div class="head-row">
      <h1>词库</h1>
      <button class="round-btn" data-act="open-add" aria-label="记录新词">${ICON.plus}</button>
    </div>
    <p class="sub">${words.length} 个词 · 按日期或分类整理</p>
  </section>

  ${state.settings.showStats ? `<div class="stat-strip">
    <div class="stat"><b>${todayCount}<em>/${state.settings.goal}</em></b><span>今日新词</span></div>
    <div class="stat"><b>${due}</b><span>待复习</span></div>
    <div class="stat"><b>${learned}</b><span>已学习</span></div>
    <div class="stat"><b>${streak()}</b><span>连续天数</span></div>
  </div>` : ''}

  <div class="lib-tools">
    <div class="seg">
      <button class="${ui.group === 'date' ? 'on' : ''}" data-act="group" data-g="date">按日期</button>
      <button class="${ui.group === 'tag' ? 'on' : ''}" data-act="group" data-g="tag">按分类</button>
    </div>
  </div>

  <div class="search-row">
    ${ICON.search}
    <input id="jSearch" type="text" placeholder="搜索单词、释义或例句" value="${esc(ui.q)}" autocomplete="off" autocorrect="off">
    <button id="jClear" class="clear" data-act="clear-q" aria-label="清空" style="${ui.q ? '' : 'display:none'}">×</button>
  </div>

  <div class="chips">
    ${filterChip('all', '全部')}
    ${filterChip('due', '待复习')}
    ${filterChip('learning', '学习中')}
    ${filterChip('mastered', '已掌握')}
  </div>

  <div id="journalList">${journalListHTML()}</div>
  <div class="list-end"><button class="btn ghost mini" data-act="open-add">＋ 再记一个词</button></div>`;
  }

  function filterChip(id, label) {
    return `<button class="chip ${ui.filter === id ? 'on' : ''}" data-act="filter" data-f="${id}">${label}</button>`;
  }

  function statusOf(w) {
    if (!w.srs || !w.srs.reps) return { label: '新词', cls: 'new' };
    const s = stageOf(w);
    if (s >= 5) return { label: '已掌握', cls: 'ok' };
    if (s >= 3) return { label: '熟悉', cls: 'mid' };
    return { label: '初记', cls: 'low' };
  }

  function dueLabel(w) {
    if (!w.srs || !w.srs.reps) return '尚未复习';
    if (w.srs.due <= TODAY()) return '今天复习';
    const days = Math.round((parseKey(w.srs.due) - parseKey(TODAY())) / 86400000);
    if (days <= 0) return '今天复习';
    if (days === 1) return '明天复习';
    if (days < 30) return days + ' 天后复习';
    return fmtCN(w.srs.due) + ' 复习';
  }

  function filteredWords() {
    let list = state.words.slice();
    if (ui.filter === 'due') list = list.filter(isDue);
    else if (ui.filter === 'learning') list = list.filter((w) => w.srs && w.srs.reps > 0 && stageOf(w) < 5);
    else if (ui.filter === 'mastered') list = list.filter((w) => stageOf(w) >= 5);
    const q = ui.q.trim().toLowerCase();
    if (q) {
      list = list.filter((w) =>
        [w.word, w.meaning, w.example, w.exampleZh, w.usage, w.tag].join(' ').toLowerCase().indexOf(q) >= 0
      );
    }
    return list;
  }

  function journalListHTML() {
    const list = filteredWords();
    if (!list.length) return emptyHTML();

    if (ui.group === 'tag') {
      list.sort((a, b) => {
        const ta = a.tag || '未分类';
        const tb = b.tag || '未分类';
        return ta.localeCompare(tb) || a.word.localeCompare(b.word);
      });
      const order = [];
      const map = {};
      list.forEach((w) => {
        const k = w.tag || '未分类';
        if (!map[k]) { map[k] = []; order.push(k); }
        map[k].push(w);
      });
      return order.map((k) => `<section class="day-group">
        <div class="day-head"><b>${esc(k)}</b><span>${map[k].length} 个词</span><i>${map[k].length}</i></div>
        ${map[k].map(wordCardHTML).join('')}
      </section>`).join('');
    }

    list.sort((a, b) => {
      const d = String(b.date || '').localeCompare(String(a.date || ''));
      return d !== 0 ? d : String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    const order = [];
    const map = {};
    list.forEach((w) => {
      const k = w.date || '';
      if (!map[k]) {
        map[k] = [];
        order.push(k);
      }
      map[k].push(w);
    });
    return order.map((k) => {
      const items = map[k];
      return `<section class="day-group">
        <div class="day-head"><b>${esc(dayTitle(k))}</b><span>${esc(fullDate(k))}</span><i>${items.length}</i></div>
        ${items.map(wordCardHTML).join('')}
      </section>`;
    }).join('');
  }

  function emptyHTML() {
    if (ui.q) {
      return `<div class="empty"><div class="empty-mark">✎</div><h2>没有找到</h2><p>换个关键词，或者清空搜索。</p><button class="btn ghost mini" data-act="clear-q">清空搜索</button></div>`;
    }
    if (ui.filter !== 'all') {
      return `<div class="empty"><div class="empty-mark">✎</div><h2>这里还是空的</h2><p>换个筛选条件看看。</p></div>`;
    }
    return `<div class="empty"><div class="empty-mark">✎</div><h2>还没有词</h2><p>先去记录今天遇见的第一个词。</p><button class="btn ink" data-act="tab" data-tab="home">去记录</button></div>`;
  }

  function wordCardHTML(w) {
    const open = ui.open === w.id;
    const st = statusOf(w);
    const s = w.srs || blankSrs();
    let more = '';
    if (w.example) {
      more += `<p class="ex-en">${esc(w.example)}</p>`;
      if (w.exampleZh) more += `<p class="ex-zh">${esc(w.exampleZh)}</p>`;
    }
    if (w.usage) more += `<p class="usage"><b>用法</b>${esc(w.usage)}</p>`;
    more += `<div class="w-detail-meta"><span>复习 ${s.reps} 次</span><span>${esc(dueLabel(w))}</span></div>`;
    more += `<div class="w-actions">
      <button class="btn mini" data-act="edit" data-id="${w.id}">编辑</button>
      <button class="btn mini" data-act="master" data-id="${w.id}">${stageOf(w) >= 5 ? '取消掌握' : '标记掌握'}</button>
      <button class="btn mini danger" data-act="del" data-id="${w.id}">删除</button>
    </div>`;

    return `<article class="wcard ${open ? 'open' : ''}">
      <div class="w-top" data-act="toggle" data-id="${w.id}">
        <div class="w-text">
          <div class="w-title"><h3>${esc(w.word)}</h3>${w.phonetic ? `<span class="phon">${esc(w.phonetic)}</span>` : ''}</div>
          <p class="w-mean">${esc(w.meaning)}</p>
          <div class="w-meta">
            <span class="pill ${st.cls}">${st.label}</span>
            ${w.tag ? `<span class="tag">${esc(w.tag)}</span>` : ''}
            <span class="due">${esc(dueLabel(w))}</span>
          </div>
        </div>
        <button class="icon-btn" data-act="speak" data-text="${esc(w.word)}" aria-label="朗读">${ICON.speaker}</button>
      </div>
      <div class="w-more"><div class="w-more-in"><div class="w-detail">${more}</div></div></div>
    </article>`;
  }

  function toggleWord(id) {
    ui.open = ui.open === id ? null : id;
    const list = $('#journalList');
    if (list) list.innerHTML = journalListHTML();
  }

  function toggleMaster(id) {
    const w = getWord(id);
    if (!w) return;
    w.srs = w.srs || blankSrs();
    if (w.srs.stage >= 5) {
      w.srs.stage = 3;
      toast('已取消掌握');
    } else {
      w.srs.stage = 6;
      w.srs.reps = Math.max(1, w.srs.reps);
      w.srs.due = shift(TODAY(), 30);
      toast('已标记为掌握');
    }
    save();
    render();
  }

  async function removeWord(id) {
    const w = getWord(id);
    if (!w) return;
    const ok = await ask({
      title: '删除这张词笺？',
      body: '「' + w.word + '」以及它的复习记录会一起删掉。',
      ok: '删除',
      danger: true
    });
    if (!ok) return;
    state.words = state.words.filter((x) => x.id !== id);
    save();
    render();
    toast('已删除');
  }

  /* =========================================================
     lookup
     ========================================================= */
  function viewLookup() {
    return `
  <section class="page-head">
    <div class="kicker">LOOK IT UP</div>
    <h1>查词</h1>
    <p class="sub">查一个词，顺手收进今天的词笺。</p>
  </section>

  <form class="lookup-form" id="lookupForm" autocomplete="off">
    ${ICON.search}
    <input id="lookupInput" name="q" type="search" placeholder="输入英文单词…" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(ui.lookupWord)}">
    <button class="lf-btn" type="submit">查询</button>
  </form>

  <div class="recent" id="recentBox">${recentInnerHTML()}</div>
  <div id="lookupResult">${lookupResultHTML()}</div>
  <p class="lookup-note">释义来自公开在线词典，中文为机器翻译，保存前请核对。</p>`;
  }

  function recentInnerHTML() {
    if (!state.recent.length) return '';
    return '<span>最近</span>' +
      state.recent.map((w) => `<button data-act="recent" data-word="${esc(w)}">${esc(w)}</button>`).join('');
  }

  function refreshRecent() {
    const box = $('#recentBox');
    if (box) box.innerHTML = recentInnerHTML();
  }

  function lookupResultHTML() {
    const l = ui.lookup;
    if (!l) {
      return `<div class="lookup-idle">
        <p class="idle-title">把不认识的词，留在这里。</p>
        <p class="idle-sub">输入单词，看看音标、释义和例句。</p>
        <div class="idle-words">
          ${['serendipity', 'resilient', 'contribute'].map((w) => `<button data-act="recent" data-word="${w}">${w}</button>`).join('')}
        </div>
      </div>`;
    }
    if (l.loading) {
      return `<div class="entry skeleton">
        <div class="sk sk-1"></div><div class="sk sk-2"></div><div class="sk sk-3"></div><div class="sk sk-4"></div>
        <p class="sk-tip">正在查 ${esc(l.word)}…</p>
      </div>`;
    }
    if (l.error) {
      return `<div class="entry error-card">
        <h2 class="err-word">${esc(l.word)}</h2>
        <p class="err-msg">${esc(l.error)}</p>
        <div class="err-actions">
          <button class="btn" data-act="retry-lookup">再试一次</button>
          <button class="btn ink" data-act="manual-add" data-word="${esc(l.word)}">手动记录</button>
        </div>
      </div>`;
    }

    const d = l.data;
    const exists = state.words.some((w) => w.word.toLowerCase() === d.word.toLowerCase());
    return `<article class="entry">
      <div class="entry-head">
        <div>
          <h2>${esc(d.word)}</h2>
          ${d.phonetic ? `<div class="entry-phon">${esc(d.phonetic)}</div>` : ''}
        </div>
        <button class="icon-btn" data-act="speak" data-text="${esc(d.word)}" aria-label="朗读">${ICON.speaker}</button>
      </div>
      ${d.fromYoudao
        ? ''
        : (d.zh
          ? `<p class="entry-zh">${esc((d.senses[0] && posLabel(d.senses[0].pos) ? posLabel(d.senses[0].pos) + ' ' : '') + d.zh)}</p>`
          : (d.zhFailed ? '<p class="entry-zh-pending">中文释义暂未获取，可在下方手动补充。</p>' : '<p class="entry-zh-pending">中文释义生成中…</p>'))}
      <ol class="senses">
        ${d.senses.map((s) => `<li>
          ${s.pos ? `<span class="pos">${esc(posLabel(s.pos))}</span>` : ''}
          ${s.def ? `<p>${esc(s.def)}</p>` : ''}
          ${s.zh ? `<p class="${s.def ? 'sense-zh' : 'sense-main'}">${esc(s.zh)}</p>` : ''}
        </li>`).join('')}
      </ol>
      ${d.example ? `<div class="entry-ex"><p class="ex-en">${esc(d.example)}</p>${d.exampleZh ? `<p class="ex-zh">${esc(d.exampleZh)}</p>` : ''}</div>` : '<div class="entry-ex none"><p>这部词典没有收录例句，可以自己补一句。</p><button class="link-btn" data-act="save-lookup">补一句</button></div>'}
      <button class="btn ink wide" data-act="save-lookup">＋ 收进今日词笺</button>
      ${exists ? '<p class="exists-tip">词笺里已经有这个词了</p>' : ''}
      ${d.source ? `<p class="entry-src">释义 ${esc(d.source)} · 中文 MyMemory</p>` : ''}
    </article>`;
  }

  function renderLookupResultOnly() {
    const box = $('#lookupResult');
    if (box) box.innerHTML = lookupResultHTML();
  }

  /* ---------- network ---------- */
  function timeoutFetch(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal, cache: 'no-store' }).finally(() => clearTimeout(timer));
  }

  async function translate(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    try {
      const res = await timeoutFetch(TRANS_API + '?q=' + encodeURIComponent(t.slice(0, 450)) + '&langpair=en|zh-CN', 9000);
      if (!res.ok) return '';
      const j = await res.json();
      let out = (j && j.responseData && j.responseData.translatedText) || '';
      out = String(out)
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/<[^>]+>/g, '');
      if (!out || /MYMEMORY WARNING|QUERY LENGTH|INVALID|PLEASE SELECT/i.test(out)) return '';
      return out;
    } catch (e) {
      return '';
    }
  }

  async function fetchDatamuse(word) {
    try {
      const res = await timeoutFetch(
        'https://api.datamuse.com/words?sp=' + encodeURIComponent(word) + '&md=dp&max=1',
        8000
      );
      if (!res.ok) return null;
      const arr = await res.json();
      if (!Array.isArray(arr) || !arr.length) return null;
      const hit = arr.find((x) => String(x.word || '').toLowerCase() === word.toLowerCase()) || arr[0];
      if (!hit || !Array.isArray(hit.defs)) return null;
      const senses = [];
      hit.defs.forEach((raw) => {
        const parts = String(raw).split('\t');
        const pos = (parts[0] || '').trim();
        const def = (parts[1] || '').trim();
        if (!def) return;
        if (senses.some((s) => s.def.toLowerCase() === def.toLowerCase())) return;
        if (senses.length < 4) senses.push({ pos: pos, def: def });
      });
      return senses.length ? senses : null;
    } catch (e) {
      return null;
    }
  }

  function posLabel(pos) {
    const p = String(pos || '').trim().toLowerCase();
    const map = {
      noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.',
      pronoun: 'pron.', preposition: 'prep.', conjunction: 'conj.',
      interjection: 'int.', numeral: 'num.', article: 'art.', determiner: 'det.'
    };
    if (map[p]) return map[p];
    if (/^[a-z]+\.$/.test(p)) return p;
    if (p === 'n' || p === 'v' || p === 'adj' || p === 'adv') return p + '.';
    return p ? p + '.' : '';
  }

  function meaningFromData(d) {
    if (!d) return '';
    const first = d.senses && d.senses[0];
    const zh = d.zh || (first && first.zh) || '';
    if (!zh) return '';
    const pos = posLabel(first && first.pos);
    return pos ? pos + ' ' + zh : zh;
  }

  function parseYoudao(data, word) {
    if (!data || !data.ec || !data.ec.word || !data.ec.word[0]) return null;
    const ec = data.ec.word[0];
    const phonetic = ec.usphone ? '/' + ec.usphone + '/' : (ec.ukphone ? '/' + ec.ukphone + '/' : '');
    const senses = [];
    (ec.trs || []).forEach((t) => {
      const tr = t.tr && t.tr[0];
      const lines = tr && tr.l && tr.l.i;
      const arr = Array.isArray(lines) ? lines : (lines ? [lines] : []);
      arr.forEach((line) => {
        const text = String(line).replace(/<[^>]+>/g, '').trim();
        if (!text) return;
        if (/人名|姓氏|地名/.test(text)) return;
        const m = text.match(/^([a-zA-Z]+\.)\s*(.+)$/);
        if (m && m[1].toLowerCase() === 'comb.') return;
        if (m) senses.push({ pos: m[1], def: '', zh: m[2] });
        else senses.push({ pos: '', def: '', zh: text });
      });
    });
    if (!senses.length) return null;

    let example = '';
    let exampleZh = '';
    const pairs = data.blng_sents_part && data.blng_sents_part['sentence-pair'];
    if (Array.isArray(pairs)) {
      const p = pairs.find((x) => x.sentence && x['sentence-translation']) || pairs[0];
      if (p) {
        example = String(p.sentence).replace(/<[^>]+>/g, '');
        exampleZh = String(p['sentence-translation'] || '').replace(/<[^>]+>/g, '');
      }
    }
    let displayWord = word;
    if (ec['return-phrase']) {
      displayWord = typeof ec['return-phrase'] === 'string'
        ? ec['return-phrase']
        : (ec['return-phrase'].l && ec['return-phrase'].l.i) || word;
    }

    return {
      word: displayWord,
      phonetic: phonetic,
      senses: senses.slice(0, 6),
      zh: '',
      example: example,
      exampleZh: exampleZh,
      source: '有道',
      fromYoudao: true
    };
  }

  async function fetchYoudao(word) {
    const url = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(word);
    const cap = window.Capacitor;
    const http = cap && cap.Plugins && cap.Plugins.CapacitorHttp;
    let data = null;
    try {
      if (http) {
        const res = await http.get({
          url: url,
          responseType: 'json',
          connectTimeout: 8000,
          readTimeout: 8000
        });
        data = res.data;
        if (typeof data === 'string') data = JSON.parse(data);
      } else {
        const res = await timeoutFetch(url, 8000);
        if (!res.ok) return null;
        data = await res.json();
      }
    } catch (e) {
      return null;
    }
    return parseYoudao(data, word);
  }

  async function fetchDict(word) {
    let res;
    try {
      res = await timeoutFetch(DICT_API + encodeURIComponent(word), 12000);
    } catch (e) {
      return null;
    }
    if (!res.ok) return null;
    let list;
    try {
      list = await res.json();
    } catch (e) {
      return null;
    }
    if (!Array.isArray(list) || !list.length) return null;

    const entry = list.find((x) => String(x.word || '').toLowerCase() === word.toLowerCase()) || list[0];
    const phonetic = entry.phonetic ||
      (entry.phonetics || []).map((p) => p.text).filter(Boolean)[0] || '';
    const meanings = (entry.meanings || []).slice(0, 4);
    const senses = [];
    meanings.forEach((m) => {
      const def = (m.definitions || [])[0];
      if (def && def.definition) senses.push({ pos: m.partOfSpeech || '', def: def.definition });
    });

    let example = '';
    for (let i = 0; i < meanings.length && !example; i++) {
      const defs = meanings[i].definitions || [];
      for (let j = 0; j < defs.length; j++) {
        if (defs[j].example) { example = defs[j].example; break; }
      }
    }

    return { word: entry.word || word, phonetic: phonetic, senses: senses, example: example };
  }

  async function fetchEntry(word) {
    const [dict, dm] = await Promise.all([fetchDict(word), fetchDatamuse(word)]);
    if (!dict && !dm) {
      throw new Error('几个词典都没有找到这个词，检查拼写，或点「手动记录」自己填。');
    }

    const senses = [];
    if (dm) dm.forEach((s) => senses.push(s));
    if (dict && dict.senses) {
      dict.senses.forEach((s) => {
        if (!senses.some((x) => x.def.toLowerCase() === s.def.toLowerCase())) senses.push(s);
      });
    }
    if (!senses.length) throw new Error('没有找到这个词的释义，可以手动记录。');

    return {
      word: (dict && dict.word) || word,
      phonetic: (dict && dict.phonetic) || '',
      senses: senses.slice(0, 4),
      zh: '',
      example: (dict && dict.example) || '',
      exampleZh: '',
      source: [dict ? 'Wiktionary' : '', dm ? 'Datamuse' : ''].filter(Boolean).join(' + ')
    };
  }

  async function enrichEntry(data) {
    if (!data) return data;
    const first = data.senses[0];
    const jobs = [
      data.zh ? Promise.resolve(data.zh) : translate(data.word),
      first && !first.zh ? translate(first.def) : Promise.resolve(first ? first.zh || '' : ''),
      data.example && !data.exampleZh ? translate(data.example) : Promise.resolve(data.exampleZh || '')
    ];
    const out = await Promise.all(jobs);
    const wordZh = out[0];
    const defZh = out[1];
    if (wordZh) data.zh = wordZh;
    else if (defZh) data.zh = defZh;
    if (first && defZh) first.zh = defZh;
    if (out[2]) data.exampleZh = out[2];
    if (!data.zh) data.zhFailed = true;
    if (data.zh) {
      state.cache[data.word.toLowerCase()] = { t: Date.now(), data: data };
      trimCache();
      save();
    }
    return data;
  }

  async function getEntry(raw) {
    const word = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!word) throw new Error('先输入一个单词');
    const k = word.toLowerCase();
    const hit = state.cache[k];
    if (hit && hit.data && Date.now() - hit.t < 14 * 86400000) return hit.data;

    const yd = await fetchYoudao(word);
    if (yd) {
      state.cache[k] = { t: Date.now(), data: yd };
      trimCache();
      save();
      return yd;
    }

    const data = await fetchEntry(word);
    if (data.zh) {
      state.cache[k] = { t: Date.now(), data: data };
      trimCache();
      save();
    }
    return data;
  }

  function trimCache() {
    const keys = Object.keys(state.cache);
    if (keys.length <= 80) return;
    keys.sort((a, b) => (state.cache[b].t || 0) - (state.cache[a].t || 0));
    keys.slice(80).forEach((k) => { delete state.cache[k]; });
  }

  async function lookupWord(raw) {
    const word = String(raw || '').trim();
    if (!word) { toast('先输入一个单词'); return; }
    ui.lookupWord = word;
    ui.lookup = { word: word, loading: true };
    renderLookupResultOnly();

    try {
      const data = await getEntry(word);
      ui.lookup = { word: word, data: data };
      state.recent = [data.word]
        .concat(state.recent.filter((w) => w.toLowerCase() !== data.word.toLowerCase()))
        .slice(0, 8);
      save();
      const input = $('#lookupInput');
      if (input) input.value = data.word;
      refreshRecent();
      renderLookupResultOnly();
      if (!data.zh && !data.fromYoudao) {
        enrichEntry(data).then(() => {
          if (ui.lookup && ui.lookup.data === data) renderLookupResultOnly();
        });
      }
      return;
    } catch (e) {
      ui.lookup = { word: word, error: (e && e.message) || '查询失败，请检查网络。' };
    }
    renderLookupResultOnly();
  }

  function saveFromLookup() {
    if (!ui.lookup || !ui.lookup.data) return;
    const d = ui.lookup.data;
    openAdd({
      word: d.word,
      phonetic: d.phonetic,
      meaning: meaningFromData(d),
      example: d.example || '',
      exampleZh: d.exampleZh || '',
      fromLookup: true
    });
  }

  /* =========================================================
     study home
     ========================================================= */
  function viewStudy() {
    if (!state.words.length) {
      return `<section class="page-head">
        <div class="kicker">DAILY PRACTICE</div>
        <h1>背诵</h1>
        <p class="sub">把翻过的词，再见面三次。</p>
      </section>
      <div class="empty big-empty">
        <div class="empty-mark">✿</div>
        <h2>还没有可以背的词</h2>
        <p>先在词笺里记几个词，再回来和它们见面。</p>
        <button class="btn ink" data-act="tab" data-tab="home">去记录</button>
      </div>`;
    }

    const due = dueWords();
    const today = state.days[TODAY()] || { studied: 0, correct: 0 };
    const total = today.studied + due.length;
    const pct = total ? Math.round((today.studied / total) * 100) : 0;
    const week = weekData();

    return `<section class="page-head">
      <div class="kicker">DAILY PRACTICE</div>
      <h1>背诵</h1>
      <p class="sub">把翻过的词，再见面三次。</p>
    </section>

    <div class="plan">
      <div class="plan-top">
        <div>
          <p class="plan-kicker">TODAY</p>
          <h2>${due.length ? due.length + ' 个词<br>在等你' : '今天没有<br>到期的词'}</h2>
          <p class="plan-sub">${due.length ? '抽几分钟，和它们再见一面。' : '去词笺记几个新词，或自由练习。'}</p>
        </div>
        <div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
      </div>
      <div class="plan-actions">
        <button class="btn ink wide" data-act="start">${due.length ? '开始背诵' : '自由练习'}</button>
      </div>
    </div>

    <div class="mode-pick">
      <p class="label">练习方式</p>
      <div class="modes">
        ${modeBtn('card', '翻卡', '看词想义')}
        ${modeBtn('spell', '拼写', '看义写词')}
        ${modeBtn('listen', '听写', '听音写词')}
      </div>
    </div>

    <div class="week">
      <div class="week-head"><b>最近七天</b><span>共 ${week.total} 词</span></div>
      <div class="week-days">${week.html}</div>
    </div>
    <p class="study-note">认识就往后放，忘了就明天再见。间隔会自己变长。</p>`;
  }

  function modeBtn(mode, title, sub) {
    return `<button class="mode ${ui.mode === mode ? 'on' : ''}" data-act="mode" data-mode="${mode}"><b>${title}</b><span>${sub}</span></button>`;
  }

  function weekData() {
    let total = 0;
    let html = '';
    for (let i = 6; i >= 0; i--) {
      const k = shift(TODAY(), -i);
      const rec = state.days[k];
      const n = rec ? rec.studied || 0 : 0;
      total += n;
      const d = parseKey(k);
      html += `<div class="wd ${n ? 'on' : ''} ${i === 0 ? 'today' : ''}"><span>${WEEK[d.getDay()].slice(1)}</span><i>${n || ''}</i></div>`;
    }
    return { total: total, html: html };
  }

  function setMode(m) {
    if (m !== 'card' && m !== 'spell' && m !== 'listen') return;
    ui.mode = m;
    state.settings.mode = m;
    save();
    render();
  }

  /* =========================================================
     session
     ========================================================= */
  let session = null;

  function currentWord() {
    if (!session) return null;
    return getWord(session.queue[session.idx]);
  }

  function startSession(mode, free) {
    let ids = [];
    if (!free) {
      const due = dueWords();
      if (due.length) ids = due.slice(0, 30).map((w) => w.id);
    }
    if (!ids.length) {
      const pool = state.words.slice().sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );
      ids = pool.slice(0, 10).map((w) => w.id);
    }
    if (!ids.length) { toast('先在词笺里记几个词吧'); return; }

    session = {
      mode: mode || ui.mode,
      queue: ids,
      idx: 0,
      requeued: {},
      results: [],
      start: Date.now(),
      revealed: false,
      feedback: null,
      hint: false,
      done: null
    };
    document.body.style.overflow = 'hidden';
    renderSession();
    autoSpeak();
  }

  function renderSession() {
    const root = $('#sessionRoot');
    if (!root) return;
    if (!session) { root.innerHTML = ''; return; }
    if (session.done) { root.innerHTML = sessionDoneHTML(); return; }
    const w = currentWord();
    if (!w) { exitSession(); return; }

    const total = session.queue.length;
    const pct = Math.round((session.idx / total) * 100);
    const body = session.mode === 'card' ? cardFace(w) : session.mode === 'spell' ? spellFace(w) : listenFace(w);

    root.innerHTML = `<div class="session">
      <header class="s-head">
        <button class="s-close" data-act="exit" aria-label="退出">${ICON.close}</button>
        <div class="s-bar"><i style="width:${pct}%"></i></div>
        <span class="s-count">${session.idx + 1} / ${total}</span>
      </header>
      <div class="s-body">${body}</div>
      <p class="s-foot">${session.mode === 'card' ? '空格翻开 · 1 忘了 · 2 模糊 · 3 记得' : '回车提交 · Esc 退出'}</p>
    </div>`;
  }

  function cardFace(w) {
    if (!session.revealed) {
      return `<div class="study-card" data-act="reveal">
        <p class="s-kicker">WORD</p>
        <h2 class="s-word">${esc(w.word)}</h2>
        ${w.phonetic ? `<p class="s-phon">${esc(w.phonetic)}</p>` : ''}
        <button class="s-sound" data-act="speak" data-text="${esc(w.word)}">${ICON.speaker} 发音</button>
        <p class="s-tap">轻点卡片，翻开释义</p>
      </div>`;
    }
    return `<div class="study-card" data-act="reveal">
      <p class="s-kicker">MEANING</p>
      <p class="s-back-word">${esc(w.word)}</p>
      <p class="s-meaning">${esc(w.meaning)}</p>
      ${w.example ? `<div class="s-ex"><p>${esc(w.example)}</p>${w.exampleZh ? `<p class="zh">${esc(w.exampleZh)}</p>` : ''}</div>` : ''}
      ${w.usage ? `<p class="s-usage">${esc(w.usage)}</p>` : ''}
      <div class="s-actions">
        <button class="grade again" data-act="grade" data-g="again">忘了</button>
        <button class="grade hard" data-act="grade" data-g="hard">模糊</button>
        <button class="grade good" data-act="grade" data-g="good">记得</button>
      </div>
    </div>`;
  }

  function blankExample(text, word) {
    const src = String(text || '');
    const w = String(word || '').trim().toLowerCase();
    if (!src || !w) return src;
    let stem = w.replace(/[ey]$/, '');
    if (stem.length < 3) stem = w;
    try {
      const safe = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return src.replace(new RegExp('\\b' + safe + '[a-z]*\\b', 'gi'), '____');
    } catch (e) {
      return src;
    }
  }

  function quizFormHTML(fb) {
    return `<form class="quiz-form" id="spellForm" autocomplete="off">
      <input id="spellInput" type="text" placeholder="输入单词…" autocapitalize="off" autocorrect="off" spellcheck="false"
        value="${fb ? esc(fb.answer) : ''}"${fb ? ' disabled' : ''}>
      <button class="btn ink" type="submit"${fb ? ' disabled' : ''}>检查</button>
    </form>`;
  }

  function spellFace(w) {
    const fb = session.feedback;
    const example = w.example ? blankExample(w.example, w.word) : '';
    return `<div class="study-card quiz">
      <p class="s-kicker">SPELL</p>
      <p class="quiz-hint">看着释义，写出这个单词</p>
      <p class="quiz-meaning">${esc(w.meaning)}</p>
      ${example ? `<p class="quiz-ex">${esc(example)}</p>` : ''}
      ${w.phonetic ? `<p class="quiz-phon">${esc(w.phonetic)}</p>` : ''}
      ${quizFormHTML(fb)}
      ${fb ? feedbackHTML(w, fb) : ''}
    </div>`;
  }

  function listenFace(w) {
    const fb = session.feedback;
    return `<div class="study-card quiz">
      <p class="s-kicker">LISTEN</p>
      <button class="listen-big" data-act="replay">${ICON.speaker}<span>再听一次</span></button>
      <p class="quiz-hint" style="text-align:center">听发音，写下你听到的单词</p>
      ${session.hint
        ? `<p class="quiz-meaning" style="text-align:center">${esc(w.meaning)}</p>`
        : '<button class="ghost-link" data-act="hint">需要提示？看中文释义</button>'}
      ${quizFormHTML(fb)}
      ${fb ? feedbackHTML(w, fb) : ''}
    </div>`;
  }

  function feedbackHTML(w, fb) {
    return `<div class="feedback ${fb.ok ? 'ok' : 'bad'}">
      <b>${fb.ok ? '写对了' : '差一点'}</b>
      <p class="spell">${esc(w.word)}${w.phonetic ? ` <span class="phon">${esc(w.phonetic)}</span>` : ''}</p>
      <p class="fb-mean">${esc(w.meaning)}</p>
      <button class="btn ink wide" data-act="next">${fb.ok ? '下一个' : '记住了，继续'}</button>
    </div>`;
  }

  function autoSpeak() {
    if (!session) return;
    const w = currentWord();
    if (!w) return;
    if (session.mode === 'spell') return;
    if (session.mode === 'card' && !state.settings.autoSpeak) return;
    speak(w.word, session.mode === 'listen' ? 0.78 : 0.86);
  }

  function recordAnswer(grade) {
    const w = currentWord();
    if (!w) return;
    applyGrade(w, grade);
    session.results.push(grade);
    if (grade === 'again' && !session.requeued[w.id]) {
      session.requeued[w.id] = true;
      session.queue.push(w.id);
    }
    save();
  }

  function gradeCard(g) {
    if (!session || session.feedback) return;
    recordAnswer(g);
    vibrate(8);
    advance();
  }

  function revealCard() {
    if (!session || session.revealed) return;
    session.revealed = true;
    renderSession();
    vibrate(4);
  }

  function checkSpell() {
    if (!session || session.feedback) return;
    const input = $('#spellInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) { input.focus(); return; }
    const w = currentWord();
    if (!w) return;
    const ok = normWord(val) === normWord(w.word);
    session.feedback = { ok: ok, answer: val };
    recordAnswer(ok ? 'good' : 'again');
    renderSession();
    vibrate(ok ? 8 : [10, 40, 10]);
  }

  function normWord(s) {
    return String(s).toLowerCase().replace(/[^a-z]/g, '');
  }

  function advance() {
    if (!session) return;
    session.feedback = null;
    session.revealed = false;
    session.hint = false;
    session.idx++;
    if (session.idx >= session.queue.length) {
      finishSession();
      return;
    }
    renderSession();
    autoSpeak();
  }

  function finishSession() {
    const res = session.results;
    const total = res.length;
    const good = res.filter((g) => g === 'good' || g === 'easy').length;
    const secs = Math.max(1, Math.round((Date.now() - session.start) / 1000));
    session.done = { total: total, good: good, secs: secs };
    renderSession();
  }

  function sessionDoneHTML() {
    const d = session.done;
    const m = Math.floor(d.secs / 60);
    const s = d.secs % 60;
    const dur = m ? m + ' 分 ' + s + ' 秒' : s + ' 秒';
    const pct = d.total ? Math.round((d.good / d.total) * 100) : 0;
    const line = pct >= 80 ? '记得很牢，继续保持。' : pct >= 50 ? '比刚才更熟了一点。' : '没关系，明天再见一次。';
    return `<div class="session done">
      <div class="done-inner">
        <p class="done-mark">✿</p>
        <h2>这一页，翻完了。</h2>
        <p class="done-sub">${line}</p>
        <div class="done-stats">
          <div><b>${d.total}</b><span>见过</span></div>
          <div><b>${pct}%</b><span>记住</span></div>
          <div><b>${esc(dur)}</b><span>用时</span></div>
        </div>
        <div class="done-actions">
          <button class="btn ink wide" data-act="again-session">再来一组</button>
          <button class="btn ghost wide" data-act="exit">回到词笺</button>
        </div>
      </div>
    </div>`;
  }

  function exitSession() {
    session = null;
    document.body.style.overflow = '';
    const root = $('#sessionRoot');
    if (root) root.innerHTML = '';
    render();
  }

  function restartSession() {
    const m = session ? session.mode : ui.mode;
    exitSession();
    startSession(m, false);
  }

  /* =========================================================
     word sheet
     ========================================================= */
  let draft = null;

  function openAdd(prefill) {
    draft = Object.assign({
      id: null,
      word: '',
      phonetic: '',
      meaning: '',
      example: '',
      exampleZh: '',
      usage: '',
      tag: '',
      date: TODAY(),
      fromLookup: false
    }, prefill || {});
    renderSheet();
  }

  function openEdit(id) {
    const w = getWord(id);
    if (!w) return;
    draft = {
      id: w.id,
      word: w.word,
      phonetic: w.phonetic,
      meaning: w.meaning,
      example: w.example,
      exampleZh: w.exampleZh,
      usage: w.usage,
      tag: w.tag,
      date: w.date,
      fromLookup: false
    };
    renderSheet();
  }

  function closeSheet() {
    draft = null;
    document.body.style.overflow = '';
    const root = $('#sheetRoot');
    if (root) root.innerHTML = '';
  }

  function renderSheet() {
    const root = $('#sheetRoot');
    if (!root || !draft) return;
    const d = draft;
    root.innerHTML = `<div class="sheet-mask" data-act="close-sheet"></div>
      <section class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-grab"></div>
        <header class="sheet-head">
          <h2>${d.id ? '修改词笺' : '新词笺'}</h2>
          <button class="icon-btn" data-act="close-sheet" aria-label="关闭">${ICON.close}</button>
        </header>
        <form class="sheet-form" id="wordForm" autocomplete="off" novalidate>
          <div class="sheet-scroll">
            <div class="field">
              <label>英文单词 <i>*</i></label>
              <div class="word-input">
                <input id="fWord" value="${esc(d.word)}" placeholder="contribute" autocapitalize="off" autocorrect="off" spellcheck="false">
                <button type="button" class="btn" data-act="sheet-lookup">查询</button>
              </div>
            </div>
            <div class="field-row">
              <div class="field"><label>音标</label><input id="fPhonetic" value="${esc(d.phonetic)}" placeholder="/kənˈtrɪbjuːt/"></div>
              <div class="field"><label>分类</label><input id="fTag" value="${esc(d.tag)}" placeholder="四级 / Unit 1"></div>
            </div>
            <div class="field"><label>中文释义 <i>*</i></label><textarea id="fMeaning" rows="2" placeholder="贡献；促成">${esc(d.meaning)}</textarea></div>
            <div class="field"><label>英文例句</label><textarea id="fExample" rows="2" placeholder="This may contribute to success.">${esc(d.example)}</textarea></div>
            <div class="field"><label>例句翻译</label><textarea id="fExampleZh" rows="2" placeholder="这可能有助于成功。">${esc(d.exampleZh)}</textarea></div>
            <div class="field"><label>用法 / 搭配</label><textarea id="fUsage" rows="2" placeholder="contribute to + 名词 / doing">${esc(d.usage)}</textarea></div>
            <div class="field"><label>学习日期</label><input type="date" id="fDate" value="${esc(d.date)}"></div>
          </div>
          <div class="sheet-actions">
            <button type="button" class="btn ghost" data-act="close-sheet">取消</button>
            <button type="button" class="btn ink" data-act="save-word">保存</button>
          </div>
        </form>
      </section>`;
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const el = $('#fWord');
      if (el && !d.id) el.focus({ preventScroll: true });
    }, 140);
  }

  function invalidField(el, msg) {
    if (!el) { toast(msg); return; }
    el.classList.add('is-invalid');
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    toast(msg);
    setTimeout(() => el.classList.remove('is-invalid'), 1800);
  }

  function saveDraft() {
    if (!draft) return;
    const wordInput = $('#fWord');
    const meaningInput = $('#fMeaning');
    if (!wordInput || !meaningInput) return;
    const word = wordInput.value.trim();
    const meaning = meaningInput.value.trim();
    if (!word) { invalidField(wordInput, '先写下英文单词'); return; }
    if (!meaning) { invalidField(meaningInput, '补充一下中文释义'); return; }

    const data = {
      word: word,
      phonetic: $('#fPhonetic').value.trim(),
      tag: $('#fTag').value.trim(),
      meaning: meaning,
      example: $('#fExample').value.trim(),
      exampleZh: $('#fExampleZh').value.trim(),
      usage: $('#fUsage').value.trim(),
      date: $('#fDate').value || TODAY()
    };

    const editing = !!draft.id;
    const wasLookup = draft.fromLookup;

    if (editing) {
      const w = getWord(draft.id);
      if (w) Object.assign(w, data);
    } else {
      state.words.push(normalizeWord(Object.assign({
        id: uid(),
        createdAt: new Date().toISOString()
      }, data)));
    }

    const ok = save();
    closeSheet();
    ui.q = '';
    ui.filter = 'all';
    if (wasLookup) {
      ui.tab = 'library';
      ui.lookupWord = '';
      animateView();
    }
    render();
    window.scrollTo(0, 0);
    toast(editing ? '已更新' : (ok ? '已收进词库' : '已收进词库（本次有效，未能写入本机存储）'));
  }

  async function sheetLookup() {
    const input = $('#fWord');
    const word = input ? input.value.trim() : '';
    if (!word) { toast('先输入单词'); if (input) input.focus(); return; }

    const btn = $('[data-act="sheet-lookup"]');
    if (btn) { btn.disabled = true; btn.textContent = '查询中'; }

    try {
      const d = await getEntry(word);
      if (!d.fromYoudao) await enrichEntry(d);
      const fill = (id, val) => {
        const el = $('#' + id);
        if (el && !el.value.trim() && val) el.value = val;
      };
      fill('fPhonetic', d.phonetic);
      fill('fMeaning', meaningFromData(d));
      fill('fExample', d.example);
      fill('fExampleZh', d.exampleZh);
      toast(d.zh ? '已填入，核对后保存' : '只查到英文释义，中文请补充');
    } catch (e) {
      toast((e && e.message) || '查询失败');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '查询'; }
    }
  }

  /* =========================================================
     me / settings
     ========================================================= */
  function viewMe() {
    const s = state.settings;
    return `<section class="page-head">
      <div class="kicker">MY DESK</div>
      <h1>我的</h1>
      <p class="sub">把手账调成你喜欢的样子。</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>手账主题</h2><span>THEME</span></div>
      <div class="theme-row">
        ${Object.keys(THEMES).map((k) => `<button class="theme ${s.theme === k ? 'on' : ''}" data-act="theme" data-theme="${k}">
          <i class="sw ${k}"></i><span>${THEMES[k]}</span>
        </button>`).join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>背景</h2><span>BACKDROP</span></div>
      <div class="bg-preview ${s.bgImage ? 'has-image' : ''}">
        ${s.bgImage ? `<img src="${esc(s.bgImage)}" alt="">` : '<span>现在的纸色</span>'}
      </div>
      <div class="bg-buttons">
        <button class="btn" data-act="pick-bg">上传背景图</button>
        ${s.bgImage ? '<button class="btn ghost" data-act="clear-bg">清除</button>' : ''}
      </div>
      <div class="set-row">
        <div><b>背景遮罩</b><small>0 最清晰，80 几乎看不见</small></div>
        <input class="range" id="bgDim" type="range" min="0" max="80" step="1" value="${clamp(Number(s.bgDim) || 0, 0, 80)}" ${s.bgImage ? '' : 'disabled'}>
      </div>
      <p class="fine">图片会压缩后保存在本机，不会上传；换手机记得先导出备份。</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>卡片质感</h2><span>GLASS</span></div>
      <div class="set-row">
        <div><b>卡片透明度</b><small>让背景透出来一点</small></div>
        <input class="range" id="glassOpacity" type="range" min="30" max="100" step="1" value="${clamp(Number(s.glassOpacity) || 100, 30, 100)}">
      </div>
      <div class="set-row">
        <div><b>磨砂</b><small>毛玻璃模糊</small></div>
        <input class="range" id="glassBlur" type="range" min="0" max="20" step="1" value="${clamp(Number(s.glassBlur) || 0, 0, 20)}">
      </div>
      <p class="fine">100 + 0 就是原来的纸片；调低透明度，背景图会透出来。</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>个性</h2><span>PERSONAL</span></div>
      <div class="set-row">
        <div><b>签名色</b><small>按钮、标签和高亮</small></div>
        <div class="accent-row">
          <button class="accent-dot default ${!s.accent ? 'on' : ''}" data-act="accent" data-val="">默认</button>
          ${ACCENTS.map((a) => `<button class="accent-dot ${s.accent === a ? 'on' : ''}" style="background:${a}" data-act="accent" data-val="${a}" aria-label="${a}"></button>`).join('')}
        </div>
      </div>
      <div class="set-row">
        <div><b>水印</b><small>首页右下角的签名</small></div>
        <input class="text-input" id="watermarkInput" value="${esc(s.watermark || '')}" maxlength="24" placeholder="Hanaki">
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>卡片样式</h2><span>CARD</span></div>
      <div class="card-preview">
        <article class="wcard preview-card">
          <div class="w-top">
            <div class="w-text">
              <div class="w-title"><h3>serendipity</h3><span class="phon">/ˌserənˈdɪpəti/</span></div>
              <p class="w-mean">n. 意外发现美好事物的运气</p>
              <div class="w-meta"><span class="pill mid">熟悉</span><span class="due">明天复习</span></div>
            </div>
            <button class="icon-btn" type="button" tabindex="-1" aria-hidden="true">${ICON.speaker}</button>
          </div>
        </article>
      </div>
      <div class="set-row">
        <div><b>卡片宽度</b><small>60% – 100%，窄一点能露背景</small></div>
        <input class="range" id="cardWidth" type="range" min="60" max="100" step="1" value="${clamp(Number(s.cardWidth) || 100, 60, 100)}">
      </div>
      ${segRow('cardAlign', '左右位置', '窄卡片时靠哪边', [
        { v: 'left', t: '左' }, { v: 'center', t: '中' }, { v: 'right', t: '右' }
      ], s.cardAlign)}
      <div class="set-row">
        <div><b>圆角</b><small>0 是直角，24 最圆</small></div>
        <input class="range" id="cardRadius" type="range" min="0" max="24" step="1" value="${clamp(Number(s.cardRadius), 0, 24)}">
      </div>
      <div class="set-row">
        <div><b>卡片底色</b><small>默认跟随主题纸色</small></div>
        <div class="color-wrap">
          <input class="color-input" id="cardColor" type="color" value="${s.cardColor || CARD_DEFAULT[s.theme] || '#fbf5e8'}">
          <button class="btn mini" type="button" data-act="reset-card-color">默认</button>
        </div>
      </div>
      ${segRow('cardText', '文字对齐', '单词、释义和标签', [
        { v: 'left', t: '左' }, { v: 'center', t: '中' }
      ], s.cardText)}
      ${segRow('phonetic', '音标位置', '音标显示在哪', [
        { v: 'inline', t: '同行' }, { v: 'below', t: '下一行' }
      ], s.phonetic)}
      ${switchRow('showSpeak', '发音按钮', '卡片右上角的喇叭', s.showSpeak)}
    </section>

    <section class="card">
      <div class="card-head"><h2>偏好</h2><span>PREFERENCE</span></div>
      ${switchRow('autoSpeak', '自动发音', '进入单词时自动朗读', s.autoSpeak)}
      ${switchRow('showStats', '词库统计', '今日新词、待复习、连续天数', s.showStats)}
      ${switchRow('texture', '纸张纹理', '纸面的细颗粒质感', s.texture)}
    </section>

    <section class="card">
      <div class="card-head"><h2>数据</h2><span>DATA</span></div>
      <div class="data-actions">
        <button class="btn" data-act="export">导出备份</button>
        <button class="btn" data-act="import">导入备份</button>
        <button class="btn danger" data-act="reset">清空数据</button>
      </div>
      <p class="fine">共 ${state.words.length} 张词笺 · 数据只保存在这台设备。换手机或清理浏览器前，记得先导出。</p>
      ${storageBlocked ? '<p class="warn-line">当前浏览器禁止本地存储：记录只在本次打开有效，请检查隐私设置。</p>' : ''}
    </section>

    <section class="card about">
      <p class="about-title">纸间词笺</p>
      <p>一天一页。</p>
      <p class="fine">v3.1 · 查词需要联网</p>
    </section>`;
  }

  function switchRow(key, title, sub, on) {
    return `<div class="set-row">
      <div><b>${title}</b><small>${sub}</small></div>
      <button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" data-act="switch" data-key="${key}"><i></i></button>
    </div>`;
  }

  function segRow(key, title, sub, options, current) {
    return `<div class="set-row">
      <div><b>${title}</b><small>${sub}</small></div>
      <div class="seg small">
        ${options.map((o) => `<button data-act="set" data-key="${key}" data-val="${o.v}" class="${current === o.v ? 'on' : ''}">${o.t}</button>`).join('')}
      </div>
    </div>`;
  }

  function setTheme(t) {
    if (!THEMES[t]) return;
    state.settings.theme = t;
    save();
    applyTheme();
    render();
  }

  function changeGoal(d) {
    state.settings.goal = clamp((Number(state.settings.goal) || 10) + d, GOAL_MIN, GOAL_MAX);
    save();
    render();
  }

  function toggleSetting(key) {
    state.settings[key] = !state.settings[key];
    save();
    applyTheme();
    render();
  }

  function compressImage(file, max, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          try {
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (e) {
            reject(e);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  let crop = null;

  function pickBackground() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => openCropper(String(reader.result));
      reader.onerror = () => toast('这张图片读取失败，换一张试试');
      reader.readAsDataURL(f);
    };
    input.click();
  }

  function openCropper(src) {
    const root = $('#cropRoot');
    if (!root) return;
    const img = new Image();
    img.onerror = () => toast('这张图片打不开，换一张试试');
    img.onload = () => {
      root.innerHTML = `<div class="crop-mask">
        <section class="crop-panel">
          <header class="crop-head">
            <h3>调整背景</h3>
            <button class="icon-btn" data-act="crop-cancel" aria-label="关闭">${ICON.close}</button>
          </header>
          <div class="crop-stage" id="cropStage">
            <img id="cropImg" src="${esc(src)}" alt="">
            <div class="crop-frame"></div>
          </div>
          <div class="crop-zoom"><span>缩放</span><input id="cropZoom" type="range" min="100" max="300" step="1" value="100"></div>
          <p class="crop-hint">拖动图片选择范围，框内就是首页看到的画面</p>
          <div class="crop-actions">
            <button class="btn ghost" data-act="crop-cancel">取消</button>
            <button class="btn ink" data-act="crop-ok">使用这张</button>
          </div>
        </section>
      </div>`;
      document.body.style.overflow = 'hidden';

      const stage = $('#cropStage');
      const el = $('#cropImg');
      const rect = stage.getBoundingClientRect();
      const base = Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
      crop = {
        img: img, el: el, stage: stage,
        stageW: rect.width, stageH: rect.height,
        base: base, zoom: 1, x: 0, y: 0
      };
      applyCrop();

      let drag = null;
      stage.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY, ox: crop.x, oy: crop.y };
        try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      });
      stage.addEventListener('pointermove', (e) => {
        if (!drag || !crop) return;
        crop.x = drag.ox + (e.clientX - drag.x);
        crop.y = drag.oy + (e.clientY - drag.y);
        clampCrop();
        applyCrop();
      });
      const stop = () => { drag = null; };
      stage.addEventListener('pointerup', stop);
      stage.addEventListener('pointercancel', stop);

      const zoom = $('#cropZoom');
      if (zoom) {
        zoom.addEventListener('input', () => {
          if (!crop) return;
          crop.zoom = Number(zoom.value) / 100;
          clampCrop();
          applyCrop();
        });
      }
    };
    img.src = src;
  }

  function clampCrop() {
    if (!crop) return;
    const dw = crop.img.naturalWidth * crop.base * crop.zoom;
    const dh = crop.img.naturalHeight * crop.base * crop.zoom;
    const mx = Math.max(0, (dw - crop.stageW) / 2);
    const my = Math.max(0, (dh - crop.stageH) / 2);
    crop.x = clamp(crop.x, -mx, mx);
    crop.y = clamp(crop.y, -my, my);
  }

  function applyCrop() {
    if (!crop) return;
    const c = crop;
    c.el.style.width = (c.img.naturalWidth * c.base * c.zoom) + 'px';
    c.el.style.height = (c.img.naturalHeight * c.base * c.zoom) + 'px';
    c.el.style.left = 'calc(50% + ' + c.x + 'px)';
    c.el.style.top = 'calc(50% + ' + c.y + 'px)';
  }

  function cropConfirm() {
    if (!crop) return;
    const outW = 1080;
    const outH = Math.round(outW * crop.stageH / crop.stageW);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    const k = outW / crop.stageW;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outW, outH);
    ctx.translate(outW / 2 + crop.x * k, outH / 2 + crop.y * k);
    const s = crop.base * crop.zoom * k;
    ctx.scale(s, s);
    ctx.drawImage(crop.img, -crop.img.naturalWidth / 2, -crop.img.naturalHeight / 2);
    let data = '';
    try {
      data = canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      toast('图片处理失败，换一张试试');
      return;
    }
    state.settings.bgImage = data;
    const ok = save();
    closeCropper();
    applyTheme();
    render();
    toast(ok ? '背景已更新' : '背景已应用，但本机存储空间不足');
  }

  function closeCropper() {
    crop = null;
    document.body.style.overflow = '';
    const root = $('#cropRoot');
    if (root) root.innerHTML = '';
  }

  function clearBackground() {
    state.settings.bgImage = '';
    save();
    applyTheme();
    render();
    toast('已恢复纸色背景');
  }

  /* =========================================================
     data
     ========================================================= */
  function ask(opts) {
    return new Promise((resolve) => {
      const root = $('#modalRoot');
      if (!root) { resolve(false); return; }
      root.innerHTML = `<div class="modal-mask">
        <div class="modal">
          <h3>${esc(opts.title)}</h3>
          <p>${esc(opts.body || '')}</p>
          <div class="modal-actions">
            <button class="btn ghost" data-m="0">${esc(opts.cancel || '取消')}</button>
            <button class="btn ${opts.danger ? 'danger' : 'ink'}" data-m="1">${esc(opts.ok || '确定')}</button>
          </div>
        </div>
      </div>`;

      function done(v) {
        root.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') done(false);
      }
      document.addEventListener('keydown', onKey);
      const mask = root.querySelector('.modal-mask');
      if (mask) {
        mask.addEventListener('click', (e) => {
          if (e.target === mask) done(false);
        });
      }
      $$('[data-m]', root).forEach((b) => {
        b.addEventListener('click', () => done(b.getAttribute('data-m') === '1'));
      });
    });
  }

  async function resetAll() {
    const ok = await ask({
      title: '清空所有数据？',
      body: '所有词笺和复习记录都会被删除，这个操作不能撤销。建议先导出备份。',
      ok: '清空',
      danger: true
    });
    if (!ok) return;
    const theme = state.settings.theme;
    state = blankState();
    state.settings.theme = theme;
    save();
    applyTheme();
    render();
    toast('已清空');
  }

  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function exportData() {
    const payload = {
      app: 'paper-wordbook',
      version: 4,
      exportedAt: new Date().toISOString(),
      words: state.words,
      settings: state.settings,
      days: state.days
    };
    const json = JSON.stringify(payload, null, 2);
    const filename = '词笺备份-' + TODAY() + '.json';

    const cap = window.Capacitor;
    const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    const fs = cap && cap.Plugins && cap.Plugins.Filesystem;
    const share = cap && cap.Plugins && cap.Plugins.Share;

    if (native) {
      if (!fs) {
        toast('导出失败：文件插件未安装');
        return;
      }
      try {
        await fs.writeFile({ path: filename, data: toBase64(json), directory: 'CACHE' });
        const got = await fs.getUri({ path: filename, directory: 'CACHE' });
        if (share) {
          await share.share({
            title: '纸间词笺备份',
            text: '词笺数据备份',
            url: got.uri,
            dialogTitle: '保存或发送备份文件'
          });
          toast('已生成备份，选择保存位置');
        } else {
          toast('备份已生成：' + got.uri);
        }
      } catch (e) {
        toast('导出失败，请重试');
      }
      return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('备份已导出');
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      let data = null;
      try { data = JSON.parse(await f.text()); } catch (e) { toast('文件不是有效的 JSON'); return; }

      const list = Array.isArray(data) ? data : (data && Array.isArray(data.words) ? data.words : null);
      if (!list) { toast('备份文件格式不对'); return; }

      const ok = await ask({
        title: '导入备份？',
        body: '将合并 ' + list.length + ' 条记录，同一天的同名单词会自动跳过。',
        ok: '导入'
      });
      if (!ok) return;

      let added = 0;
      list.forEach((raw) => {
        if (!raw || !raw.word || !raw.meaning) return;
        const w = normalizeWord(raw);
        const dup = state.words.some((x) =>
          x.word.toLowerCase() === w.word.toLowerCase() && x.date === w.date
        );
        if (dup) return;
        state.words.push(w);
        added++;
      });
      save();
      render();
      toast('已导入 ' + added + ' 个词');
    };
    input.click();
  }

  /* =========================================================
     speech
     ========================================================= */
  let cachedVoice = null;
  let voiceBound = false;

  function getVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (cachedVoice) return cachedVoice;
    const list = window.speechSynthesis.getVoices() || [];
    const en = list.filter((v) => /^en([-_]|$)/i.test(v.lang));
    cachedVoice =
      en.find((v) => /Samantha|Google US English|Microsoft (Aria|Zira|Jenny)|Daniel/i.test(v.name)) ||
      en.find((v) => /^en[-_]US$/i.test(v.lang)) ||
      en.find((v) => /^en[-_]GB$/i.test(v.lang)) ||
      en[0] ||
      null;
    return cachedVoice;
  }

  let audioEl = null;

  function speakWeb(t, rate) {
    if (!('speechSynthesis' in window)) return false;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = 'en-US';
      u.rate = rate || 0.86;
      u.pitch = 1;
      const v = getVoice();
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }

  function speakAudio(t) {
    if (!/^[a-zA-Z][a-zA-Z' -]*$/.test(t)) return false;
    try {
      if (!audioEl) audioEl = new Audio();
      audioEl.src = 'https://dict.youdao.com/dictvoice?type=2&audio=' + encodeURIComponent(t);
      const p = audioEl.play();
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }

  function speak(text, rate) {
    const t = String(text || '').trim();
    if (!t) return;

    const cap = window.Capacitor;
    const nativeTts = cap && cap.Plugins && cap.Plugins.TextToSpeech;
    if (nativeTts) {
      try {
        const p = nativeTts.speak({
          text: t,
          lang: 'en-US',
          rate: rate || 0.9,
          pitch: 1.0,
          volume: 1.0
        });
        if (p && p.catch) {
          p.catch(() => {
            if (!speakWeb(t, rate) && !speakAudio(t)) toast('这台设备的语音暂不可用');
          });
        }
        return;
      } catch (e) { /* fall through */ }
    }

    if (speakWeb(t, rate)) return;
    if (speakAudio(t)) return;
    toast('这台设备的语音暂不可用');
  }

  function bindVoices() {
    if (voiceBound || !('speechSynthesis' in window)) return;
    voiceBound = true;
    cachedVoice = null;
    getVoice();
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoice = null;
      getVoice();
    };
  }

  /* =========================================================
     events
     ========================================================= */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    switch (act) {
      case 'tab': switchTab(el.getAttribute('data-tab')); break;
      case 'open-add': openAdd(); break;
      case 'toggle': toggleWord(el.getAttribute('data-id')); break;
      case 'speak': speak(el.getAttribute('data-text')); break;
      case 'edit': openEdit(el.getAttribute('data-id')); break;
      case 'del': removeWord(el.getAttribute('data-id')); break;
      case 'master': toggleMaster(el.getAttribute('data-id')); break;
      case 'filter': ui.filter = el.getAttribute('data-f'); ui.open = null; render(); break;
      case 'group': ui.group = el.getAttribute('data-g') === 'tag' ? 'tag' : 'date'; ui.open = null; render(); break;
      case 'set': {
        const key = el.getAttribute('data-key');
        const val = el.getAttribute('data-val');
        if (key && val) {
          state.settings[key] = val;
          save();
          applyTheme();
          render();
        }
        break;
      }
      case 'reset-card-color':
        state.settings.cardColor = '';
        save();
        applyTheme();
        render();
        break;
      case 'accent': {
        const val = el.getAttribute('data-val') || '';
        state.settings.accent = /^#[0-9a-f]{6}$/i.test(val) ? val : '';
        save();
        applyTheme();
        render();
        break;
      }
      case 'clear-q':
        ui.q = '';
        render();
        { const i = $('#jSearch'); if (i) i.focus(); }
        break;
      case 'mode': setMode(el.getAttribute('data-mode')); break;
      case 'start': startSession(ui.mode, false); break;
      case 'start-free': startSession(ui.mode, true); break;
      case 'reveal': revealCard(); break;
      case 'grade': gradeCard(el.getAttribute('data-g')); break;
      case 'next': advance(); break;
      case 'exit': exitSession(); break;
      case 'again-session': restartSession(); break;
      case 'replay': if (currentWord()) speak(currentWord().word, 0.78); break;
      case 'hint': if (session) { session.hint = true; renderSession(); } break;
      case 'close-sheet': closeSheet(); break;
      case 'save-word': saveDraft(); break;
      case 'pick-bg': pickBackground(); break;
      case 'clear-bg': clearBackground(); break;
      case 'crop-cancel': closeCropper(); break;
      case 'crop-ok': cropConfirm(); break;
      case 'sheet-lookup': sheetLookup(); break;
      case 'recent': lookupWord(el.getAttribute('data-word')); break;
      case 'retry-lookup': if (ui.lookup) lookupWord(ui.lookup.word); break;
      case 'manual-add': openAdd({ word: el.getAttribute('data-word') || '', fromLookup: true }); break;
      case 'save-lookup': saveFromLookup(); break;
      case 'theme': setTheme(el.getAttribute('data-theme')); break;
      case 'goal': changeGoal(Number(el.getAttribute('data-d'))); break;
      case 'switch': toggleSetting(el.getAttribute('data-key')); break;
      case 'export': exportData(); break;
      case 'import': importData(); break;
      case 'reset': resetAll(); break;
      default: break;
    }
  });

  document.addEventListener('submit', (e) => {
    const id = e.target && e.target.id;
    if (id === 'lookupForm') {
      e.preventDefault();
      const input = $('#lookupInput');
      lookupWord(input ? input.value : '');
    } else if (id === 'wordForm') {
      e.preventDefault();
      saveDraft();
    } else if (id === 'spellForm') {
      e.preventDefault();
      checkSpell();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'jSearch') {
      ui.q = e.target.value;
      const list = $('#journalList');
      if (list) list.innerHTML = journalListHTML();
      const clear = $('#jClear');
      if (clear) clear.style.display = ui.q ? '' : 'none';
    } else if (e.target.id === 'bgDim') {
      state.settings.bgDim = clamp(Number(e.target.value) || 0, 0, 80);
      applyTheme();
      save();
    } else if (e.target.id === 'cardColor') {
      state.settings.cardColor = e.target.value;
      applyTheme();
      save();
    } else if (e.target.id === 'watermarkInput') {
      state.settings.watermark = e.target.value.slice(0, 24);
      save();
      const wm = $('.watermark');
      if (wm) wm.textContent = state.settings.watermark;
    } else if (e.target.id === 'glassOpacity') {
      state.settings.glassOpacity = Number(e.target.value) || 100;
      applyTheme();
      save();
    } else if (e.target.id === 'glassBlur') {
      state.settings.glassBlur = Number(e.target.value) || 0;
      applyTheme();
      save();
    } else if (e.target.id === 'cardWidth') {
      state.settings.cardWidth = clamp(Number(e.target.value) || 100, 60, 100);
      applyTheme();
      save();
    } else if (e.target.id === 'cardRadius') {
      state.settings.cardRadius = clamp(Number(e.target.value), 0, 24);
      applyTheme();
      save();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!session) return;
    if (e.key === 'Escape') { e.preventDefault(); exitSession(); return; }
    if (session.done) return;

    if (session.mode === 'card') {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        if (!session.revealed) revealCard();
        else gradeCard('good');
        return;
      }
      if (session.revealed) {
        if (e.key === '1') { e.preventDefault(); gradeCard('again'); }
        else if (e.key === '2') { e.preventDefault(); gradeCard('hard'); }
        else if (e.key === '3') { e.preventDefault(); gradeCard('good'); }
      }
    } else if (e.key === 'Enter' && session.feedback) {
      e.preventDefault();
      advance();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!draft) return;
    if (e.key === 'Escape') { closeSheet(); return; }
    if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type !== 'date') {
      e.preventDefault();
      saveDraft();
    }
  });

  /* =========================================================
     boot
     ========================================================= */
  bindVoices();
  applyTheme();
  render();
  animateView();
})();
