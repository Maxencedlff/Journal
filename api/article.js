import { parse } from 'node-html-parser';

// Sélecteurs spécifiques par domaine (du plus précis au plus général)
const SITE_SELECTORS = {
  'ouest-france.fr':     ['.article-body', '.article__body', '[itemprop="articleBody"]'],
  'franceinfo.fr':       ['.c-body', '.article-text', '[itemprop="articleBody"]'],
  '20minutes.fr':        ['.lt-article-body', '.article-body', '[itemprop="articleBody"]'],
  'bfmtv.com':           ['.bf-article-content', '.article-body', '[itemprop="articleBody"]'],
  'leparisien.fr':       ['.article__body', '.article-body', '[itemprop="articleBody"]'],
  'lemonde.fr':          ['.article__content', '[itemprop="articleBody"]'],
  'liberation.fr':       ['.article-body', '.content', '[itemprop="articleBody"]'],
  'lefigaro.fr':         ['.fig-content-body', '[itemprop="articleBody"]'],
  'lexpress.fr':         ['.article-text', '[itemprop="articleBody"]'],
  'lequipe.fr':          ['.article__body', '[itemprop="articleBody"]'],
  'europe1.fr':          ['.article-body', '[itemprop="articleBody"]'],
  'rtl.fr':              ['.article-body', '[itemprop="articleBody"]'],
  'challenges.fr':       ['.article-body', '[itemprop="articleBody"]'],
  'lepoint.fr':          ['.article-body-content', '[itemprop="articleBody"]'],
  'lyonmag.com':         ['.article-body', 'article .content', '[itemprop="articleBody"]'],
  'lindependant.fr':     ['.article-body', '[itemprop="articleBody"]'],
  'sudouest.fr':         ['.article-body', '[itemprop="articleBody"]'],
  'lavoixdunord.fr':     ['.article-body', '[itemprop="articleBody"]'],
  'courrier-picard.fr':  ['.article-body', '[itemprop="articleBody"]'],
  'frandroid.com':       ['.article-body', '.post-content', '[itemprop="articleBody"]'],
  'numerama.com':        ['.post-content', '[itemprop="articleBody"]'],
  'clubic.com':          ['.article-content', '[itemprop="articleBody"]'],
  'tradingsat.com':      ['.article-content', '[itemprop="articleBody"]'],
};

// Sélecteurs génériques de fallback
const GENERIC_SELECTORS = [
  '[itemprop="articleBody"]',
  '.article-body',
  '.article__body',
  '.article-content',
  '.article__content',
  '.article-text',
  '.articleBody',
  '.post-content',
  '.entry-content',
  '.content-article',
  '.story-body',
  '.story__body',
  'article .content',
  'article',
];

// Éléments à supprimer avant extraction
const REMOVE_SELECTORS = [
  'script', 'style', 'nav', 'header', 'footer', 'aside',
  'figure', 'figcaption', '.pub', '.ads', '.advertisement',
  '.social-share', '.newsletter', '.related', '.comments',
  '.paywall', '.subscription', '.abonnement',
  '[class*="related"]', '[class*="share"]', '[class*="pub"]',
  '[class*="newsletter"]', '[class*="paywall"]', '[class*="abonne"]',
  '[class*="partner"]', '[class*="teaser"]',
];

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch { return ''; }
}

function getSelectors(url) {
  const domain = getDomain(url);
  // Cherche une correspondance partielle dans les domaines connus
  for (const [key, sels] of Object.entries(SITE_SELECTORS)) {
    if (domain.includes(key)) return [...sels, ...GENERIC_SELECTORS];
  }
  return GENERIC_SELECTORS;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'URL manquante' }); return; }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Referer': 'https://www.google.com/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Site inaccessible (${response.status})` });
      return;
    }

    const html = await response.text();
    const root = parse(html);

    // Supprimer les éléments parasites
    for (const sel of REMOVE_SELECTORS) {
      try { root.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
    }

    // Trouver le bon conteneur
    const selectors = getSelectors(url);
    let container = null;
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) { container = el; break; }
      } catch {}
    }

    if (!container) {
      res.status(422).json({ error: 'Structure de page non reconnue' });
      return;
    }

    // Extraire les paragraphes non vides
    const paragraphs = container.querySelectorAll('p')
      .map(p => p.text.replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 50);

    if (!paragraphs.length) {
      res.status(422).json({ error: 'Aucun contenu extrait' });
      return;
    }

    res.setHeader('Cache-Control', 's-maxage=7200');
    res.status(200).json({ paragraphs });

  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Délai dépassé' : 'Erreur réseau';
    res.status(500).json({ error: msg });
  }
}
