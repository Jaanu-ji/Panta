import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPanta, PantaError } from './panta.js';
import { createSolami, txAccountKeys } from './solami.js';
import { computeSignals } from './signals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const { PANTA_API_KEY, SOLAMI_API_KEY } = process.env;
const PORT = Number(process.env.PORT || 8787);
const MAX_TRACKED = Number(process.env.MAX_TRACKED || 40);

if (!PANTA_API_KEY || !SOLAMI_API_KEY) {
  console.error('Missing PANTA_API_KEY or SOLAMI_API_KEY. Run `npm run setup` first.');
  process.exit(1);
}

const panta = createPanta(PANTA_API_KEY);
const solami = createSolami(SOLAMI_API_KEY);

// ---------- state ----------
const HISTORY_FILE = path.join(ROOT, 'data', 'history.json');
fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
let history = {};
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
const saveHistory = () => fs.writeFile(HISTORY_FILE, JSON.stringify(history), () => {});
setInterval(saveHistory, 30_000);

const markets = new Map(); // id -> { market, trades, signals, updatedAt }
const chainFeed = []; // recent on-chain events seen through Solami
let catalog = [];
let programId = null;

// ---------- SSE ----------
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function summary(id) {
  const m = markets.get(id);
  if (!m) return null;
  const { market, signals, updatedAt } = m;
  return {
    marketId: id, title: market.title, category: market.category, phase: market.phase,
    image: market.images?.[0] || null, endTime: market.endTime, volumeUsdc: market.volumeUsdc,
    yes: signals.yes, change1h: signals.change1h, change24h: signals.change24h,
    trades24h: signals.trades24h, pulse: signals.pulse, open: isOpen(market), hot: signals.insights.some((i) => i.level === 'hot'),
    spark: (history[id] || []).slice(-60).map((p) => p.yes), updatedAt,
  };
}

// ---------- price + ranking helpers ----------
// Panta returns null prices for some phases; fall back to the phase price, then
// to the implied price of the most recent priced trade (USDC paid / shares).
function resolveYes(market, trades) {
  for (const k of ['yesPrice', 'secondaryYesPrice', 'primaryYesPrice']) {
    if (market[k] != null && market[k] !== '') return Number(market[k]);
  }
  for (const t of trades) {
    const usdc = Number(t.amountUsdc), sh = Number(t.shares);
    if (usdc > 0 && sh > 0) {
      const p = Math.min(0.99, Math.max(0.01, usdc / sh));
      return t.side === 'yes' ? p : 1 - p;
    }
  }
  return null;
}
const isOpen = (m) => !m.resolved && !/resolved|closed|cancel/i.test(m.status || m.phase || '') && (!m.endTime || Number(m.endTime) > Date.now() / 1000);
const isShowable = (m) => (m.title || '').trim() && !/^\[TEST\]/i.test(m.title);

// ---------- refresh logic ----------
async function refreshCatalog() {
  const rows = [];
  for (const status of [undefined, 'primary', 'secondary']) {
    let cursor;
    for (let page = 0; page < 4; page++) {
      const r = await panta.listMarkets({ status, cursor });
      rows.push(...(r.items || []));
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
  }
  const seen = new Set();
  for (let i = rows.length - 1; i >= 0; i--) { if (seen.has(rows[i].marketId)) rows.splice(i, 1); else seen.add(rows[i].marketId); }
  const score = (m) => (isOpen(m) ? 1e12 : 0) + Number(m.endTime || 0);
  rows.sort((a, b) => score(b) - score(a));
  catalog = rows.filter(isShowable);
  return catalog.slice(0, MAX_TRACKED).map((r) => r.marketId);
}

async function refreshMarket(id, reason = 'poll') {
  const [market, t] = await Promise.all([panta.getMarket(id), panta.marketTrades(id, 200)]);
  const trades = (t.items || []).sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));
  const now = Math.floor(Date.now() / 1000);
  market.yesPrice = resolveYes(market, trades);
  if (market.yesPrice != null) {
    const h = (history[id] ||= []);
    const last = h[h.length - 1];
    if (!last || last.yes !== Number(market.yesPrice) || now - last.t > 300) h.push({ t: now, yes: Number(market.yesPrice) });
    if (h.length > 2000) h.splice(0, h.length - 2000);
  }
  const prev = markets.get(id);
  const signals = computeSignals(market, trades, history[id] || [], now);
  markets.set(id, { market, trades, signals, updatedAt: Date.now() });
  const newTrades = prev ? trades.filter((x) => !prev.trades.some((p) => p.signature === x.signature)) : [];
  broadcast('market', { ...summary(id), reason, newTrades: newTrades.slice(0, 10) });
  return markets.get(id);
}

async function discoverProgram(ids) {
  for (const id of ids.slice(0, 5)) {
    try {
      const owner = await solami.getAccountOwner(id);
      if (owner) return owner;
    } catch (e) { console.warn('owner lookup failed', e.message); }
  }
  return null;
}

