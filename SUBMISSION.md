# Panta Pulse — submission kit

Deadlines: Colosseum portal **12 Oct 2026**, Superteam Earn sidetracks **13 Oct 2026, 12:29 PM IST**.
Order: 1) GitHub repo public  2) demo video uploaded (YouTube unlisted or Loom)  3) Colosseum  4) Earn x3 (1 credit each).

---------------------------------------------------------------
## Short description (one line)
Panta Pulse is a live intelligence terminal for Panta prediction markets on Solana: it follows the Panta program on mainnet through Solami, turns raw trades into plain-English signals, and lets you buy YES/NO from your own wallet in two clicks.

## Long description (Colosseum + all Earn tracks)
Prediction markets price the future, but users only see a number. Panta Pulse shows *why* the number is moving.

**What it does**
- Live list of Panta markets, LIVE ones first, ranked by a Pulse score (activity, unique wallets, price drift, whale presence).
- On-chain feed: every Panta program transaction on Solana mainnet is picked up through Solami, resolved to the exact market accounts it touched, and that market is refreshed instantly — event-driven, not blind polling.
- Signals in plain English: odds moves over 1h/24h, buy pressure, whale alerts, activity spikes, near-certain markets.
- Live trade tape and 24h whale table per market; price history saved between restarts.
- One-click trading: Panta quotes and builds the order, the user's Phantom/Solflare wallet signs in the browser, Solami RPC lands it. Pulse never holds keys; the Panta API key stays on the server.
- Health bar: which Solami path is live, current slot and freshness, RPC latency, program transactions seen.

**Architecture**
Solana mainnet → Solami (WebSocket logsSubscribe, or RPC getSignaturesForAddress fallback) → Solami RPC getTransaction (which market accounts were touched?) → Panta API getMarket + trades for only those markets → signals engine → SSE → browser. Orders: Panta quote → Panta build (unsigned) → wallet signs → Solami sendTransaction → Panta submit.

**Who it's for**
Prediction-market traders who want context before they bet, and creators who want to see how their markets are moving.

---------------------------------------------------------------
## Panta API Sidetrack — "How Panta is integrated"
Panta is the entire market layer of the product:
- Market discovery and catalog: `GET /markets/` (paged, all phases) and `GET /markets/{id}/`
- Trade tape and whale detection: `GET /markets/{id}/trades/`
- Trading: buy quote → build unsigned transaction → user signs → submit/verify order
- The Panta program id is discovered from a market account's owner and used to follow all Panta activity on-chain, so every Panta trade refreshes the right market within seconds.
Use case: a trading terminal that turns Panta markets into a source of market intelligence (category "Trading & Analytics" + "AI/insights").

## Solami Sidetrack — "How Solami is the data path"
- Solami RPC: account owner lookup (program discovery), `getTransaction` for every program event, `getSlot`, latency metrics, and `sendTransaction` for landing user orders.
- Solami WebSocket `logsSubscribe` + `slotSubscribe` for push updates; automatic fallback to Solami RPC `getSignaturesForAddress` streaming when WS connections aren't available on the plan.
- Runs against live mainnet. Public repo, README with setup, env vars (`SOLAMI_API_KEY`) and how to use your own key.
Metrics surfaced: per-market YES price, 1h/24h change, trade counts, unique wallets, buy vs sell pressure, whale trades, slot freshness, RPC latency, program tx count.

## Superteam India Track
Team: Shahzeb (solo), Korba, Chhattisgarh, India. Registered on Colosseum with country India.
Ecosystem impact: makes Solana prediction markets readable for normal traders and gives Panta creators live insight into their markets.
Growth: brings prediction-market users onto Solana wallets with two-click trading.

---------------------------------------------------------------
## Demo video script (2–3 min, screen record with Win+Alt+R)
1. (0:00) Open http://localhost:8787. "This is Panta Pulse, a live terminal for Panta prediction markets on Solana."
2. (0:15) Point at the header: "Solami is the data path — here's the live slot, RPC latency and Panta program transactions seen."
3. (0:35) Market list: "Live markets first, ranked by Pulse score." Click a LIVE market.
4. (0:50) Show odds, 1h/24h change, trades & wallets, Signals box, live tape, whales.
5. (1:20) On-chain feed on the right: click a transaction → Solscan opens. "Each one was picked up through Solami and refreshed the exact market it touched."
6. (1:45) Connect wallet → choose YES, small amount → show the Panta quote. (Signing is optional.)
7. (2:10) Show the GitHub README for 5 sec. "Open source, runs with your own Panta and Solami keys." End.

## Links to fill
- GitHub: https://github.com/Jaanu-ji/Panta
- Demo video:
- Colosseum project page:
