'use strict';

// ===== CONFIG =====
const API_BASE = '/api/news';
const CACHE_DURATION = 2 * 60 * 60 * 1000;
const MAX_ARTICLES = 10;
const MAX_DAYS_BACK = 14;

const DEFAULT_CATEGORIES = [
  { id: 'general',       label: 'À la une',  icon: '📰' },
  { id: 'nation',        label: 'France',    icon: '🇫🇷' },
  { id: 'world',         label: 'Monde',     icon: '🌍' },
  { id: 'business',      label: 'Business',  icon: '💼' },
  { id: 'technology',    label: 'Tech',      icon: '💻' },
  { id: 'sports',        label: 'Sport',     icon: '⚽' },
  { id: 'science',       label: 'Science',   icon: '🔬' },
  { id: 'health',        label: 'Santé',     icon: '🏥' },
  { id: 'entertainment', label: 'Culture',   icon: '🎭' },
];

// ===== STATE =====
let currentView = 'home';
let currentCat = 'general';
let currentArticle = null;
let currentArticleIdx = 0;
let currentArticleList = [];
let currentArticleCat = 'general';
let dateOffset = 0;
let savedArticles = [];
let readHistory = [];
let articleCache = {};
let searchQuery = '';
let loadedPage = 1;
let hasMorePages = false;
let settings = {
  theme: 'dark',
  fontSize: 'medium',
  catOrder: DEFAULT_CATEGORIES.map(c => c.id),
  hiddenCats: [],
  blockedSources: [],
  notifications: false,
};

// ===== CATEGORIES =====
function getCategories() {
  return settings.catOrder
    .map(id => DEFAULT_CATEGORIES.find(c => c.id === id))
    .filter(c => c && !settings.hiddenCats.includes(c.id));
}

// ===== STORAGE =====
function loadStorage() {
  try {
    savedArticles = JSON.parse(localStorage.getItem('journal_saved') || '[]');
    articleCache  = JSON.parse(localStorage.getItem('journal_cache') || '{}');
    readHistory   = JSON.parse(localStorage.getItem('journal_history') || '[]');
    const s = JSON.parse(localStorage.getItem('journal_settings') || '{}');
    settings = { ...settings, ...s };
    if (!Array.isArray(settings.catOrder) || settings.catOrder.length !== DEFAULT_CATEGORIES.length) {
      settings.catOrder = DEFAULT_CATEGORIES.map(c => c.id);
    }
    if (!Array.isArray(settings.hiddenCats))    settings.hiddenCats = [];
    if (!Array.isArray(settings.blockedSources)) settings.blockedSources = [];
  } catch {
    savedArticles = []; articleCache = {}; readHistory = [];
  }
}

function saveStorage()  { try { localStorage.setItem('journal_saved', JSON.stringify(savedArticles)); } catch {} }
function saveSettings() { try { localStorage.setItem('journal_settings', JSON.stringify(settings)); } catch {} }
function saveHistory()  { try { localStorage.setItem('journal_history', JSON.stringify(readHistory)); } catch {} }
function saveCache() {
  try {
    const now = Date.now();
    Object.keys(articleCache).forEach(k => {
      if (now - articleCache[k].timestamp > CACHE_DURATION * 2) delete articleCache[k];
    });
    localStorage.setItem('journal_cache', JSON.stringify(articleCache));
  } catch {}
}

// ===== THEME & FONT =====
function applyTheme() {
  document.body.classList.toggle('light', settings.theme === 'light');
}
function applyFontSize() {
  document.body.classList.remove('font-small', 'font-medium', 'font-large');
  document.body.classList.add(`font-${settings.fontSize}`);
}
function applySettings() { applyTheme(); applyFontSize(); }

// ===== READ HISTORY =====
function markAsRead(article, catId) {
  readHistory = readHistory.filter(h => h.url !== article.url);
  readHistory.unshift({
    url: article.url, title: article.title,
    source: article.source?.name || '', image: article.image || null,
    publishedAt: article.publishedAt, catId: catId || currentCat,
    readAt: new Date().toISOString(),
  });
  if (readHistory.length > 50) readHistory = readHistory.slice(0, 50);
  saveHistory();
}
function isRead(url) { return readHistory.some(h => h.url === url); }

