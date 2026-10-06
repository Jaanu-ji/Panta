// Turns raw Panta trades + price snapshots into trader-readable signals.
const HOUR = 3600;
const DAY = 24 * HOUR;
const num = (v) => (v == null || v === '' ? 0 : Number(v));

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function priceAt(history, ts) {
  // Latest snapshot at or before ts.
  let best = null;
  for (const p of history) if (p.t <= ts) best = p; else break;
  return best?.yes ?? null;
}

export function computeSignals(market, trades, history, now = Math.floor(Date.now() / 1000)) {
  const yes = market.yesPrice != null ? num(market.yesPrice) : null;
  const recent = trades.filter((t) => t.blockTime && now - t.blockTime <= DAY);
  const lastHour = recent.filter((t) => now - t.blockTime <= HOUR);

  const size = (t) => num(t.yesAmount) + num(t.noAmount);
  const yesShares = recent.reduce((a, t) => a + num(t.yesAmount), 0);
  const noShares = recent.reduce((a, t) => a + num(t.noAmount), 0);
  const wallets = new Set(recent.map((t) => t.wallet));
  const sizes = recent.map(size);
  const med = median(sizes);
  const sorted = [...sizes].sort((a, b) => b - a);
  const p90 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const whaleCut = Math.max(med * 3, p90, 1);
  const whales = recent
    .filter((t) => size(t) >= whaleCut && recent.length >= 5)
    .map((t) => ({
      wallet: t.wallet, side: num(t.yesAmount) >= num(t.noAmount) ? 'YES' : 'NO',
      shares: size(t), blockTime: t.blockTime, signature: t.signature,
    }))
    .slice(0, 10);

  const p1h = priceAt(history, now - HOUR);
  const p24h = priceAt(history, now - DAY);
  const change1h = yes != null && p1h != null ? yes - p1h : null;
  const change24h = yes != null && p24h != null ? yes - p24h : null;
  const pressure = yesShares + noShares > 0 ? yesShares / (yesShares + noShares) : null;

  const insights = [];
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const pts = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)} pts`;

  if (change1h != null && Math.abs(change1h) >= 0.03) {
    insights.push({ level: 'hot', text: `YES odds moved ${pts(change1h)} in the last hour (now ${pct(yes)}).` });
  }
  if (change24h != null && Math.abs(change24h) >= 0.05) {
    insights.push({ level: 'info', text: `24h drift: ${pts(change24h)} — the crowd is ${change24h > 0 ? 'leaning YES' : 'leaning NO'}.` });
  }
  if (pressure != null && recent.length >= 3) {
    if (pressure >= 0.65) insights.push({ level: 'info', text: `Buy pressure is ${pct(pressure)} YES across ${recent.length} trades today.` });
    else if (pressure <= 0.35) insights.push({ level: 'info', text: `Buy pressure is ${pct(1 - pressure)} NO across ${recent.length} trades today.` });
    else insights.push({ level: 'calm', text: `Order flow is balanced (${pct(pressure)} YES) — no clear consensus yet.` });
  }
  if (whales.length) {
    const w = whales[0];
    insights.push({ level: 'hot', text: `Whale alert: ${w.wallet.slice(0, 4)}…${w.wallet.slice(-4)} bought ${w.shares.toFixed(0)} ${w.side} shares (${(w.shares / Math.max(med, 1)).toFixed(1)}× median).` });
  }
  if (lastHour.length >= 5) insights.push({ level: 'hot', text: `${lastHour.length} trades in the last hour — activity spike.` });
  if (yes != null && (yes >= 0.9 || yes <= 0.1)) insights.push({ level: 'calm', text: `Market is near-certain (${pct(yes)} YES); little upside left on the favourite.` });
  if (!recent.length) insights.push({ level: 'calm', text: 'No trades in the last 24h — early market, prices can move on small size.' });

  const pulse = Math.min(100, Math.round(
    Math.log10(1 + recent.length) * 25 + Math.log10(1 + wallets.size) * 20 +
    Math.min(30, Math.abs(change24h ?? 0) * 150) + (whales.length ? 10 : 0),
  ));

  return {
    yes, no: yes != null ? 1 - yes : null, change1h, change24h,
    trades24h: recent.length, tradesLastHour: lastHour.length, uniqueWallets24h: wallets.size,
    yesShares24h: yesShares, noShares24h: noShares, buyPressureYes: pressure,
    whales, insights, pulse,
  };
}
