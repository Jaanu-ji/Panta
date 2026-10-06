// Thin Panta API client. The API key never leaves the server.
const BASE = 'https://live-api.panta.market/api/v1';

export class PantaError extends Error {
  constructor(status, body) {
    super(body?.message || `Panta HTTP ${status}`);
    this.status = status;
    this.code = body?.code || 'HTTP_' + status;
    this.body = body;
  }
}

export function createPanta(apiKey) {
  async function call(path, { method = 'GET', body, query } = {}) {
    const url = new URL(BASE + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, {
        method,
        headers: { 'X-Api-Key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') || 2) * 1000 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) throw new PantaError(res.status, json);
      return json;
    }
    throw new PantaError(429, { code: 'RATE_LIMITED', message: 'Rate limited after retries' });
  }

  return {
    categories: () => call('/categories/'),
    listMarkets: (q = {}) => call('/markets/', { query: { limit: 50, ...q } }),
    getMarket: (id) => call(`/markets/${id}/`),
    marketTrades: (id, limit = 200) => call(`/markets/${id}/trades/`, { query: { limit } }),
    quoteBuy: (b) => call('/primaryorderquote/', { method: 'POST', body: b }),
    buildBuy: (b) => call('/primaryorderbuild/', { method: 'POST', body: b }),
    submitBuy: (b) => call('/primaryordersubmit/', { method: 'POST', body: b }),
  };
}
