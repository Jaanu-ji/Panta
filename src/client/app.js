import { Buffer } from 'buffer';
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
window.Buffer = Buffer;

const $ = (s) => document.querySelector(s);
const state = { markets: new Map(), selected: null, detail: null, cat: 'all', q: '', wallet: null };
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const pts = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}`);
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
const ago = (t) => { if (!t) return ''; const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3500); }
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || j.code || r.status);
  return j;
}

function spark(values, w = 90, h = 26) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), r = max - min || 1;
  const d = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / r) * h}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return `<svg width="${w}" height="${h}"><polyline fill="none" stroke="${up ? 'var(--yes)' : 'var(--no)'}" stroke-width="1.5" points="${d}"/></svg>`;
}

// ---------- market list ----------
function renderList() {
  const cats = ['all', ...new Set([...state.markets.values()].map((m) => m.category))];
  $('#cats').innerHTML = cats.map((c) => `<span class="tab ${c === state.cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</span>`).join('');
  const rows = [...state.markets.values()]
    .filter((m) => (state.cat === 'all' || m.category === state.cat) && (!state.q || m.title.toLowerCase().includes(state.q)))
    .sort((a, b) => ((b.open !== false) - (a.open !== false)) || (b.pulse - a.pulse));
  $('#markets').innerHTML = rows.map((m) => `
    <div class="m ${m.marketId === state.selected ? 'sel' : ''}" data-id="${m.marketId}">
      <div class="t">${esc(m.title)}</div>
      <div class="p">${pct(m.yes)}</div>
      <div class="meta">${m.hot ? '<span class="badge">HOT</span>' : ''}${m.open === false ? '<span class="badge" style="opacity:.55">ENDED</span>' : '<span class="badge" style="background:#1f6f43">LIVE</span>'}<span>${esc(m.category)}</span><span>${m.trades24h} trades/24h</span>
        <span class="${(m.change24h ?? 0) >= 0 ? 'up' : 'down'}">${pts(m.change24h)}</span></div>
      <div>${spark(m.spark)}</div>
    </div>`).join('') || '<div class="empty">Loading live markets…</div>';
}
$('#cats').addEventListener('click', (e) => { const c = e.target.dataset.c; if (c) { state.cat = c; renderList(); } });
$('#search').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); renderList(); });
$('#markets').addEventListener('click', (e) => { const el = e.target.closest('.m'); if (el) select(el.dataset.id); });

// ---------- detail ----------
async function select(id) {
  state.selected = id;
  renderList();
  state.detail = await api(`/api/markets/${id}`);
  renderDetail();
}

