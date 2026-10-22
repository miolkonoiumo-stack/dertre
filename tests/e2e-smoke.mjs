/**
 * End-to-end smoke test against the LIVE server.
 *
 * Mirrors the real client protocol (see src/net/client.js):
 *   room:update / match:started / tick / match:end / rooms:list
 * Proves the multiplayer path works over a real websocket, not just in unit tests.
 */
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://localhost:8787';
let okCount = 0;
let failCount = 0;
const pass = (m) => { okCount++; console.log('PASS', m); };
const fail = (m) => { failCount++; console.log('FAIL', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mkClient(tag) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    const t = setTimeout(() => reject(new Error(`${tag}: connect timeout`)), 8000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

const ask = (sock, ev, payload, ms = 6000) =>
  new Promise((res) => {
    sock.emit(ev, payload, res);
    setTimeout(() => res({ error: 'ack-timeout' }), ms);
  });

const main = async () => {
  const a = await mkClient('A');
  pass('client A connected over websocket');
  const b = await mkClient('B');
  pass('client B connected over websocket');

  // --- shared observation state -------------------------------------------
  const seen = {
    roomUpdate: 0, ticks: 0, started: 0, ended: 0,
    phases: new Set(), lastRoom: null, lastEnd: null, lastTick: null,
  };
  for (const s of [a, b]) {
    s.on('room:update', (d) => { seen.roomUpdate++; seen.lastRoom = d; });
    s.on('match:started', (d) => { seen.started++; seen.lastRoom = d; });
    s.on('match:end', (d) => { seen.ended++; seen.lastEnd = d; });
    s.on('tick', (d) => { seen.ticks++; seen.lastTick = d; if (d?.s?.phase) seen.phases.add(d.s.phase); });
  }

  // --- 1. create room ------------------------------------------------------
  const created = await ask(a, 'room:create', { name: 'TesterA' });
  if (!created?.ok || !created.code) return fail(`room:create -> ${JSON.stringify(created)}`);
  const code = created.code;
  pass(`room created (code=${code})`);

  // --- 2. join room --------------------------------------------------------
  const joined = await ask(b, 'room:join', { code, name: 'TesterB' });
  if (!joined?.ok) return fail(`room:join -> ${JSON.stringify(joined)}`);
  pass('client B joined by room code');

  await wait(400);
  if (seen.roomUpdate < 1) fail('server never pushed room:update');
  else pass(`room:update pushes received (${seen.roomUpdate})`);

  const players = seen.lastRoom?.players ?? [];
  if (players.length !== 2) fail(`expected 2 players in room, got ${players.length}`);
  else pass('room reports 2 players');

  // --- 3. ready up ---------------------------------------------------------
  a.emit('player:ready', { ready: true });
  b.emit('player:ready', { ready: true });
  await wait(500);
  const readyN = (seen.lastRoom?.players ?? []).filter((p) => p.ready).length;
  if (readyN !== 2) fail(`expected 2 ready, got ${readyN}`);
  else pass('both players ready');

  // --- 4. start match ------------------------------------------------------
  a.emit('match:start');
  await wait(800);
  if (seen.started < 1) fail('match:started was never emitted');
  else pass('match:started broadcast');

  if (seen.ticks < 5) fail(`server sent only ${seen.ticks} ticks early on`);
  else pass('tick stream is live');

  // --- 5. play it out ------------------------------------------------------
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const t = Date.now();
    a.emit('input', { x: Math.sin(t / 350), z: Math.cos(t / 350), jump: false });
    b.emit('input', { x: 0, z: 0, jump: false });
    if (seen.ended > 0) break;
    await wait(100);
  }

  if (seen.ticks < 100) fail(`too few ticks overall (${seen.ticks})`);
  else pass(`sustained tick rate (${seen.ticks} ticks)`);

  for (const ph of ['play', 'swap']) {
    if (!seen.phases.has(ph)) fail(`phase "${ph}" never observed`);
    else pass(`phase "${ph}" observed`);
  }

  if (seen.ended < 1) fail('match:end never fired');
  else pass(`match:end fired (winner=${seen.lastEnd?.winner ?? 'n/a'})`);

  if (typeof seen.lastTick?.s?.players?.length !== 'number') fail('tick snapshot missing players array');
  else pass('tick snapshot carries authoritative player state');

  // --- 6. disconnect resilience -------------------------------------------
  b.disconnect();
  await wait(700);
  const list = await ask(a, 'rooms:request', {});
  if (list?.error) fail(`rooms:list after disconnect -> ${list.error}`);
  else pass('server still responsive after a client dropped');

  const props = await ask(a, 'room:join', { code: 'ZZZZZ', name: 'Ghost' });
  // A is still inside its own room, so "already_in_room" is the correct guard.
  // To exercise the not_found branch we need a client that is NOT in a room.
  if (props?.ok) fail('a client already in a room must not join another');
  else if (props?.reason === 'already_in_room') pass('second-join blocked with reason=already_in_room');
  else fail(`second-join gave unexpected answer: ${JSON.stringify(props)}`);

  const c = await mkClient('C');
  const missing = await ask(c, 'room:join', { code: 'ZZZZZ', name: 'Ghost' });
  if (missing?.ok) fail('a free client must not join a non-existent room');
  else if (missing?.reason === 'not_found') pass('unknown room code rejected with reason=not_found');
  else fail(`unknown room code gave unexpected answer: ${JSON.stringify(missing)}`);
  c.disconnect();

  a.disconnect();
  await wait(200);

  console.log(`\n${okCount}/${okCount + failCount} checks passed`);
  process.exit(failCount ? 1 : 0);
};

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });

