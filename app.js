'use strict';

// ===== CONFIG =====
const API_BASE = '/api/news';
const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 heures
const MAX_ARTICLES = 10;
const MAX_DAYS_BACK = 14;

const CATEGORIES = [
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
let dateOffset = 0; // 0 = aujourd'hui, 1 = hier, etc.
let savedArticles = [];
let articleCache = {}; // { key: { data, timestamp } }
let searchQuery = '';

// ===== STORAGE =====
function loadStorage() {
  try {
    savedArticles = JSON.parse(localStorage.getItem('journal_saved') || '[]');
    articleCache = JSON.parse(localStorage.getItem('journal_cache') || '{}');
  } catch (e) {
    savedArticles = [];
    articleCache = {};
  }
}

function saveStorage() {
  try {
    localStorage.setItem('journal_saved', JSON.stringify(savedArticles));
  } catch (e) {}
}

function saveCache() {
  try {
    // Nettoyer le cache expiré avant de sauvegarder
    const now = Date.now();
    Object.keys(articleCache).forEach(k => {
      if (now - articleCache[k].timestamp > CACHE_DURATION * 2) {
        delete articleCache[k];
      }
    });
    localStorage.setItem('journal_cache', JSON.stringify(articleCache));
  } catch (e) {}
}

// ===== UTILS =====
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const diffMs = now - d;
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
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function getCatLabel(id) {
  const c = CATEGORIES.find(c => c.id === id);
  return c ? c.label : '';
}

function getCatIcon(id) {
  const c = CATEGORIES.find(c => c.id === id);
  return c ? c.icon : '📰';
}

function isArticleSaved(url) {
  return savedArticles.some(a => a.url === url);
}

function toggleSave(article) {
  if (isArticleSaved(article.url)) {
    savedArticles = savedArticles.filter(a => a.url !== article.url);
  } else {
    savedArticles.unshift({ ...article, savedAt: new Date().toISOString() });
  }
  saveStorage();
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== API =====
async function fetchArticles(cat, dateStr) {
  const cacheKey = `${cat}_${dateStr || 'today'}`;
  const now = Date.now();

  // Vérifier le cache
  if (articleCache[cacheKey] && (now - articleCache[cacheKey].timestamp < CACHE_DURATION)) {
    return { articles: articleCache[cacheKey].data };
  }

  // Construire l'URL vers le proxy Vercel
  let url = `${API_BASE}?category=${cat}&max=${MAX_ARTICLES}`;

  // Pour les dates passées, ajouter les filtres from/to
  if (dateStr) {
    const from = new Date(dateStr);
    from.setHours(0, 0, 0, 0);
    const to = new Date(dateStr);
    to.setHours(23, 59, 59, 999);
    url += `&from=${from.toISOString()}&to=${to.toISOString()}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API Error ${response.status}`);
  }
  const json = await response.json();
  const articles = json.articles || [];

  // Mettre en cache
  articleCache[cacheKey] = { data: articles, timestamp: now };
  saveCache();

  return { articles };
}

async function searchArticles(query) {
  const url = `${API_BASE}?q=${encodeURIComponent(query)}&max=${MAX_ARTICLES}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API Error ${response.status}`);
  const json = await response.json();
  return json.articles || [];
}

// ===== RENDER HEADER DATE =====
function renderHeaderDate() {
  const el = document.getElementById('header-date');
  if (!el) return;
  const now = new Date();
  el.textContent = fmtDateLong(now).replace(/^\w/, c => c.toUpperCase());
}

