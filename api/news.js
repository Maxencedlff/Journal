// Clé GNews : variable d'environnement Vercel GNEWS_API_KEY, jamais dans le code (dépôt public).
const API_KEY = process.env.GNEWS_API_KEY;
const API_BASE = 'https://gnews.io/api/v4';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!API_KEY) {
    res.status(500).json({ error: 'GNEWS_API_KEY manquante dans les variables Vercel' });
    return;
  }

  const { category, q, from, to, max = 10, page = 1 } = req.query;

  let url;
  if (q) {
    url = `${API_BASE}/search?q=${encodeURIComponent(q)}&lang=fr&country=fr&max=${max}&page=${page}&token=${API_KEY}`;
  } else {
    url = `${API_BASE}/top-headlines?category=${category || 'general'}&lang=fr&country=fr&max=${max}&page=${page}&token=${API_KEY}`;
    if (from) url += `&from=${from}`;
    if (to) url += `&to=${to}`;
  }

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur proxy' });
  }
}
