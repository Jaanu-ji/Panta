# Panta Pulse

**Live prediction-market intelligence on Solana.** Panta Pulse is a real-time terminal for [Panta](https://www.panta.market) prediction markets. It watches the Panta program on Solana mainnet through [Solami](https://solami.dev), turns raw trades into signals a trader can read at a glance, and lets you buy YES/NO from your own wallet in two clicks.

> Prediction markets price the future, but today you only see a number. Pulse shows you **why** the number is moving: who is buying, how hard, and how fast.

## What it does

| | |
|---|---|
| **Live odds for every open market** | Ranked by a *Pulse score* (activity, unique wallets, price drift, whale presence). |
| **On-chain feed** | Every Panta program transaction reaches the UI over a Solami WebSocket `logsSubscribe` stream, usually within seconds, without polling. |
| **Signals** | Plain-English insights: odds moves over 1h and 24h, buy pressure, whale alerts, activity spikes, near-certain markets. |
| **Live tape and whale table** | The last 200 trades per market, with new ones highlighted as they land. |
| **Price history** | Built from on-chain-triggered snapshots and saved between restarts. |
| **One-click trading** | Panta quotes and builds the order, your wallet (Phantom or Solflare) signs it, and Solami RPC broadcasts it. Pulse never holds your keys. |
| **Stream health bar** | Solami WebSocket status, current slot and freshness, RPC latency, and the count of program transactions seen. |

## How it works

```
 Solana mainnet
      │  Panta program txs
      ▼
 Solami WebSocket (logsSubscribe + slotSubscribe)
      │  signature
      ▼
 Solami RPC getTransaction ──► which market accounts were touched?
      │
      ▼
 Panta API: getMarket + marketTrades (only for touched markets)
      │
      ▼
 Signals engine ──► SSE ──► browser terminal
                                   │  Buy YES/NO
 Panta quote → build (unsigned) ◄──┘
      │
 wallet signs in browser ──► Solami RPC sendTransaction ──► Panta submit
```

* **Solami is the data path.** The Panta program id is discovered at boot by reading a market account's owner through Solami RPC. Then one Solami WebSocket subscription carries all live activity, Solami RPC resolves each transaction to the markets it touched, and orders are sent through Solami RPC.
* **Panta is the market layer.** Catalog, spot prices, trade tape, quotes, unsigned order transactions and order submission all come from the Panta API. The API key stays on the server.
* **Two live paths, same pipeline.** With a WebSocket-enabled Solami plan, `logsSubscribe` pushes every Panta program transaction. On plans without WebSocket connections, Pulse automatically follows the program through Solami RPC `getSignaturesForAddress` every 3 seconds and feeds the exact same pipeline, so it runs live on any Solami key. The header shows which path is active.
* **Honest prices.** When Panta returns no spot price for a market phase, Pulse falls back to the implied price of the latest priced trade (USDC paid / shares) instead of showing a blank.
* **Event-driven, not polling.** A market is refreshed the moment it is touched on-chain. A slow round-robin refresh runs in the background as a safety net, within Panta's rate limits.

## Run it

Requirements: Node.js 18+, a free [Solami key](https://solami.dev/signup) and a [Panta account](https://docs.panta.market/quickstart).

```bash
git clone https://github.com/Jaanu-ji/Panta && cd Panta
npm install
npm run setup     # logs into Panta, mints a key and asks for your Solami key; everything is saved to .env
npm start         # builds the UI and serves http://localhost:8787
```

Or create `.env` by hand from `.env.example`:

| Variable | Meaning |
|---|---|
| `PANTA_API_KEY` | `pk_test_…` or `pk_live_…` from the Panta API |
| `SOLAMI_API_KEY` | Standard Solami API key (RPC + WebSocket) |
| `PORT` | Default `8787` |
| `MAX_TRACKED` | How many top markets to track live (default `40`) |

## Project layout

```
src/server.js       Express server, SSE stream, event pipeline
src/solami.js       Solami RPC + WebSocket client (reconnecting, health metrics)
src/panta.js        Panta API client (rate-limit aware)
src/signals.js      Signals engine: odds drift, buy pressure, whales, Pulse score
src/client/app.js   Browser terminal (bundled with esbuild)
scripts/setup.js    One-time key setup
```

## Roadmap

- Telegram and Discord alerts for whale trades and sudden odds moves in markets you follow
- Portfolio view with Panta positions and one-click claims
- Blur decoded market data, so crypto-price markets sit next to the live spot price of their underlying token
- Market creation from trending on-chain events

## License

MIT
