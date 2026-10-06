// Interactive one-time setup: creates a Panta API key and writes all keys to .env.
// Secrets are typed by you in the terminal and saved locally only.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const PANTA = 'https://live-api.panta.market/api/v1';

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnv(env) {
  const body = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, body, { mode: 0o600 });
}

function ask(q, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

async function createPantaKey() {
  const email = await ask('Panta email: ');
  const password = await ask('Panta password: ', { hidden: true });
  const login = await fetch(`${PANTA}/auth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const lj = await login.json();
  if (!login.ok) throw new Error(`Panta login failed: ${lj.code || login.status} ${lj.message || ''}`);
  const key = await fetch(`${PANTA}/account/keys/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lj.access}` },
    body: JSON.stringify({ env: 'live', name: 'panta-pulse-live' }),
  });
  const kj = await key.json();
  if (!key.ok) throw new Error(`Panta key creation failed: ${kj.code || key.status} ${kj.message || ''}`);
  return kj.secret;
}

const env = readEnv();
console.log('\nPanta Pulse setup — keys are saved only in your local .env file.\n');

if (env.PANTA_API_KEY && !env.PANTA_API_KEY.startsWith('pk_test_')) {
  console.log('✓ PANTA_API_KEY (live) already set.');
} else {
  if (env.PANTA_API_KEY) console.log('Replacing sandbox (pk_test) key with a live key so real mainnet markets load.');
  env.PANTA_API_KEY = await createPantaKey();
  console.log('✓ Panta API key created and saved.');
}

if (env.SOLAMI_API_KEY) {
  console.log('✓ SOLAMI_API_KEY already set.');
} else {
  console.log('\nOpen https://solami.dev/dashboard → API keys → copy your standard key.');
  env.SOLAMI_API_KEY = await ask('Paste Solami API key: ', { hidden: true });
  console.log('✓ Solami key saved.');
}

env.PORT = env.PORT || '8787';
writeEnv(env);
console.log('\nDone. Now run:  npm start   then open http://localhost:' + env.PORT + '\n');
