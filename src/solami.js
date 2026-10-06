// Solami RPC + WebSocket client: the live on-chain data path for Panta Pulse.
import WebSocket from 'ws';
import { EventEmitter } from 'node:events';

export function createSolami(apiKey) {
  const rpcUrl = `https://rpc.solami.dev/sol?api_key=${apiKey}`;
  const wsUrl = `wss://ws.solami.dev/ws/sol?api_key=${apiKey}`;
  let id = 0;

  async function rpc(method, params = []) {
    const t0 = Date.now();
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const j = await res.json();
    health.rpcLatencyMs = Date.now() - t0;
    health.rpcCalls++;
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  }

  const health = {
    wsConnected: false, lastSlot: null, lastSlotAt: null, programEvents: 0,
    rpcCalls: 0, rpcLatencyMs: null, reconnects: 0, subscribedProgram: null,
    mode: 'connecting', polledEvents: 0,
  };

  const events = new EventEmitter();
  let ws;
  let programId = null;
  let backoff = 2000;

  // Fallback live path: if the WebSocket is unavailable (plan limits, network),
  // follow the Panta program through Solami RPC getSignaturesForAddress instead.
  let lastSig = null;
  let polling = false;
  async function pollProgram() {
    if (!programId || health.wsConnected || polling) return;
    polling = true;
    try {
      const opts = { limit: 25, commitment: 'confirmed' };
      if (lastSig) opts.until = lastSig;
      const sigs = await rpc('getSignaturesForAddress', [programId, opts]);
      const slot = await rpc('getSlot', [{ commitment: 'confirmed' }]).catch(() => null);
      if (slot) { health.lastSlot = slot; health.lastSlotAt = Date.now(); }
      if (sigs?.length) {
        const first = !lastSig;
        lastSig = sigs[0].signature;
        if (!first) {
          for (const x of sigs.reverse()) {
            if (x.err) continue;
            health.programEvents++; health.polledEvents++;
            events.emit('programTx', { signature: x.signature, logs: [], slot: x.slot });
          }
        }
      }
    } catch (e) { /* keep polling */ }
    finally { polling = false; }
  }
  setInterval(pollProgram, 3000);

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      health.wsConnected = true;
      health.mode = 'websocket';
      backoff = 2000;
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slotSubscribe' }));
      if (programId) subscribeLogs();
      events.emit('status', { ...health });
    });
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.method === 'slotNotification') {
        health.lastSlot = msg.params.result.slot;
        health.lastSlotAt = Date.now();
      } else if (msg.method === 'logsNotification') {
        const v = msg.params.result.value;
        if (v.err) return;
        health.programEvents++;
        events.emit('programTx', { signature: v.signature, logs: v.logs, slot: msg.params.result.context.slot });
      }
    });
    const retry = () => {
      health.wsConnected = false;
      health.reconnects++;
      events.emit('status', { ...health });
      if (health.mode !== 'rpc-poll') health.mode = 'rpc-poll';
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    };
    ws.on('close', retry);
    ws.on('error', () => { try { ws.close(); } catch {} });
  }

  function subscribeLogs() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'logsSubscribe',
      params: [{ mentions: [programId] }, { commitment: 'confirmed' }],
    }));
    health.subscribedProgram = programId;
  }

  return {
    rpc,
    health,
    events,
    start() { connect(); },
    watchProgram(pid) { programId = pid; subscribeLogs(); },
    getAccountOwner: async (address) => (await rpc('getAccountInfo', [address, { encoding: 'base64' }]))?.value?.owner || null,
    getTransaction: (sig) => rpc('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]),
    sendRawTransaction: (b64) => rpc('sendTransaction', [b64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]),
    signatureStatus: (sig) => rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]),
    latestBlockhash: () => rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]),
  };
}

// All account keys a transaction touched (static + address-lookup-table loaded).
export function txAccountKeys(tx) {
  if (!tx) return [];
  const keys = [...(tx.transaction?.message?.accountKeys || [])].map((k) => (typeof k === 'string' ? k : k.pubkey));
  const loaded = tx.meta?.loadedAddresses;
  if (loaded) keys.push(...(loaded.writable || []), ...(loaded.readonly || []));
  return keys;
}