// On-chain event from Solami → figure out which market it touched → refresh just that market.
const pendingSigs = new Set();
solami.events.on('programTx', async ({ signature, slot }) => {
  if (pendingSigs.has(signature)) return;
  pendingSigs.add(signature);
  const seenAt = Date.now();
  try {
    let tx = null;
    for (let i = 0; i < 4 && !tx; i++) {
      tx = await solami.getTransaction(signature);
      if (!tx) await new Promise((r) => setTimeout(r, 1200));
    }
    const keys = new Set(txAccountKeys(tx));
    const hit = [...keys].filter((k) => markets.has(k) || catalog.some((c) => c.marketId === k));
    const evt = {
      signature, slot, seenAt, latencyMs: tx?.blockTime ? seenAt - tx.blockTime * 1000 : null,
      marketIds: hit, titles: hit.map((id) => markets.get(id)?.market.title || catalog.find((c) => c.marketId === id)?.title),
    };
    chainFeed.unshift(evt);
    chainFeed.length = Math.min(chainFeed.length, 100);
    broadcast('chain', evt);
    for (const id of hit) await refreshMarket(id, 'onchain').catch(() => {});
  } catch (e) {
    console.warn('programTx handling failed', e.message);
  } finally {
    setTimeout(() => pendingSigs.delete(signature), 60_000);
  }
});
solami.events.on('status', (h) => broadcast('health', healthPayload()));

function healthPayload() {
  return { ...solami.health, pantaKeyEnv: PANTA_API_KEY.startsWith('pk_live_') ? 'live' : PANTA_API_KEY.startsWith('pk_test_') ? 'test' : 'other', programId, tracked: markets.size, catalog: catalog.length, sseClients: clients.size, now: Date.now() };
}

async function boot() {
  solami.start();
  const ids = await refreshCatalog();
  console.log(`Panta key: ${healthPayload().pantaKeyEnv} | catalog: ${catalog.length} markets, tracking ${ids.length}`);
  programId = await discoverProgram(ids);
  if (programId) { console.log('Panta program:', programId); solami.watchProgram(programId); }
  else console.warn('Could not discover Panta program id — running in poll-only mode.');
  for (const id of ids) {
    await refreshMarket(id, 'boot').catch((e) => console.warn('refresh', id, e.code || e.message));
    await new Promise((r) => setTimeout(r, 1100)); // stay well under Panta read limits
  }
  // Round-robin background refresh as a safety net behind the live stream.
  let i = 0;
  setInterval(() => {
    const all = [...markets.keys()];
    if (all.length) refreshMarket(all[i++ % all.length]).catch(() => {});
  }, 4000);
  setInterval(() => refreshCatalog().catch(() => {}), 5 * 60_000);
  setInterval(() => broadcast('health', healthPayload()), 5000);
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(ROOT, 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  const status = e instanceof PantaError ? e.status : 500;
  res.status(status).json({ code: e.code || 'ERROR', message: e.message });
});

app.get('/api/markets', (req, res) => {
  const list = [...markets.keys()].map(summary).filter(Boolean).sort((a, b) => (b.open - a.open) || (b.pulse - a.pulse));
  res.json({ items: list });
});

app.get('/api/markets/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const m = markets.get(id) || (await refreshMarket(id, 'on-demand'));
  res.json({ ...summary(id), market: m.market, signals: m.signals, trades: m.trades.slice(0, 100), history: history[id] || [] });
}));

app.get('/api/feed', (req, res) => res.json({ items: chainFeed.slice(0, 50) }));
app.get('/api/health', (req, res) => res.json(healthPayload()));

app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: health\ndata: ${JSON.stringify(healthPayload())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Trading: Panta builds, the user's wallet signs in the browser, Solami lands it.
app.post('/api/quote', wrap(async (req, res) => {
  const { wallet, marketId, side, amountUsdc } = req.body;
  res.json(await panta.quoteBuy({ wallet, marketId, side, amountUsdc: String(amountUsdc) }));
}));
app.post('/api/build', wrap(async (req, res) => {
  const { quoteId, wallet, maxSlippageBps = 100 } = req.body;
  res.json(await panta.buildBuy({ quoteId, wallet, maxSlippageBps }));
}));
app.post('/api/send', wrap(async (req, res) => {
  const { signedTx, orderId, wallet } = req.body;
  const signature = await solami.sendRawTransaction(signedTx);
  const submitted = await panta.submitBuy({ orderId, signature, wallet }).catch((e) => ({ error: e.message }));
  res.json({ signature, submitted });
}));
app.get('/api/tx/:sig', wrap(async (req, res) => res.json(await solami.signatureStatus(req.params.sig))));

app.listen(PORT, () => {
  console.log(`Panta Pulse → http://localhost:${PORT}`);
  boot().catch((e) => console.error('Boot failed:', e.code || '', e.message));
});
