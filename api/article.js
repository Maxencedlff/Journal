import { parse } from 'node-html-parser';

// Sélecteurs courants pour le contenu principal des articles
const CONTENT_SELECTORS = [
  'article .article-body',
  'article .article__body',
  'article .article-content',
  'article .article__content',
  '.article-body',
  '.article__body',
  '.article-content',
  '.article__content',
  '.article-text',
  '.articleBody',
  '[itemprop="articleBody"]',
  '.post-content',
  '.entry-content',
  '.content-article',
  '.story-body',
  '.story__body',
  '.lp-article-body',
  '.article__chapo',
  'article',
  'main',
];

// Éléments à supprimer dans le contenu
const REMOVE_SELECTORS = [
  'script', 'style', 'nav', 'header', 'footer',
  'aside', 'figure', '.pub', '.ads', '.advertisement',
  '.social-share', '.newsletter', '.related', '.comments',
  '[class*="related"]', '[class*="share"]', '[class*="pub"]',
  '[class*="newsletter"]', '[class*="paywall"]',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'URL manquante' }); return; }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: 'Impossible de charger la page' });
      return;
    }

    const html = await response.text();
    const root = parse(html);

    // Supprimer les éléments indésirables
    REMOVE_SELECTORS.forEach(sel => {
      try { root.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
    });

    // Trouver le conteneur principal
    let container = null;
    for (const sel of CONTENT_SELECTORS) {
      try {
        const el = root.querySelector(sel);
        if (el) { container = el; break; }
      } catch {}
    }

    if (!container) {
      res.status(422).json({ error: 'Contenu non trouvé' });
      return;
    }

    // Extraire les paragraphes
    const paragraphs = container.querySelectorAll('p')
      .map(p => p.text.trim())
      .filter(t => t.length > 40); // ignorer les très courts

    if (paragraphs.length === 0) {
      res.status(422).json({ error: 'Aucun paragraphe trouvé' });
      return;
    }

    res.setHeader('Cache-Control', 's-maxage=3600');
    res.status(200).json({ paragraphs });

  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
}