// ===== RENDER CAT NAV =====
function renderCatNav() {
  const nav = document.getElementById('cat-nav');
  if (!nav) return;
  nav.innerHTML = CATEGORIES.map(c => `
    <button class="cat-btn ${c.id === currentCat ? 'active' : ''}" data-cat="${c.id}">
      ${c.label}
    </button>
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

// ===== RENDER HOME =====
async function renderHome() {
  const main = document.getElementById('main-content');
  main.innerHTML = `<div class="loading"><div class="spinner"></div><div class="loading-text">Chargement des actualités…</div></div>`;

  // Date selon l'offset
  let dateStr = null;
  if (dateOffset > 0) {
    const d = new Date();
    d.setDate(d.getDate() - dateOffset);
    dateStr = d.toISOString().split('T')[0];
  }

  let articles;
  try {
    ({ articles } = await fetchArticles(currentCat, dateStr));
  } catch (e) {
    main.innerHTML = `
      <div class="error-box">
        <p>Impossible de charger les articles.<br>Vérifiez votre connexion.</p>
        <button onclick="renderHome()">Réessayer</button>
      </div>`;
    return;
  }

  if (!articles.length) {
    main.innerHTML = `
      <div class="date-nav">${renderDateNav()}</div>
      <div class="error-box" style="margin-top:24px;">
        <p>Aucun article disponible pour cette période.</p>
      </div>`;
    document.getElementById('main-content').querySelector('.date-nav')
      && bindDateNav(document.getElementById('main-content'));
    return;
  }

  const hero = articles[0];
  const rest = articles.slice(1);

  const catLabel = getCatLabel(currentCat);
  const catIcon = getCatIcon(currentCat);

  let html = `
    <div class="home-view">
      ${renderDateNavHTML()}

      <!-- HERO -->
      <div class="hero-article" data-url="${esc(hero.url)}">
        ${hero.image
          ? `<img class="hero-img" src="${esc(hero.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ''}
        <div class="hero-no-img" ${hero.image ? 'style="display:none"' : ''}>${catIcon}</div>
        <div class="hero-overlay">
          <div class="hero-cat">${catLabel}</div>
          <div class="hero-title">${esc(hero.title)}</div>
          <div class="hero-meta">${hero.source?.name || ''} · ${fmtDate(hero.publishedAt)}</div>
        </div>
        <button class="hero-save ${isArticleSaved(hero.url) ? 'saved' : ''}" data-url="${esc(hero.url)}" data-idx="0">
          ${isArticleSaved(hero.url) ? '🔖' : '🔖'}
        </button>
      </div>

      <!-- LISTE -->
      ${rest.length ? `
        <div class="section-header">
          <span class="section-title">${catLabel} — ${dateOffset === 0 ? 'Aujourd\'hui' : fmtDateOffset(dateOffset)}</span>
          <span class="section-line"></span>
        </div>
        <div class="article-list">
          ${rest.map((a, i) => renderArticleCard(a, i + 1, catLabel)).join('')}
        </div>
      ` : ''}
    </div>
  `;

  main.innerHTML = html;

  // Stocker les articles pour y accéder au clic
  main._articles = articles;

  // Events
  bindHomeEvents(main, articles);
}

function renderDateNavHTML() {
  const today = new Date();
  const d = new Date();
  d.setDate(d.getDate() - dateOffset);
  const label = dateOffset === 0 ? 'Aujourd\'hui' : dateOffset === 1 ? 'Hier' : fmtDateOffset(dateOffset);

  return `
    <div class="date-nav">
      <button class="date-nav-btn" id="date-prev" ${dateOffset >= MAX_DAYS_BACK ? 'disabled' : ''}>&#8249;</button>
      <span class="date-nav-label">${label}</span>
      <button class="date-nav-btn" id="date-next" ${dateOffset <= 0 ? 'disabled' : ''}>&#8250;</button>
    </div>
  `;
}

function renderDateNav() {
  return renderDateNavHTML();
}

function fmtDateOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function bindDateNav(container) {
  const prevBtn = container.querySelector('#date-prev');
  const nextBtn = container.querySelector('#date-next');
  if (prevBtn) prevBtn.addEventListener('click', () => { dateOffset++; renderHome(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { dateOffset = Math.max(0, dateOffset - 1); renderHome(); });
}

function renderArticleCard(article, idx, catLabel) {
  const saved = isArticleSaved(article.url);
  return `
    <div class="article-card" data-url="${esc(article.url)}" data-idx="${idx}">
      <div class="article-card-body">
        <div class="article-cat-tag">${esc(catLabel)}</div>
        <div class="article-title">${esc(article.title)}</div>
        ${article.description ? `<div class="article-desc">${esc(article.description)}</div>` : ''}
        <div class="article-meta">
          <span>${esc(article.source?.name || '')}</span>
          <span class="sep">·</span>
          <span>${fmtDate(article.publishedAt)}</span>
        </div>
      </div>
      ${article.image
        ? `<img class="article-thumb" src="${esc(article.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="article-thumb-placeholder">${getCatIcon(currentCat)}</div>`
      }
      <button class="card-save-btn ${saved ? 'saved' : ''}" data-url="${esc(article.url)}" data-idx="${idx}">🔖</button>
    </div>
  `;
}

function bindHomeEvents(container, articles) {
  // Date nav
  bindDateNav(container);

  // Clic article
  container.querySelectorAll('.hero-article, .article-card').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.hero-save') || e.target.closest('.card-save-btn')) return;
      const idx = parseInt(el.dataset.idx || '0');
      openArticle(articles[idx], currentCat);
    });
  });

  // Save buttons
  container.querySelectorAll('.hero-save, .card-save-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx || '0');
      const article = articles[idx];
      toggleSave(article);
      // Mettre à jour visuellement
      const saved = isArticleSaved(article.url);
      btn.classList.toggle('saved', saved);
      // Si on est dans la vue saved, re-render
      if (currentView === 'saved') renderSaved();
    });
  });
}

// ===== OPEN ARTICLE =====
function renderArticleShell(article, catId, bodyHtml) {
  const saved = isArticleSaved(article.url);
  const catLabel = getCatLabel(catId || currentCat);
  return `
    <div class="article-reader">
      <div class="reader-header">
        <button class="reader-back" id="reader-back">&#8592;</button>
        <span class="reader-title-small">${esc(article.title)}</span>
        <button class="reader-save-btn ${saved ? 'saved' : ''}" id="reader-save-btn">
          ${saved ? '🔖 Sauvegardé' : '🔖 Sauvegarder'}
        </button>
      </div>

      ${article.image ? `<img class="reader-img" src="${esc(article.image)}" alt="" loading="lazy">` : ''}

      <div class="reader-content">
        <div class="reader-cat">${esc(catLabel)}</div>
        <h1 class="reader-headline">${esc(article.title)}</h1>
        <div class="reader-byline">
          <span>${esc(article.source?.name || '')}</span>
          <span>·</span>
          <span>${fmtDate(article.publishedAt)}</span>
          ${article.publishedAt ? `<span>·</span><span>${new Date(article.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>` : ''}
        </div>

        <div class="reader-divider"><span>◆</span></div>

        ${article.description ? `<div class="reader-description">${esc(article.description)}</div>` : ''}

        <div id="reader-body-slot">${bodyHtml}</div>

        <a href="${esc(article.url)}" target="_blank" rel="noopener" class="reader-more">
          Lire l'article sur ${esc(article.source?.name || 'la source')} →
        </a>

        <div class="reader-source">
          Source : ${esc(article.source?.name || '')}
        </div>
      </div>
    </div>
  `;
}

function openArticle(article, catId) {
  currentArticle = article;
  const overlay = document.getElementById('article-overlay');
  overlay.classList.remove('hidden');
  overlay.scrollTop = 0;

  // Afficher d'abord le shell avec un spinner dans le corps
  const loadingBody = `<div class="reader-loading"><div class="spinner"></div></div>`;
  overlay.innerHTML = renderArticleShell(article, catId, loadingBody);

  // Events immédiatement
  document.getElementById('reader-back').addEventListener('click', closeArticle);
  document.getElementById('reader-save-btn').addEventListener('click', () => {
    toggleSave(article);
    const s = isArticleSaved(article.url);
    const btn = document.getElementById('reader-save-btn');
    if (btn) {
      btn.classList.toggle('saved', s);
      btn.textContent = s ? '🔖 Sauvegardé' : '🔖 Sauvegarder';
    }
    if (currentView === 'saved') renderSaved();
  });

  // Charger le contenu complet en arrière-plan
  fetchFullArticle(article.url);
}

async function fetchFullArticle(url) {
  if (!document.getElementById('reader-body-slot')) return;
  try {
    const res = await fetch(`/api/article?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    const slot = document.getElementById('reader-body-slot');
    if (!slot) return;
    if (data.paragraphs && data.paragraphs.length) {
      slot.innerHTML = `<div class="reader-body">${data.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
    } else {
      slot.innerHTML = `<div class="reader-unavailable">Article complet non disponible — le site source bloque la lecture intégrée.</div>`;
    }
  } catch {
    const slot = document.getElementById('reader-body-slot');
    if (slot) slot.innerHTML = `<div class="reader-unavailable">Article complet non disponible — le site source bloque la lecture intégrée.</div>`;
  }
}

function closeArticle() {
  const overlay = document.getElementById('article-overlay');
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
  currentArticle = null;
}

// ===== RENDER SEARCH =====
function renderSearch() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="search-view">
      <div class="search-box-wrap">
        <input type="search" class="search-input" id="search-input"
          placeholder="Rechercher dans les actualités…"
          value="${esc(searchQuery)}"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false">
        <button class="search-btn" id="search-btn">🔍</button>
      </div>
      <div id="search-results"></div>
    </div>
  `;

  const input = document.getElementById('search-input');
  const btn = document.getElementById('search-btn');
  const results = document.getElementById('search-results');

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) return;
    searchQuery = q;
    results.innerHTML = `<div class="loading"><div class="spinner"></div><div class="loading-text">Recherche en cours…</div></div>`;
    try {
      const articles = await searchArticles(q);
      if (!articles.length) {
        results.innerHTML = `<div class="search-hint">Aucun résultat pour « ${esc(q)} »</div>`;
        return;
      }
      results.innerHTML = `
        <div class="search-results-count">${articles.length} résultat${articles.length > 1 ? 's' : ''} pour « ${esc(q)} »</div>
        <div class="article-list">
          ${articles.map((a, i) => renderArticleCard(a, i, getCatLabel(currentCat))).join('')}
        </div>
      `;
      // Bind article clicks
      results.querySelectorAll('.article-card').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.card-save-btn')) return;
          const idx = parseInt(el.dataset.idx);
          openArticle(articles[idx], 'general');
        });
      });
      results.querySelectorAll('.card-save-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          toggleSave(articles[idx]);
          btn.classList.toggle('saved', isArticleSaved(articles[idx].url));
        });
      });
    } catch (e) {
      results.innerHTML = `<div class="error-box"><p>Erreur de recherche. Réessayez.</p></div>`;
    }
  };

  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  if (searchQuery) {
    doSearch();
  } else {
    results.innerHTML = `<div class="search-hint">Tapez un mot-clé pour rechercher<br>dans les actualités françaises</div>`;
  }

  input.focus();
}