// ===== UTILS =====
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diffMs = Date.now() - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 2) return 'À l\'instant';
  if (diffMins < 60) return `Il y a ${diffMins} min`;
  if (diffH < 24) return `Il y a ${diffH}h`;
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}
function fmtDateLong(d) {
  return d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
function fmtDateOffset(offset) {
  const d = new Date(); d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}
function getCatLabel(id) { return DEFAULT_CATEGORIES.find(c => c.id === id)?.label || ''; }
function getCatIcon(id)  { return DEFAULT_CATEGORIES.find(c => c.id === id)?.icon  || '📰'; }
function isArticleSaved(url) { return savedArticles.some(a => a.url === url); }
function toggleSave(article) {
  if (isArticleSaved(article.url)) savedArticles = savedArticles.filter(a => a.url !== article.url);
  else savedArticles.unshift({ ...article, savedAt: new Date().toISOString() });
  saveStorage();
}
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function readingTime(text) {
  const words = (text || '').split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.ceil(words / 200));
  return `${mins} min`;
}
function filterArticles(articles) {
  if (!settings.blockedSources.length) return articles;
  return articles.filter(a => !settings.blockedSources.includes(a.source?.name || ''));
}

// ===== NOTIFICATIONS =====
function checkAndNotify(articles) {
  if (!settings.notifications) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const lastSeen = parseInt(localStorage.getItem('journal_last_seen') || '0');
  if (!lastSeen) { localStorage.setItem('journal_last_seen', Date.now()); return; }
  const newOnes = articles.filter(a => a.publishedAt && new Date(a.publishedAt).getTime() > lastSeen);
  if (newOnes.length > 0) {
    new Notification('Journal de La Fouchardière', {
      body: `${newOnes.length} nouvel${newOnes.length > 1 ? 'les' : ''} article${newOnes.length > 1 ? 's' : ''} disponible${newOnes.length > 1 ? 's' : ''}`,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: 'journal-news',
    });
  }
  localStorage.setItem('journal_last_seen', Date.now());
}

async function toggleNotifications() {
  if (!('Notification' in window)) {
    alert('Votre navigateur ne supporte pas les notifications.');
    return;
  }
  if (settings.notifications) {
    settings.notifications = false;
    saveSettings();
    renderSettings();
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    settings.notifications = true;
    localStorage.setItem('journal_last_seen', Date.now());
    saveSettings();
    renderSettings();
  } else {
    alert('Permission refusée. Activez les notifications dans Réglages > Safari > Notifications.');
  }
}

// ===== API =====
async function fetchArticles(cat, dateStr, page = 1) {
  const cacheKey = `${cat}_${dateStr || 'today'}_p${page}`;
  const now = Date.now();
  if (articleCache[cacheKey] && (now - articleCache[cacheKey].timestamp < CACHE_DURATION)) {
    return { articles: articleCache[cacheKey].data };
  }
  let url = `${API_BASE}?category=${cat}&max=${MAX_ARTICLES}&page=${page}`;
  if (dateStr) {
    const from = new Date(dateStr); from.setHours(0,0,0,0);
    const to   = new Date(dateStr); to.setHours(23,59,59,999);
    url += `&from=${from.toISOString()}&to=${to.toISOString()}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  const articles = json.articles || [];
  articleCache[cacheKey] = { data: articles, timestamp: now };
  saveCache();
  return { articles };
}
async function searchArticles(query) {
  const res = await fetch(`${API_BASE}?q=${encodeURIComponent(query)}&max=${MAX_ARTICLES}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()).articles || [];
}

// ===== HEADER =====
function renderHeaderDate() {
  const el = document.getElementById('header-date');
  if (el) el.textContent = fmtDateLong(new Date()).replace(/^\w/, c => c.toUpperCase());
}
function renderCatNav() {
  const nav = document.getElementById('cat-nav');
  if (!nav) return;
  nav.innerHTML = getCategories().map(c => `
    <button class="cat-btn ${c.id === currentCat ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>
  `).join('');
  nav.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentCat !== btn.dataset.cat) {
        currentCat = btn.dataset.cat;
        dateOffset = 0;
        renderCatNav();
        if (currentView === 'home') renderHome();
      }
    });
  });
}