function chart(history) {
  const pts_ = history.slice(-300);
  if (pts_.length < 2) return '<div class="muted" style="padding:60px;text-align:center">Collecting price history — updates live as trades land.</div>';
  const W = 800, H = 180, t0 = pts_[0].t, t1 = pts_[pts_.length - 1].t || t0 + 1;
  const x = (t) => ((t - t0) / (t1 - t0 || 1)) * W, y = (v) => H - v * H;
  const line = pts_.map((p) => `${x(p.t).toFixed(1)},${y(p.yes).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${[0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${W}" y1="${y(g)}" y2="${y(g)}" stroke="#232836" stroke-dasharray="4 4"/>`).join('')}
    <polyline fill="none" stroke="var(--yes)" stroke-width="2" points="${line}" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function renderDetail(newSigs = new Set()) {
  const d = state.detail; if (!d) return;
  const s = d.signals, m = d.market;
  $('#detail').innerHTML = `
    <div class="d-head">${d.image ? `<img src="${esc(d.image)}" alt="">` : ''}
      <div><h1>${esc(d.title)}</h1><div class="muted">${esc(m.category)} · ${esc(m.phase)} phase · ${m.endTime ? `ends ${new Date(typeof m.endTime === 'number' ? m.endTime * 1000 : m.endTime).toLocaleString()}` : 'no end date'} ·
      <a href="https://solscan.io/account/${d.marketId}" target="_blank">${short(d.marketId)}</a></div></div></div>
    <div class="kpis">
      <div class="kpi"><div class="l">YES odds</div><div class="v up">${pct(s.yes)}</div></div>
      <div class="kpi"><div class="l">1h / 24h</div><div class="v"><span class="${(s.change1h ?? 0) >= 0 ? 'up' : 'down'}">${pts(s.change1h)}</span> / <span class="${(s.change24h ?? 0) >= 0 ? 'up' : 'down'}">${pts(s.change24h)}</span></div></div>
      <div class="kpi"><div class="l">Trades · wallets 24h</div><div class="v">${s.trades24h} · ${s.uniqueWallets24h}</div></div>
      <div class="kpi"><div class="l">Pulse score</div><div class="v">${s.pulse}</div></div>
    </div>
    <div class="chart">${chart(d.history)}</div>
    <div class="muted" style="margin-top:10px">Buy pressure (24h shares) — YES ${pct(s.buyPressureYes)}</div>
    <div class="pressure"><div style="width:${(s.buyPressureYes ?? 0.5) * 100}%"></div></div>
    <div class="row">
      <div class="card"><h3>Signals</h3>${s.insights.map((i) => `<div class="ins ${i.level}">${esc(i.text)}</div>`).join('')}</div>
      <div class="card"><h3>Trade</h3>
        ${m.phase === 'primary' ? `
        <div class="muted">Your wallet signs; Panta builds the order; Solami lands it on mainnet.</div>
        <div class="trade"><input id="amt" type="number" min="1" step="1" value="5"> USDC
          <button class="btn yes" data-side="yes">Buy YES</button><button class="btn no" data-side="no">Buy NO</button>
          <div class="quote" id="quote"></div></div>` : '<div class="muted">This market is not in its primary phase, so direct buys are closed.</div>'}
      </div>
    </div>
    <div class="row">
      <div class="card"><h3>Live tape</h3><table><tr><th>When</th><th>Wallet</th><th>Side</th><th>Shares</th><th></th></tr>
        ${d.trades.slice(0, 25).map((t) => { const yes = Number(t.yesAmount) >= Number(t.noAmount); return `<tr class="${newSigs.has(t.signature) ? 'new' : ''}"><td>${ago(t.blockTime)}</td><td class="mono">${short(t.wallet)}</td><td class="${yes ? 'up' : 'down'}">${yes ? 'YES' : 'NO'}</td><td class="mono">${(Number(t.yesAmount) + Number(t.noAmount)).toFixed(2)}</td><td><a target="_blank" href="https://solscan.io/tx/${t.signature}">↗</a></td></tr>`; }).join('')}
      </table></div>
      <div class="card"><h3>Whales (24h)</h3>${s.whales.length ? `<table><tr><th>Wallet</th><th>Side</th><th>Shares</th><th>When</th></tr>${s.whales.map((w) => `<tr><td class="mono"><a target="_blank" href="https://solscan.io/account/${w.wallet}">${short(w.wallet)}</a></td><td class="${w.side === 'YES' ? 'up' : 'down'}">${w.side}</td><td class="mono">${w.shares.toFixed(0)}</td><td>${ago(w.blockTime)}</td></tr>`).join('')}</table>` : '<div class="muted">No outsized trades yet.</div>'}</div>
    </div>`;
}

$('#detail').addEventListener('click', (e) => { const side = e.target.dataset.side; if (side) buy(side); });

// ---------- wallet + trading ----------
const provider = () => window.phantom?.solana || window.solflare || window.solana;
$('#connect').addEventListener('click', async () => {
  const p = provider();
  if (!p) return toast('Install Phantom or Solflare to trade.');
  const r = await p.connect();
  state.wallet = r.publicKey.toString();
  $('#connect').textContent = short(state.wallet);
});

