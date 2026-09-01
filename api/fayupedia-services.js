// /api/fayupedia-services.js
// Vercel Serverless Function - Proxy ke Fayupedia API
// Mengambil daftar layanan, markup harga 5%, group by category

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      status: false,
      msg: 'Method not allowed'
    });
  }

  try {
    const apiId = parseInt(process.env.FAYUPEDIA_API_ID) || 5522;
    const apiKey = process.env.FAYUPEDIA_API_KEY || '';

    if (!apiKey) {
      console.error('FAYUPEDIA_API_KEY tidak ditemukan di environment');
      return res.status(500).json({
        status: false,
        msg: 'Konfigurasi API belum lengkap (FAYUPEDIA_API_KEY missing)'
      });
    }

    // POST ke Fayupedia
    const response = await fetch('https://fayupedia.id/api/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        api_id: apiId,
        api_key: apiKey
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('Fayupedia API HTTP error:', response.status, text);
      return res.status(502).json({
        status: false,
        msg: `Gagal menghubungi provider (HTTP ${response.status})`
      });
    }

    const data = await response.json();

    if (!data.status || !Array.isArray(data.services)) {
      console.error('Fayupedia response invalid:', data);
      return res.status(502).json({
        status: false,
        msg: data.msg || 'Respon provider tidak valid'
      });
    }

    // Group by category + markup 5% + map ke format frontend
    const grouped = {};
    const MARKUP = 1.08; // +5%

    for (const s of data.services) {
      const category = (s.category || 'Lainnya').trim() || 'Lainnya';
      if (!grouped[category]) {
        grouped[category] = [];
      }
    
      // Deteksi apakah butuh komentar berdasarkan type
      const type = (s.type || 'default').toLowerCase();
      const needsComment =
        type.includes('comment') ||
        type === 'custom_comment' ||
        type === 'comment_likes' ||
        type === 'comment_reply';

      // Harga dari Fayupedia = per 1.000 unit
      // Markup 5%, dibulatkan — frontend: total = (jumlah / 1000) * price
      const rawPrice = Number(s.price) || 0;
      const markedUpPrice = Math.round(rawPrice * MARKUP);

      grouped[category].push({
        id: s.id,
        name: s.name || `Service #${s.id}`,
        // pricePerFollower = harga per 1000 (setelah markup)
        pricePerFollower: markedUpPrice,
        // Tidak ada diskon dari provider → tidak set field diskon
        min: Number(s.min) || 1,
        max: Number(s.max) || 1000000,
        average: s.average || '-', // provider tidak kirim average
        desc: s.description || '',
        comment: needsComment,
        type: s.type || 'default',
        refill: s.refill === 1 || s.refill === true
      });
    }

    // Urutkan kategori & layanan (opsional, biar rapi)
    const sorted = {};
    Object.keys(grouped)
      .sort((a, b) => a.localeCompare(b, 'id'))
      .forEach((cat) => {
        sorted[cat] = grouped[cat].sort((a, b) =>
          String(a.name).localeCompare(String(b.name), 'id')
        );
      });

    // Cache singkat di edge (opsional)
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

    return res.status(200).json(sorted);
  } catch (error) {
    console.error('Error fayupedia-services:', error);
    return res.status(500).json({
      status: false,
      msg: 'Internal server error'
    });
  }
}