// ===== HOME =====
async function renderHome() {
  const main = document.getElementById('main-content');
  main.innerHTML = `<div class="loading"><div class="spinner"></div><div class="loading-text">Chargement…</div></div>`;

  loadedPage = 1;
  hasMorePages = false;

  let dateStr = null;
  if (dateOffset > 0) {
    const d = new Date(); d.setDate(d.getDate() - dateOffset);
    dateStr = d.toISOString().split('T')[0];
  }

  let articles;
  try {
    ({ articles } = await fetchArticles(currentCat, dateStr, 1));
  } catch {
    main.innerHTML = `<div class="error-box"><p>Impossible de charger les articles.<br>Vérifiez votre connexion.</p><button onclick="renderHome()">Réessayer</button></div>`;
    return;
  }

  articles = filterArticles(articles);
  hasMorePages = articles.length >= MAX_ARTICLES;

  if (!articles.length) {
    main.innerHTML = `${renderDateNavHTML()}<div class="error-box" style="margin-top:24px;"><p>Aucun article disponible.</p></div>`;
    bindDateNav(document.getElementById('main-content'));
    return;
  }

  currentArticleList = articles;
  currentArticleCat = currentCat;

  checkAndNotify(articles);

  const hero = articles[0];
  const rest = articles.slice(1);
  const catLabel  = getCatLabel(currentCat);
  const catIcon   = getCatIcon(currentCat);
  const dateLabel = dateOffset === 0 ? 'Aujourd\'hui' : dateOffset === 1 ? 'Hier' : fmtDateOffset(dateOffset);

  main.innerHTML = `
    <div class="home-view">
      ${renderDateNavHTML()}

      <div class="hero-article" data-idx="0">
        ${hero.image ? `<img class="hero-img" src="${esc(hero.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
        <div class="hero-no-img" ${hero.image ? 'style="display:none"' : ''}>${catIcon}</div>
        <div class="hero-overlay">
          <div class="hero-tags">
            <span class="hero-cat">${catLabel}</span>
            <span class="hero-time">⏱ ${readingTime(hero.description || hero.title || '')}</span>
            ${isRead(hero.url) ? '<span class="read-badge">Lu</span>' : ''}
          </div>
          <div class="hero-title ${isRead(hero.url) ? 'is-read' : ''}">${esc(hero.title)}</div>
          <div class="hero-meta">${esc(hero.source?.name || '')} · ${fmtDate(hero.publishedAt)}</div>
        </div>
        <button class="hero-save ${isArticleSaved(hero.url) ? 'saved' : ''}" data-idx="0">🔖</button>
      </div>

      ${rest.length ? `
        <div class="section-header">
          <span class="section-title">${catLabel} — ${dateLabel}</span>
          <span class="section-line"></span>
        </div>` : ''}
      <div class="article-list" id="article-list">
        ${rest.map((a, i) => renderArticleCard(a, i + 1, catLabel)).join('')}
      </div>
      <div class="load-more-wrap" id="load-more-wrap">
        ${hasMorePages ? `<button class="load-more-btn" id="load-more-btn">Charger plus d'articles</button>` : ''}
      </div>
    </div>`;

  bindHomeEvents(main);
}

async function loadMoreArticles() {
  const btn = document.getElementById('load-more-btn');
  if (btn) { btn.textContent = 'Chargement…'; btn.disabled = true; }

  loadedPage++;
  let dateStr = null;
  if (dateOffset > 0) {
    const d = new Date(); d.setDate(d.getDate() - dateOffset);
    dateStr = d.toISOString().split('T')[0];
  }

  try {
    const { articles: newArticles } = await fetchArticles(currentCat, dateStr, loadedPage);
    const filtered = filterArticles(newArticles);
    const offset = currentArticleList.length;
    currentArticleList = [...currentArticleList, ...filtered];
    hasMorePages = newArticles.length >= MAX_ARTICLES;

    const list = document.getElementById('article-list');
    const catLabel = getCatLabel(currentCat);
    if (list) {
      filtered.forEach((a, i) => {
        list.insertAdjacentHTML('beforeend', renderArticleCard(a, offset + i, catLabel));
      });
    }

    const wrap = document.getElementById('load-more-wrap');
    if (wrap) {
      wrap.innerHTML = hasMorePages
        ? `<button class="load-more-btn" id="load-more-btn">Charger plus d'articles</button>`
        : `<div class="load-more-end">Vous êtes à jour ✓</div>`;
      if (hasMorePages) {
        document.getElementById('load-more-btn').addEventListener('click', loadMoreArticles);
      }
    }
  } catch {
    const b = document.getElementById('load-more-btn');
    if (b) { b.textContent = 'Charger plus d\'articles'; b.disabled = false; }
  }
}