async function buy(side) {
  try {
    if (!state.wallet) return toast('Connect a wallet first.');
    const amountUsdc = $('#amt').value;
    const q = await api('/api/quote', { wallet: state.wallet, marketId: state.selected, side, amountUsdc });
    $('#quote').textContent = `Quote: ~${Number(q.shares).toFixed(2)} ${side.toUpperCase()} shares @ ${Number(q.avgPrice).toFixed(3)} · fee ${q.feeUsdc} USDC`;
    if (!confirm(`Buy ${side.toUpperCase()} for ${amountUsdc} USDC → ~${Number(q.shares).toFixed(2)} shares?`)) return;
    const b = await api('/api/build', { quoteId: q.quoteId, wallet: state.wallet });
    const ixs = b.instructions.map((ix) => new TransactionInstruction({
      programId: new PublicKey(ix.programId), data: Buffer.from(ix.data, 'base64'),
      keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    }));
    const msg = new TransactionMessage({ payerKey: new PublicKey(state.wallet), recentBlockhash: b.recentBlockhash, instructions: ixs }).compileToV0Message();
    const signed = await provider().signTransaction(new VersionedTransaction(msg));
    const r = await api('/api/send', { signedTx: Buffer.from(signed.serialize()).toString('base64'), orderId: b.orderId, wallet: state.wallet });
    $('#quote').innerHTML = `Sent via Solami: <a target="_blank" href="https://solscan.io/tx/${r.signature}">${short(r.signature)}</a>`;
    toast('Order landed — watch it appear in the tape.');
  } catch (e) { toast('Trade failed: ' + e.message); }
}

// ---------- live stream ----------
function renderHealth(h) {
  const age = h.lastSlotAt ? ((Date.now() - h.lastSlotAt) / 1000).toFixed(1) : '—';
  $('#health').innerHTML = `
    <span>Solami <b class="${h.wsConnected || h.mode === 'rpc-poll' ? 'ok' : 'bad'}">${h.wsConnected ? 'WebSocket live' : h.mode === 'rpc-poll' ? 'RPC stream (3s)' : 'connecting'}</b></span>
    <span>slot <b>${h.lastSlot ?? '—'}</b> (${age}s)</span>
    <span>RPC <b>${h.rpcLatencyMs ?? '—'}ms</b></span>
    <span>program txs <b>${h.programEvents}</b></span>
    <span>markets <b>${h.tracked}</b></span>`;
}

function addFeed(ev, isNew) {
  const el = document.createElement('div');
  el.className = 'ev' + (isNew ? ' new' : '');
  el.innerHTML = `<div>${ev.titles?.filter(Boolean).map(esc).join(', ') || 'Panta program activity'}</div>
    <div class="s">slot ${ev.slot} · <a target="_blank" href="https://solscan.io/tx/${ev.signature}">${short(ev.signature)}</a>${ev.latencyMs != null ? ` · seen ${(ev.latencyMs / 1000).toFixed(1)}s after block` : ''}</div>`;
  $('#feed').prepend(el);
  while ($('#feed').children.length > 60) $('#feed').lastChild.remove();
}

const es = new EventSource('/api/stream');
es.addEventListener('health', (e) => renderHealth(JSON.parse(e.data)));
es.addEventListener('chain', (e) => addFeed(JSON.parse(e.data), true));
es.addEventListener('market', async (e) => {
  const m = JSON.parse(e.data);
  state.markets.set(m.marketId, m);
  renderList();
  if (m.reason === 'onchain') document.querySelector(`.m[data-id="${m.marketId}"]`)?.classList.add('flash');
  if (m.marketId === state.selected && (m.newTrades?.length || m.reason === 'onchain')) {
    state.detail = await api(`/api/markets/${m.marketId}`);
    renderDetail(new Set(m.newTrades.map((t) => t.signature)));
  }
});

(async () => {
  const [{ items }, feed] = await Promise.all([api('/api/markets'), api('/api/feed')]);
  items.forEach((m) => state.markets.set(m.marketId, m));
  feed.items.slice().reverse().forEach((ev) => addFeed(ev, false));
  renderList();
  if (items[0]) select(items[0].marketId);
})();