// ===== RENDER SAVED =====
function renderSaved() {
  const main = document.getElementById('main-content');
  if (!savedArticles.length) {
    main.innerHTML = `
      <div class="saved-view">
        <div class="section-header">
          <span class="section-title">Articles sauvegardés</span>
          <span class="section-line"></span>
        </div>
        <div class="saved-empty">
          <div class="icon">🔖</div>
          <p>Vous n'avez pas encore<br>sauvegardé d'articles.</p>
        </div>
      </div>
    `;
    return;
  }

  main.innerHTML = `
    <div class="saved-view">
      <div class="section-header">
        <span class="section-title">${savedArticles.length} article${savedArticles.length > 1 ? 's' : ''} sauvegardé${savedArticles.length > 1 ? 's' : ''}</span>
        <span class="section-line"></span>
      </div>
      <div class="article-list">
        ${savedArticles.map((a, i) => renderArticleCard(a, i, '')).join('')}
      </div>
    </div>
  `;

  main.querySelectorAll('.article-card').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-save-btn')) return;
      const idx = parseInt(el.dataset.idx);
      openArticle(savedArticles[idx], 'general');
    });
  });
  main.querySelectorAll('.card-save-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      toggleSave(savedArticles[idx]);
      renderSaved(); // re-render
    });
  });
}

// ===== BOTTOM NAV =====
function bindBottomNav() {
  document.getElementById('bottom-nav').querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === currentView) return;
      setView(view);
    });
  });
}

function setView(view) {
  currentView = view;
  // Update nav active state
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  // Show/hide cat nav (only on home)
  const catNav = document.getElementById('cat-nav');
  if (catNav) catNav.style.display = view === 'home' ? '' : 'none';

  if (view === 'home') renderHome();
  else if (view === 'search') renderSearch();
  else if (view === 'saved') renderSaved();
}

// ===== SERVICE WORKER =====
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function forceUpdate() {
  const btn = document.getElementById('sw-update-btn');
  if (btn) { btn.textContent = '↻ Mise à jour…'; btn.disabled = true; }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      Promise.all(regs.map(r => r.unregister())).then(() => {
        window.location.reload(true);
      });
    });
  } else {
    window.location.reload(true);
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  renderHeaderDate();
  renderCatNav();
  bindBottomNav();
  registerSW();
  renderHome();
});