function renderDateNavHTML() {
  const label = dateOffset === 0 ? 'Aujourd\'hui' : dateOffset === 1 ? 'Hier' : fmtDateOffset(dateOffset);
  return `<div class="date-nav">
    <button class="date-nav-btn" id="date-prev" ${dateOffset >= MAX_DAYS_BACK ? 'disabled' : ''}>&#8249;</button>
    <span class="date-nav-label">${label}</span>
    <button class="date-nav-btn" id="date-next" ${dateOffset <= 0 ? 'disabled' : ''}>&#8250;</button>
  </div>`;
}
function bindDateNav(container) {
  const p = container.querySelector('#date-prev');
  const n = container.querySelector('#date-next');
  if (p) p.addEventListener('click', () => { dateOffset++; renderHome(); });
  if (n) n.addEventListener('click', () => { dateOffset = Math.max(0, dateOffset - 1); renderHome(); });
}

function renderArticleCard(article, idx, catLabel) {
  const saved = isArticleSaved(article.url);
  const read  = isRead(article.url);
  const time  = readingTime(article.description || article.title || '');
  return `
    <div class="article-card ${read ? 'is-read' : ''}" data-idx="${idx}">
      <div class="article-card-body">
        ${catLabel ? `<div class="article-cat-tag">${esc(catLabel)}</div>` : ''}
        <div class="article-title">${esc(article.title)}</div>
        ${article.description ? `<div class="article-desc">${esc(article.description)}</div>` : ''}
        <div class="article-meta">
          <span>${esc(article.source?.name || '')}</span>
          <span class="sep">·</span>
          <span>${fmtDate(article.publishedAt)}</span>
          <span class="sep">·</span>
          <span>⏱ ${time}</span>
          ${read ? '<span class="sep">·</span><span class="read-tag">Lu</span>' : ''}
        </div>
      </div>
      ${article.image
        ? `<img class="article-thumb" src="${esc(article.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="article-thumb-placeholder">${getCatIcon(currentCat)}</div>`}
      <button class="card-save-btn ${saved ? 'saved' : ''}" data-idx="${idx}">🔖</button>
    </div>`;
}

function bindHomeEvents(container) {
  bindDateNav(container);

  // Load more
  document.getElementById('load-more-btn')?.addEventListener('click', loadMoreArticles);

  // Event delegation — fonctionne aussi pour les cartes chargées dynamiquement
  container.addEventListener('click', e => {
    const saveBtn = e.target.closest('.hero-save, .card-save-btn');
    if (saveBtn) {
      e.stopPropagation();
      const idx = parseInt(saveBtn.dataset.idx || '0');
      const a = currentArticleList[idx];
      if (a) { toggleSave(a); saveBtn.classList.toggle('saved', isArticleSaved(a.url)); }
      if (currentView === 'saved') renderSaved();
      return;
    }
    const card = e.target.closest('.hero-article, .article-card');
    if (card) {
      const idx = parseInt(card.dataset.idx || '0');
      const a = currentArticleList[idx];
      if (a) openArticle(a, currentCat, currentArticleList, idx);
    }
  });
}

// ===== ARTICLE READER =====
function openArticle(article, catId, articleList, idx) {
  currentArticle = article;
  currentArticleIdx = idx || 0;
  if (articleList) currentArticleList = articleList;
  currentArticleCat = catId || currentCat;

  markAsRead(article, catId);

  const overlay = document.getElementById('article-overlay');
  overlay.classList.remove('hidden');
  overlay.scrollTop = 0;

  const hasPrev = currentArticleIdx > 0;
  const hasNext = currentArticleIdx < currentArticleList.length - 1;
  const catLabel = getCatLabel(catId || currentCat);
  const saved = isArticleSaved(article.url);

  overlay.innerHTML = `
    <div class="article-reader">
      <div class="reader-header">
        <button class="reader-back" id="reader-back">&#8592;</button>
        <span class="reader-title-small">${esc(article.title)}</span>
        <div class="reader-header-actions">
          <button class="reader-font-btn font-sm-btn" id="reader-font-sm" title="Réduire">a</button>
          <button class="reader-font-btn font-lg-btn" id="reader-font-lg" title="Agrandir">A</button>
          <button class="reader-save-btn ${saved ? 'saved' : ''}" id="reader-save-btn">🔖</button>
        </div>
      </div>

      ${article.image ? `<img class="reader-img" src="${esc(article.image)}" alt="" loading="lazy">` : ''}

      <div class="reader-content">
        <div class="reader-cat">${esc(catLabel)}</div>
        <h1 class="reader-headline">${esc(article.title)}</h1>
        <div class="reader-byline">
          <span>${esc(article.source?.name || '')}</span>
          <span>·</span>
          <span>${fmtDate(article.publishedAt)}</span>
          ${article.publishedAt ? `<span>·</span><span>${new Date(article.publishedAt).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</span>` : ''}
          <span id="reader-time-badge"></span>
        </div>

        <div class="reader-divider"><span>◆</span></div>

        ${article.description ? `<div class="reader-description">${esc(article.description)}</div>` : ''}

        <div id="reader-body-slot"><div class="reader-loading"><div class="spinner"></div></div></div>

        <a href="${esc(article.url)}" target="_blank" rel="noopener" class="reader-more">
          Lire l'article sur ${esc(article.source?.name || 'la source')} →
        </a>

        <div class="reader-source-row">
          <span>Source : ${esc(article.source?.name || '')}</span>
          ${article.source?.name ? `<button class="block-source-btn" id="block-source-btn" data-source="${esc(article.source.name)}">Bloquer cette source</button>` : ''}
        </div>
      </div>

      <div id="reader-similar"></div>

      <div class="reader-nav-btns">
        <button class="reader-nav-btn" id="reader-prev" ${hasPrev ? '' : 'disabled'}>&#8592; Précédent</button>
        <button class="reader-nav-btn" id="reader-next" ${hasNext ? '' : 'disabled'}>Suivant &#8594;</button>
      </div>
    </div>`;

  // Events
  document.getElementById('reader-back').addEventListener('click', closeArticle);
  document.getElementById('reader-save-btn').addEventListener('click', () => {
    toggleSave(article);
    const s = isArticleSaved(article.url);
    document.getElementById('reader-save-btn')?.classList.toggle('saved', s);
    if (currentView === 'saved') renderSaved();
  });
  document.getElementById('reader-font-sm').addEventListener('click', () => {
    const sizes = ['small','medium','large'];
    const i = sizes.indexOf(settings.fontSize);
    if (i > 0) { settings.fontSize = sizes[i-1]; applyFontSize(); saveSettings(); }
  });
  document.getElementById('reader-font-lg').addEventListener('click', () => {
    const sizes = ['small','medium','large'];
    const i = sizes.indexOf(settings.fontSize);
    if (i < 2) { settings.fontSize = sizes[i+1]; applyFontSize(); saveSettings(); }
  });
  document.getElementById('reader-prev')?.addEventListener('click', () => navigateArticle(-1));
  document.getElementById('reader-next')?.addEventListener('click', () => navigateArticle(1));

  const blockBtn = document.getElementById('block-source-btn');
  if (blockBtn) {
    blockBtn.addEventListener('click', () => {
      const source = blockBtn.dataset.source;
      if (!settings.blockedSources.includes(source)) {
        settings.blockedSources.push(source);
        saveSettings();
      }
      blockBtn.textContent = '✓ Source bloquée';
      blockBtn.disabled = true;
    });
  }

  // Swipe
  let startX = 0, startY = 0;
  overlay.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener('touchend', e => {
    const dx = startX - e.changedTouches[0].clientX;
    const dy = Math.abs(startY - e.changedTouches[0].clientY);
    if (Math.abs(dx) > 70 && Math.abs(dx) > dy * 1.5) {
      if (dx > 0) navigateArticle(1);
      else navigateArticle(-1);
    }
  }, { passive: true });

  fetchFullArticle(article.url);
}

function navigateArticle(dir) {
  const newIdx = currentArticleIdx + dir;
  if (newIdx < 0 || newIdx >= currentArticleList.length) return;
  document.getElementById('article-overlay').scrollTop = 0;
  openArticle(currentArticleList[newIdx], currentArticleCat, currentArticleList, newIdx);
}

async function fetchFullArticle(url) {
  if (!document.getElementById('reader-body-slot')) return;
  try {
    const res  = await fetch(`/api/article?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    const slot = document.getElementById('reader-body-slot');
    if (!slot) return;

    if (data.paragraphs?.length) {
      slot.innerHTML = `<div class="reader-body">${data.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
      const badge = document.getElementById('reader-time-badge');
      if (badge) badge.textContent = `· ⏱ ${readingTime(data.paragraphs.join(' '))} de lecture`;
      renderSimilarArticles();
    } else {
      slot.innerHTML = `<div class="reader-unavailable">Article complet non disponible — le site source bloque la lecture intégrée.</div>`;
    }
  } catch {
    const slot = document.getElementById('reader-body-slot');
    if (slot) slot.innerHTML = `<div class="reader-unavailable">Article complet non disponible — le site source bloque la lecture intégrée.</div>`;
  }
}

function renderSimilarArticles() {
  const container = document.getElementById('reader-similar');
  if (!container || !currentArticle) return;
  const similar = currentArticleList.filter(a => a.url !== currentArticle.url).slice(0, 3);
  if (!similar.length) return;

  container.innerHTML = `
    <div class="similar-section">
      <div class="section-header" style="margin:0;padding:14px 16px 8px;">
        <span class="section-title">Dans la même catégorie</span>
        <span class="section-line"></span>
      </div>
      ${similar.map((a, i) => `
        <div class="similar-card" data-sidx="${i}">
          ${a.image ? `<img class="similar-thumb" src="${esc(a.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="similar-thumb-ph"></div>'}
          <div class="similar-body">
            <div class="similar-title">${esc(a.title)}</div>
            <div class="similar-meta">${esc(a.source?.name || '')} · ${fmtDate(a.publishedAt)}</div>
          </div>
        </div>`).join('')}
    </div>`;

  container.querySelectorAll('.similar-card').forEach(card => {
    card.addEventListener('click', () => {
      const a = similar[parseInt(card.dataset.sidx)];
      const listIdx = currentArticleList.findIndex(x => x.url === a.url);
      document.getElementById('article-overlay').scrollTop = 0;
      openArticle(a, currentArticleCat, currentArticleList, listIdx >= 0 ? listIdx : 0);
    });
  });
}

function closeArticle() {
  const overlay = document.getElementById('article-overlay');
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
  currentArticle = null;
}

// ===== SEARCH =====
function renderSearch() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="search-view">
      <div class="search-box-wrap">
        <input type="search" class="search-input" id="search-input"
          placeholder="Rechercher dans les actualités…"
          value="${esc(searchQuery)}" autocomplete="off" autocorrect="off" spellcheck="false">
        <button class="search-btn" id="search-btn">🔍</button>
      </div>
      <div id="search-results"></div>
    </div>`;

  const input   = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) return;
    searchQuery = q;
    results.innerHTML = `<div class="loading"><div class="spinner"></div><div class="loading-text">Recherche…</div></div>`;
    try {
      let articles = filterArticles(await searchArticles(q));
      if (!articles.length) {
        results.innerHTML = `<div class="search-hint">Aucun résultat pour « ${esc(q)} »</div>`;
        return;
      }
      results.innerHTML = `
        <div class="search-results-count">${articles.length} résultat${articles.length > 1 ? 's' : ''} pour « ${esc(q)} »</div>
        <div class="article-list">${articles.map((a, i) => renderArticleCard(a, i, getCatLabel(currentCat))).join('')}</div>`;
      results.querySelectorAll('.article-card').forEach(el => {
        el.addEventListener('click', e => {
          if (e.target.closest('.card-save-btn')) return;
          const idx = parseInt(el.dataset.idx);
          openArticle(articles[idx], 'general', articles, idx);
        });
      });
      results.querySelectorAll('.card-save-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          toggleSave(articles[idx]);
          btn.classList.toggle('saved', isArticleSaved(articles[idx].url));
        });
      });
    } catch {
      results.innerHTML = `<div class="error-box"><p>Erreur de recherche.</p></div>`;
    }
  };

  document.getElementById('search-btn').addEventListener('click', doSearch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  if (searchQuery) doSearch();
  else results.innerHTML = `<div class="search-hint">Tapez un mot-clé pour rechercher dans les actualités françaises</div>`;
  input.focus();
}

// ===== SAVED =====
function renderSaved() {
  const main = document.getElementById('main-content');
  if (!savedArticles.length) {
    main.innerHTML = `
      <div class="saved-view">
        <div class="section-header"><span class="section-title">Articles sauvegardés</span><span class="section-line"></span></div>
        <div class="saved-empty"><div class="icon">🔖</div><p>Aucun article sauvegardé.</p></div>
      </div>`;
    return;
  }
  main.innerHTML = `
    <div class="saved-view">
      <div class="section-header"><span class="section-title">${savedArticles.length} sauvegardé${savedArticles.length > 1 ? 's' : ''}</span><span class="section-line"></span></div>
      <div class="article-list">${savedArticles.map((a, i) => renderArticleCard(a, i, getCatLabel(a.catId || 'general'))).join('')}</div>
    </div>`;
  main.querySelectorAll('.article-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.card-save-btn')) return;
      const idx = parseInt(el.dataset.idx);
      openArticle(savedArticles[idx], savedArticles[idx].catId || 'general', savedArticles, idx);
    });
  });
  main.querySelectorAll('.card-save-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleSave(savedArticles[parseInt(btn.dataset.idx)]);
      renderSaved();
    });
  });
}

// ===== SETTINGS =====
function renderSettings() {
  const main = document.getElementById('main-content');

  main.innerHTML = `
    <div class="settings-view">

      <div class="settings-section">
        <div class="settings-section-title">Apparence</div>

        <div class="settings-row">
          <span class="settings-label">Thème</span>
          <div class="toggle-group">
            <button class="toggle-btn ${settings.theme === 'dark'  ? 'active' : ''}" data-theme="dark">🌙 Sombre</button>
            <button class="toggle-btn ${settings.theme === 'light' ? 'active' : ''}" data-theme="light">☀️ Clair</button>
          </div>
        </div>

        <div class="settings-row">
          <span class="settings-label">Notifications</span>
          <button class="toggle-btn ${settings.notifications ? 'active' : ''}" id="notif-toggle">
            ${settings.notifications ? '🔔 Activées' : '🔕 Désactivées'}
          </button>
        </div>

        <div class="settings-row">
          <span class="settings-label">Taille du texte</span>
          <div class="toggle-group">
            <button class="toggle-btn font-sz-btn ${settings.fontSize === 'small'  ? 'active' : ''}" data-size="small"  style="font-size:12px">A</button>
            <button class="toggle-btn font-sz-btn ${settings.fontSize === 'medium' ? 'active' : ''}" data-size="medium" style="font-size:15px">A</button>
            <button class="toggle-btn font-sz-btn ${settings.fontSize === 'large'  ? 'active' : ''}" data-size="large"  style="font-size:19px">A</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Catégories</div>
        <div class="settings-hint">Activer / désactiver · ↑↓ pour réordonner</div>
        <div id="cat-manager">
          ${settings.catOrder.map((id, i) => {
            const c = DEFAULT_CATEGORIES.find(x => x.id === id);
            if (!c) return '';
            const hidden = settings.hiddenCats.includes(id);
            return `
              <div class="cat-row ${hidden ? 'cat-hidden' : ''}" data-catid="${id}">
                <button class="cat-toggle-btn ${hidden ? '' : 'on'}" data-catid="${id}">${hidden ? '○' : '●'}</button>
                <span class="cat-row-icon">${c.icon}</span>
                <span class="cat-row-label">${c.label}</span>
                <div class="cat-row-arrows">
                  <button class="cat-arrow" data-dir="-1" data-catid="${id}" ${i === 0 ? 'disabled' : ''}>↑</button>
                  <button class="cat-arrow" data-dir="1"  data-catid="${id}" ${i === settings.catOrder.length-1 ? 'disabled' : ''}>↓</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Sources bloquées</div>
        ${!settings.blockedSources.length
          ? `<div class="settings-hint">Aucune source bloquée.<br>Appuyez sur "Bloquer cette source" en bas d'un article.</div>`
          : settings.blockedSources.map(s => `
              <div class="blocked-row">
                <span class="blocked-name">${esc(s)}</span>
                <button class="unblock-btn" data-src="${esc(s)}">Débloquer</button>
              </div>`).join('')}
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Lu récemment</div>
        ${!readHistory.length
          ? `<div class="settings-hint">Aucun article lu pour l'instant.</div>`
          : `<div class="article-list">
              ${readHistory.slice(0, 20).map((a, i) => `
                <div class="article-card history-card" data-hidx="${i}">
                  <div class="article-card-body">
                    <div class="article-title">${esc(a.title)}</div>
                    <div class="article-meta">
                      <span>${esc(a.source)}</span>
                      <span class="sep">·</span>
                      <span>Lu ${fmtDate(a.readAt)}</span>
                    </div>
                  </div>
                  ${a.image ? `<img class="article-thumb" src="${esc(a.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
                </div>`).join('')}
            </div>
            <button class="clear-btn" id="clear-history">Effacer l'historique</button>`}
      </div>

    </div>`;

  // Notifications
  document.getElementById('notif-toggle')?.addEventListener('click', toggleNotifications);

  // Theme
  main.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.theme = btn.dataset.theme;
      applyTheme(); saveSettings();
      main.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
    });
  });

  // Font size
  main.querySelectorAll('.font-sz-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.fontSize = btn.dataset.size;
      applyFontSize(); saveSettings();
      main.querySelectorAll('.font-sz-btn').forEach(b => b.classList.toggle('active', b.dataset.size === settings.fontSize));
    });
  });

  // Cat toggle
  main.querySelectorAll('.cat-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.catid;
      if (settings.hiddenCats.includes(id)) {
        settings.hiddenCats = settings.hiddenCats.filter(x => x !== id);
      } else {
        const visible = settings.catOrder.filter(x => !settings.hiddenCats.includes(x));
        if (visible.length <= 1) return;
        settings.hiddenCats.push(id);
      }
      saveSettings(); renderCatNav(); renderSettings();
    });
  });

  // Cat reorder
  main.querySelectorAll('.cat-arrow').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.catid;
      const dir = parseInt(btn.dataset.dir);
      const i = settings.catOrder.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= settings.catOrder.length) return;
      [settings.catOrder[i], settings.catOrder[j]] = [settings.catOrder[j], settings.catOrder[i]];
      saveSettings(); renderCatNav(); renderSettings();
    });
  });

  // Unblock
  main.querySelectorAll('.unblock-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.blockedSources = settings.blockedSources.filter(s => s !== btn.dataset.src);
      saveSettings(); renderSettings();
    });
  });

  // Clear history
  document.getElementById('clear-history')?.addEventListener('click', () => {
    readHistory = []; saveHistory(); renderSettings();
  });

  // History article click
  main.querySelectorAll('.history-card').forEach(card => {
    card.addEventListener('click', () => {
      const a = readHistory[parseInt(card.dataset.hidx)];
      if (a) openArticle(a, a.catId || 'general', [a], 0);
    });
  });
}

// ===== BOTTOM NAV =====
function bindBottomNav() {
  document.getElementById('bottom-nav').querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view !== currentView) setView(btn.dataset.view);
    });
  });
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const catNav = document.getElementById('cat-nav');
  if (catNav) catNav.style.display = view === 'home' ? '' : 'none';
  if      (view === 'home')     renderHome();
  else if (view === 'search')   renderSearch();
  else if (view === 'saved')    renderSaved();
  else if (view === 'settings') renderSettings();
}

// ===== SERVICE WORKER =====
function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function forceUpdate() {
  const btn = document.getElementById('sw-update-btn');
  if (btn) { btn.textContent = '↻ Mise à jour…'; btn.disabled = true; }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => Promise.all(regs.map(r => r.unregister())))
      .then(() => window.location.reload(true));
  } else {
    window.location.reload(true);
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  applySettings();
  renderHeaderDate();
  renderCatNav();
  bindBottomNav();
  registerSW();
  renderHome();
});
