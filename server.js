const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
let ytSearch = null;
try { ytSearch = require('yt-search'); } catch {}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 25000,
  maxHttpBufferSize: 1.8e6
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

const COLORS = ['red', 'yellow', 'green', 'blue'];
const ACTIONS = ['skip', 'reverse', 'draw2'];
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const INITIAL_HAND = 7;
const TURN_SECONDS = 45;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6;
const DISCONNECT_KEEP_MS = 1000 * 60 * 20;
const AUTO_RESET_SECONDS = 18;

const rooms = new Map();
const voiceRooms = new Map(); // roomCode -> Map(playerId, socketId)

const SHOP = [
  { id: 'card_neon', name: 'Neon Card Skin', type: 'cardSkin', rarity: 'Rare', price: 850, desc: 'Kartu bergaya neon clean.' },
  { id: 'card_royal', name: 'Royal Gold Card Skin', type: 'cardSkin', rarity: 'Epic', price: 1800, desc: 'Frame kartu emas elegan.' },
  { id: 'card_void', name: 'Void Myth Card Skin', type: 'cardSkin', rarity: 'Legendary', price: 3500, desc: 'Skin kartu gelap futuristik.' },
  { id: 'back_dragon', name: 'Dragon Card Back', type: 'cardBack', rarity: 'Epic', price: 1500, desc: 'Belakang kartu bertema naga.' },
  { id: 'back_moon', name: 'Moon Card Back', type: 'cardBack', rarity: 'Rare', price: 900, desc: 'Belakang kartu bulan malam.' },
  { id: 'theme_midnight', name: 'Midnight Table', type: 'tableTheme', rarity: 'Rare', price: 1000, desc: 'Meja biru gelap minimalis.' },
  { id: 'theme_arena', name: 'Arena Table', type: 'tableTheme', rarity: 'Epic', price: 2100, desc: 'Meja kompetitif arena.' },
  { id: 'frame_silver', name: 'Silver Profile Frame', type: 'frame', rarity: 'Rare', price: 650, desc: 'Border foto silver.' },
  { id: 'frame_legend', name: 'Legend Flame Frame', type: 'frame', rarity: 'Legendary', price: 3200, desc: 'Border profil legendary.' },
  { id: 'badge_unomaster', name: 'UNO Master Badge', type: 'badge', rarity: 'Epic', price: 1600, desc: 'Badge pemain UNO master.' },
  { id: 'power_draw_shield', name: 'Draw Shield', type: 'power', rarity: 'Epic', price: 500, desc: 'Sekali pakai: blokir penalti Draw +2/+4 dalam 1 game.' },
  { id: 'power_double_points', name: 'Double Points', type: 'power', rarity: 'Rare', price: 450, desc: 'Sekali pakai: gandakan poin hadiah ronde ini.' },
  { id: 'power_uno_guard', name: 'UNO Guard', type: 'power', rarity: 'Rare', price: 350, desc: 'Sekali pakai: lindungi dari challenge lupa UNO.' }
];

const CRATES = [
  { id: 'starter_crate', name: 'Starter Crate', price: 300, odds: { Common: 50, Rare: 30, Epic: 15, Legendary: 5 } },
  { id: 'neon_crate', name: 'Neon Crate', price: 900, odds: { Common: 20, Rare: 38, Epic: 27, Legendary: 12, Mythic: 3 } },
  { id: 'royal_crate', name: 'Royal Legend Crate', price: 1800, odds: { Rare: 30, Epic: 36, Legendary: 24, Mythic: 10 } }
];

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const text = fs.readFileSync(file, 'utf8');
    return text ? JSON.parse(text) : fallback;
  } catch (err) {
    console.error('readJSON failed', file, err.message);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const db = readJSON(PLAYERS_FILE, { players: {}, byName: {} });
function savePlayers() { writeJSON(PLAYERS_FILE, db); }
function saveRooms() { writeJSON(ROOMS_FILE, { rooms: [...rooms.values()].map(serializeRoom) }); }

function uid(prefix = '') { return prefix + crypto.randomBytes(9).toString('hex'); }
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function normalizeName(name) { return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 18); }
function cleanName(name) { return String(name || 'Player').replace(/[<>]/g, '').trim().slice(0, 18) || 'Player'; }
function pinHash(pin) { return crypto.createHash('sha256').update(`uno_ryuu::${pin}`).digest('hex'); }
function token() { return crypto.randomBytes(24).toString('hex'); }
function isOwner(p) { return p?.username?.toLowerCase() === 'ryuu'; }
function pointsOf(p) { return isOwner(p) ? 999999999 : Math.floor(Number(p.points || 0)); }
function spendPoints(p, amount) { if (isOwner(p)) return true; if (pointsOf(p) < amount) return false; p.points -= amount; return true; }
function addPoints(p, amount) { if (!isOwner(p)) p.points = Math.max(0, Math.floor(Number(p.points || 0) + amount)); p.stats.pointsEarned += amount; }

function basePlayer(username, pin) {
  const id = uid('u_');
  return {
    id,
    username,
    displayName: username,
    pinHash: pinHash(pin),
    token: token(),
    points: 1200,
    avatarData: '',
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    equipped: { cardSkin: 'classic', cardBack: 'classic', tableTheme: 'default', frame: 'none', badge: 'rookie' },
    inventory: { cosmetics: ['classic', 'none', 'rookie', 'default'], powers: {}, cratesOpened: 0 },
    friends: [], requestsIn: [], requestsOut: [], invites: [],
    stats: {
      games: 0, wins: 0, losses: 0, winStreak: 0, bestStreak: 0,
      pointsEarned: 0, cardsPlayed: 0, draws: 0, unoCalls: 0, challengesWon: 0,
      winsAsHost: 0, roomsCreated: 0
    }
  };
}
function ensureOwner() {
  const key = normalizeName('ryuu');
  let id = db.byName[key];
  if (!id || !db.players[id]) {
    const p = basePlayer('ryuu', '291206');
    p.points = 999999999;
    for (const item of SHOP) p.inventory.cosmetics.push(item.id);
    db.players[p.id] = p; db.byName[key] = p.id; savePlayers();
  } else {
    const p = db.players[id];
    p.pinHash = pinHash('291206');
    p.points = 999999999;
    for (const item of SHOP) if (!p.inventory.cosmetics.includes(item.id) && item.type !== 'power') p.inventory.cosmetics.push(item.id);
    savePlayers();
  }
}
ensureOwner();

function publicProfile(p) {
  if (!p) return null;
  return {
    id: p.id, username: p.username, displayName: p.displayName || p.username,
    points: pointsOf(p), avatarData: p.avatarData || '', equipped: p.equipped,
    inventory: { cosmetics: p.inventory.cosmetics || [], powers: p.inventory.powers || {}, cratesOpened: p.inventory.cratesOpened || 0 },
    stats: p.stats, friends: p.friends || [], requestsIn: p.requestsIn || [], requestsOut: p.requestsOut || [], invites: p.invites || []
  };
}
function authUser(auth) {
  const p = db.players[auth?.accountId || ''];
  if (!p || p.token !== auth?.token) return null;
  return p;
}
function requireAuth(auth) {
  const p = authUser(auth);
  if (!p) throw new Error('Login dulu. Session akun tidak valid.');
  return p;
}

app.get('/api/music/youtube', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (!q) return res.json({ ok: true, results: [] });
    if (!ytSearch) return res.json({ ok: false, error: 'yt-search belum terinstall.' });
    const found = await ytSearch(q);
    const results = (found.videos || []).slice(0, 12).map((v) => ({
      source: 'youtube', videoId: v.videoId, title: v.title, artist: v.author?.name || 'YouTube',
      duration: v.timestamp || '', thumbnail: v.thumbnail || '', url: v.url || `https://www.youtube.com/watch?v=${v.videoId}`
    }));
    res.json({ ok: true, results });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});
app.get('/api/shop', (_req, res) => res.json({ ok: true, shop: SHOP, crates: CRATES }));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

function makeCard(color, type, value = null) { return { id: uid('c_'), color, type, value }; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push(makeCard(color, 'number', 0));
    for (let n = 1; n <= 9; n++) { deck.push(makeCard(color, 'number', n)); deck.push(makeCard(color, 'number', n)); }
    for (const action of ACTIONS) { deck.push(makeCard(color, action)); deck.push(makeCard(color, action)); }
  }
  for (let i = 0; i < 4; i++) { deck.push(makeCard('wild', 'wild')); deck.push(makeCard('wild', 'wild4')); }
  return shuffle(deck);
}
function getPlayer(room, playerId) { return room.players.find((p) => p.id === playerId || p.accountId === playerId); }
function getPlayerByAccount(room, accountId) { return room.players.find((p) => p.accountId === accountId && !p.left); }
function activePlayers(room) { return room.players.filter((p) => !p.left); }
function connectedPlayers(room) { return activePlayers(room).filter((p) => p.connected); }
function currentPlayer(room) { const ps = activePlayers(room); if (!ps.length) return null; if (room.currentIndex < 0 || room.currentIndex >= ps.length) room.currentIndex = 0; return ps[room.currentIndex]; }
function nextIndex(room, steps = 1) { const ps = activePlayers(room); if (!ps.length) return 0; let idx = room.currentIndex; for (let i = 0; i < steps; i++) idx = (idx + room.direction + ps.length) % ps.length; return idx; }
function setTurnIndex(room, idx) { room.currentIndex = idx; resetTurnState(room); }
function moveToNextPlayer(room, steps = 1) { setTurnIndex(room, nextIndex(room, steps)); }
function resetTurnState(room) { room.turnState = { playerId: currentPlayer(room)?.id || null, hasDrawn: false, drawnCardId: null, drawnCardPlayable: false }; }
function addLog(room, text, type = 'info') { room.logs.unshift({ id: uid('log_'), text, type, at: Date.now() }); room.logs = room.logs.slice(0, 40); room.message = text; room.updatedAt = Date.now(); }
function addChat(room, p, text) { room.chat.push({ id: uid('chat_'), accountId: p.accountId, name: p.name, text: String(text || '').replace(/[<>]/g, '').slice(0, 180), at: Date.now() }); room.chat = room.chat.slice(-80); room.updatedAt = Date.now(); }
function colorName(c) { return ({ red: 'Merah', yellow: 'Kuning', green: 'Hijau', blue: 'Biru', wild: 'Bebas' })[c] || c; }
function cardLabel(card) { if (!card) return '-'; if (card.type === 'number') return `${colorName(card.color)} ${card.value}`; if (card.type === 'draw2') return `${colorName(card.color)} +2`; if (card.type === 'wild4') return 'Wild +4'; if (card.type === 'wild') return 'Wild'; if (card.type === 'skip') return `${colorName(card.color)} Skip`; if (card.type === 'reverse') return `${colorName(card.color)} Reverse`; return `${colorName(card.color)} ${card.type}`; }
function ensureDeck(room) { if (room.deck.length) return; if (room.discard.length <= 1) return; const top = room.discard.pop(); room.deck = shuffle(room.discard.map((c) => ({ ...c, id: uid('c_') }))); room.discard = [top]; addLog(room, 'Deck dikocok ulang dari kartu buangan.', 'system'); }
function drawCards(room, player, count) { const cards = []; for (let i = 0; i < count; i++) { ensureDeck(room); if (!room.deck.length) break; const card = room.deck.pop(); player.hand.push(card); cards.push(card); } player.saidUno = false; return cards; }
function isPlayable(room, card) { const top = room.discard[room.discard.length - 1]; if (!top) return true; if (card.color === 'wild' || card.type === 'wild' || card.type === 'wild4') return true; if (room.currentColor && card.color === room.currentColor) return true; if (card.type === top.type && card.type !== 'number') return true; if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true; return false; }
function hasPlayableCard(room, hand) { return hand.some((c) => isPlayable(room, c)); }
function canUseWild4(room, player, cardId) { const c = player.hand.find((x) => x.id === cardId); if (!c || c.type !== 'wild4') return true; return !player.hand.some((x) => x.id !== cardId && x.color !== 'wild' && x.color === room.currentColor); }
function pickFirstDiscard(room) { let card; let safety = 0; do { safety++; card = room.deck.pop(); if (!card) break; if (card.type === 'wild4' || card.type === 'wild') room.deck.unshift(card); } while (card && (card.type === 'wild4' || card.type === 'wild') && safety < 40); if (!card || card.type === 'wild4' || card.type === 'wild') card = makeCard('red', 'number', 0); room.discard.push(card); room.currentColor = card.color; }

function makePlayerFromAccount(account, socketId, isHost = false) {
  return {
    id: uid('p_'), accountId: account.id, name: account.displayName || account.username, socketId, connected: true,
    isHost, hand: [], saidUno: false, score: 0, joinedAt: Date.now(), disconnectedAt: null, left: false,
    avatarData: account.avatarData || '', equipped: account.equipped || {}, powers: { drawShield: false, doublePoints: false, unoGuard: false, used: {} }
  };
}
function makeRoom(account, socketId, opts = {}) {
  const code = roomCode();
  const p = makePlayerFromAccount(account, socketId, true);
  const room = {
    code, name: cleanName(opts.name || `${account.displayName || account.username}'s Room`), passwordHash: opts.password ? pinHash(opts.password) : '',
    hostAccountId: account.id, createdAt: Date.now(), updatedAt: Date.now(), status: 'lobby', message: 'Room dibuat.',
    players: [p], deck: [], discard: [], currentColor: null, currentIndex: 0, direction: 1, winnerAccountId: null,
    turnEndsAt: null, turnTimer: null, autoResetTimer: null,
    turnState: { playerId: null, hasDrawn: false, drawnCardId: null, drawnCardPlayable: false },
    logs: [], chat: [], settings: { turnSeconds: TURN_SECONDS }, music: { status: 'stopped', song: null, startedAt: null, positionSec: 0, updatedAt: Date.now(), by: null }
  };
  rooms.set(code, room); account.stats.roomsCreated += 1; savePlayers(); saveRooms(); return room;
}
function removeAccountFromOtherLobby(accountId, keepCode = '') {
  for (const [code, room] of rooms) {
    if (code === keepCode) continue;
    const p = getPlayerByAccount(room, accountId);
    if (!p) continue;
    if (room.status === 'playing') { p.connected = false; p.socketId = null; p.disconnectedAt = Date.now(); }
    else { p.left = true; p.connected = false; p.socketId = null; }
    if (connectedPlayers(room).length === 0 && room.status !== 'playing') { stopTurnTimer(room); rooms.delete(code); }
  }
}

function startGame(room) {
  const ps = activePlayers(room);
  if (ps.length < MIN_PLAYERS) throw new Error('Minimal 2 pemain untuk mulai.');
  if (ps.length > MAX_PLAYERS) throw new Error(`Maksimal ${MAX_PLAYERS} pemain.`);
  stopTurnTimer(room); clearAutoReset(room);
  room.status = 'playing'; room.deck = createDeck(); room.discard = []; room.currentColor = null; room.currentIndex = 0; room.direction = 1; room.winnerAccountId = null; room.logs = [];
  for (const p of ps) { p.hand = []; p.saidUno = false; p.left = false; p.powers = { ...p.powers, used: {} }; drawCards(room, p, INITIAL_HAND); }
  pickFirstDiscard(room); addLog(room, `Game dimulai. Kartu awal: ${cardLabel(room.discard.at(-1))}.`, 'start'); applyInitialAction(room); resetTurnState(room); armTurnTimer(room); saveRooms();
}
function applyInitialAction(room) { const top = room.discard.at(-1); const ps = activePlayers(room); if (!top || ps.length < 2) return; if (top.type === 'skip') { const skipped = currentPlayer(room); room.currentIndex = nextIndex(room, 1); addLog(room, `${skipped?.name || 'Pemain'} dilewati karena kartu awal Skip.`, 'card'); } else if (top.type === 'reverse') { room.direction *= -1; if (ps.length === 2) room.currentIndex = nextIndex(room, 1); addLog(room, 'Arah permainan dibalik dari kartu awal Reverse.', 'card'); } else if (top.type === 'draw2') { const target = currentPlayer(room); const drawn = drawPenalty(room, target, 2); room.currentIndex = nextIndex(room, 1); addLog(room, `${target?.name || 'Pemain'} mengambil ${drawn} kartu dari kartu awal +2.`, 'card'); } }
function drawPenalty(room, target, count) { if (target?.powers?.drawShield && !target.powers.used?.drawShield) { target.powers.used.drawShield = true; target.powers.drawShield = false; addLog(room, `🛡️ ${target.name} memakai Draw Shield dan memblokir penalti +${count}.`, 'power'); return 0; } return drawCards(room, target, count).length; }
function playCard(room, playerId, cardId, chosenColor) {
  if (room.status !== 'playing') throw new Error('Game belum berjalan.');
  const player = getPlayer(room, playerId); const turn = currentPlayer(room); if (!player || !turn || player.id !== turn.id) throw new Error('Belum giliran kamu.');
  const idx = player.hand.findIndex((c) => c.id === cardId); if (idx < 0) throw new Error('Kartu tidak ditemukan.');
  const card = player.hand[idx];
  if (room.turnState.hasDrawn && room.turnState.playerId === player.id) { if (!room.turnState.drawnCardPlayable) throw new Error('Giliran ini harus lewat.'); if (room.turnState.drawnCardId !== card.id) throw new Error('Setelah draw, hanya kartu baru yang boleh dimainkan.'); }
  if (!isPlayable(room, card)) throw new Error('Kartu belum cocok.');
  if ((card.type === 'wild' || card.type === 'wild4') && !COLORS.includes(chosenColor)) throw new Error('Pilih warna dulu.');
  if (card.type === 'wild4' && !canUseWild4(room, player, card.id)) throw new Error('Wild +4 hanya boleh jika tidak punya warna aktif.');
  player.hand.splice(idx, 1); room.discard.push(card); room.currentColor = card.color === 'wild' ? chosenColor : card.color; player.saidUno = false;
  const acc = db.players[player.accountId]; if (acc) acc.stats.cardsPlayed += 1;
  addLog(room, `${player.name} memainkan ${cardLabel(card)}${card.color === 'wild' ? ` → ${colorName(chosenColor)}` : ''}.`, 'card');
  if (player.hand.length === 0) return finishGame(room, player);
  applyCardEffect(room, card); armTurnTimer(room); savePlayers(); saveRooms();
}
function applyCardEffect(room, card) { const ps = activePlayers(room); if (ps.length <= 1) return; if (card.type === 'skip') { const skipped = ps[nextIndex(room, 1)]; moveToNextPlayer(room, 2); addLog(room, `${skipped?.name || 'Pemain'} dilewati.`, 'card'); return; } if (card.type === 'reverse') { room.direction *= -1; if (ps.length === 2) { const skipped = ps[nextIndex(room, 1)]; moveToNextPlayer(room, 2); addLog(room, `Arah dibalik. ${skipped?.name || 'Pemain'} dilewati.`, 'card'); } else { moveToNextPlayer(room, 1); addLog(room, 'Arah permainan dibalik.', 'card'); } return; } if (card.type === 'draw2') { const target = ps[nextIndex(room, 1)]; const drawn = drawPenalty(room, target, 2); moveToNextPlayer(room, 2); addLog(room, `${target?.name || 'Pemain'} mengambil ${drawn} kartu dan dilewati.`, 'card'); return; } if (card.type === 'wild4') { const target = ps[nextIndex(room, 1)]; const drawn = drawPenalty(room, target, 4); moveToNextPlayer(room, 2); addLog(room, `${target?.name || 'Pemain'} mengambil ${drawn} kartu dan dilewati.`, 'card'); return; } moveToNextPlayer(room, 1); }
function drawOne(room, playerId) { if (room.status !== 'playing') throw new Error('Game belum berjalan.'); const player = getPlayer(room, playerId); const turn = currentPlayer(room); if (!player || !turn || player.id !== turn.id) throw new Error('Belum giliran kamu.'); if (room.turnState.hasDrawn) throw new Error('Kamu sudah draw.'); const cards = drawCards(room, player, 1); const card = cards[0]; const playable = !!card && isPlayable(room, card); const acc = db.players[player.accountId]; if (acc) acc.stats.draws += 1; room.turnState = { playerId: player.id, hasDrawn: true, drawnCardId: card?.id || null, drawnCardPlayable: playable }; if (!card) { moveToNextPlayer(room, 1); addLog(room, `${player.name} draw, tetapi deck habis.`, 'card'); } else if (playable) { addLog(room, `${player.name} mengambil 1 kartu dan boleh mainkan kartu baru atau pass.`, 'card'); } else { addLog(room, `${player.name} mengambil 1 kartu. Kartu tidak cocok, giliran lewat.`, 'card'); moveToNextPlayer(room, 1); } armTurnTimer(room); savePlayers(); saveRooms(); return cards; }
function passAfterDraw(room, playerId) { if (room.status !== 'playing') throw new Error('Game belum berjalan.'); const player = getPlayer(room, playerId); const turn = currentPlayer(room); if (!player || !turn || player.id !== turn.id) throw new Error('Belum giliran kamu.'); if (!room.turnState.hasDrawn || room.turnState.playerId !== player.id) throw new Error('Kamu belum draw.'); addLog(room, `${player.name} memilih pass.`, 'card'); moveToNextPlayer(room, 1); armTurnTimer(room); saveRooms(); }
function sayUno(room, playerId) { const player = getPlayer(room, playerId); if (!player) throw new Error('Pemain tidak ditemukan.'); if (player.hand.length !== 1) throw new Error('UNO hanya saat kartu tinggal 1.'); player.saidUno = true; const acc = db.players[player.accountId]; if (acc) { acc.stats.unoCalls += 1; savePlayers(); } addLog(room, `${player.name} berteriak: UNO!`, 'uno'); saveRooms(); }
function challengeUno(room, challengerId, targetId) { const ch = getPlayer(room, challengerId); const t = getPlayer(room, targetId); if (!ch || !t) throw new Error('Pemain tidak ditemukan.'); if (ch.id === t.id) throw new Error('Tidak bisa challenge diri sendiri.'); if (t.hand.length !== 1) throw new Error('Target tidak sedang punya 1 kartu.'); if (t.saidUno) throw new Error(`${t.name} sudah menekan UNO.`); if (t.powers?.unoGuard && !t.powers.used?.unoGuard) { t.powers.used.unoGuard = true; t.powers.unoGuard = false; addLog(room, `🛡️ ${t.name} dilindungi UNO Guard dari challenge.`, 'power'); return; } const drawn = drawCards(room, t, 2).length; const acc = db.players[ch.accountId]; if (acc) { acc.stats.challengesWon += 1; savePlayers(); } addLog(room, `${ch.name} menangkap ${t.name} lupa UNO. ${t.name} mengambil ${drawn} kartu.`, 'uno'); saveRooms(); }
function passTurnByTimeout(room) { if (room.status !== 'playing') return; const p = currentPlayer(room); if (!p) return; drawCards(room, p, 1); addLog(room, `${p.name} terlalu lama. Otomatis draw 1 dan giliran lewat.`, 'timeout'); moveToNextPlayer(room, 1); emitRoom(room.code); armTurnTimer(room); saveRooms(); }
function finishGame(room, winner) { room.status = 'finished'; room.winnerAccountId = winner.accountId; stopTurnTimer(room); addLog(room, `🏆 ${winner.name} menang! Room akan reset otomatis.`, 'win'); const ps = activePlayers(room); for (const p of ps) { const acc = db.players[p.accountId]; if (!acc) continue; acc.stats.games += 1; const base = p.accountId === winner.accountId ? 220 : 60; const mult = p.powers?.doublePoints && !p.powers.used?.doublePoints ? 2 : 1; p.powers.used.doublePoints = true; p.powers.doublePoints = false; addPoints(acc, base * mult); if (p.accountId === winner.accountId) { acc.stats.wins += 1; acc.stats.winStreak += 1; acc.stats.bestStreak = Math.max(acc.stats.bestStreak, acc.stats.winStreak); if (room.hostAccountId === p.accountId) acc.stats.winsAsHost += 1; } else { acc.stats.losses += 1; acc.stats.winStreak = 0; } } savePlayers(); saveRooms(); emitRoom(room.code); scheduleAutoReset(room); }
function resetRoomToLobby(room, reason = 'Room reset dan dibuka lagi.') { stopTurnTimer(room); clearAutoReset(room); room.status = 'lobby'; room.deck = []; room.discard = []; room.currentColor = null; room.currentIndex = 0; room.direction = 1; room.winnerAccountId = null; room.turnEndsAt = null; room.turnState = { playerId: null, hasDrawn: false, drawnCardId: null, drawnCardPlayable: false }; room.logs = []; for (const p of activePlayers(room)) { p.hand = []; p.saidUno = false; p.powers = { drawShield: false, doublePoints: false, unoGuard: false, used: {} }; } addLog(room, reason, 'system'); saveRooms(); emitRoom(room.code); }
function clearAutoReset(room) { if (room.autoResetTimer) clearTimeout(room.autoResetTimer); room.autoResetTimer = null; }
function scheduleAutoReset(room) { clearAutoReset(room); room.autoResetAt = Date.now() + AUTO_RESET_SECONDS * 1000; room.autoResetTimer = setTimeout(() => resetRoomToLobby(room), AUTO_RESET_SECONDS * 1000); }
function stopTurnTimer(room) { if (room.turnTimer) clearTimeout(room.turnTimer); room.turnTimer = null; room.turnEndsAt = null; }
function armTurnTimer(room) { stopTurnTimer(room); if (room.status !== 'playing') return; const remaining = room.turnEndsAt && room.turnEndsAt > Date.now() ? room.turnEndsAt - Date.now() : room.settings.turnSeconds * 1000; room.turnEndsAt = Date.now() + remaining; room.turnTimer = setTimeout(() => passTurnByTimeout(room), remaining + 800); }

function serializeRoom(room) { const r = { ...room }; delete r.turnTimer; delete r.autoResetTimer; r.players = r.players.map((p) => ({ ...p, socketId: null, connected: false })); return r; }
function loadRooms() { const raw = readJSON(ROOMS_FILE, { rooms: [] }); for (const item of raw.rooms || []) { if (!item.code) continue; item.turnTimer = null; item.autoResetTimer = null; for (const p of item.players || []) { p.connected = false; p.socketId = null; } rooms.set(item.code, item); if (item.status === 'playing') armTurnTimer(item); if (item.status === 'finished' && item.autoResetAt) { const delay = Math.max(1000, item.autoResetAt - Date.now()); item.autoResetTimer = setTimeout(() => resetRoomToLobby(item), delay); } } }
loadRooms();

function publicMusic(music = {}) { return { status: music.status || 'stopped', song: music.song || null, startedAt: music.startedAt || null, positionSec: Number(music.positionSec || 0), updatedAt: music.updatedAt || Date.now(), by: music.by || null }; }
function cleanSong(song) { if (!song) return null; const videoId = String(song.videoId || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 32); return { source: 'youtube', videoId, title: String(song.title || 'YouTube Song').slice(0, 120), artist: String(song.artist || 'YouTube').slice(0, 80), thumbnail: String(song.thumbnail || '').slice(0, 400), duration: String(song.duration || '').slice(0, 20) }; }
function emitMusic(room) { io.to(room.code).emit('music:room-state', publicMusic(room.music)); }

function publicState(room) { const ps = activePlayers(room); const turn = currentPlayer(room); return { code: room.code, name: room.name, hostAccountId: room.hostAccountId, status: room.status, currentColor: room.currentColor, currentPlayerId: turn?.id || null, direction: room.direction, deckCount: room.deck.length, discardTop: room.discard.at(-1) || null, winnerAccountId: room.winnerAccountId, message: room.message, turnEndsAt: room.turnEndsAt, autoResetAt: room.autoResetAt || null, turnState: { playerId: room.turnState.playerId, hasDrawn: room.turnState.hasDrawn, drawnCardPlayable: room.turnState.drawnCardPlayable }, players: ps.map((p) => ({ id: p.id, accountId: p.accountId, name: p.name, connected: p.connected, isHost: p.accountId === room.hostAccountId, cardCount: p.hand.length, saidUno: p.saidUno, score: p.score, avatarData: p.avatarData, equipped: p.equipped, powers: { drawShield: !!p.powers?.drawShield, doublePoints: !!p.powers?.doublePoints, unoGuard: !!p.powers?.unoGuard } })), logs: room.logs, chat: room.chat || [], music: publicMusic(room.music) }; }
function privateState(room, playerId) { const p = getPlayer(room, playerId); return { ...publicState(room), me: p ? { id: p.id, accountId: p.accountId, name: p.name, hand: p.hand, isHost: p.accountId === room.hostAccountId, connected: p.connected, avatarData: p.avatarData, equipped: p.equipped, powers: p.powers } : null, myTurnState: { isMyTurn: currentPlayer(room)?.id === p?.id, hasDrawn: room.turnState.playerId === p?.id && room.turnState.hasDrawn, drawnCardId: room.turnState.playerId === p?.id ? room.turnState.drawnCardId : null, drawnCardPlayable: room.turnState.playerId === p?.id ? room.turnState.drawnCardPlayable : false, hasPlayableBeforeDraw: p ? hasPlayableCard(room, p.hand) : false } }; }
function emitRoom(code) { const room = rooms.get(code); if (!room) return; for (const p of activePlayers(room)) { if (p.socketId) io.to(p.socketId).emit('state', privateState(room, p.id)); } emitVoiceList(code); }
function emitError(socket, message) { socket.emit('toast', { type: 'error', message: String(message || 'Terjadi error.') }); }
function roomList() { const now = Date.now(); return [...rooms.values()].filter((r) => r.status === 'lobby' && connectedPlayers(r).length > 0 && now - r.updatedAt < ROOM_TTL_MS).map((r) => ({ code: r.code, name: r.name, locked: !!r.passwordHash, players: connectedPlayers(r).length, maxPlayers: MAX_PLAYERS, host: db.players[r.hostAccountId]?.displayName || 'Host', updatedAt: r.updatedAt })); }
function leaderboard() { const arr = Object.values(db.players).map(publicProfile).sort((a, b) => (b.stats.wins - a.stats.wins) || (b.points - a.points)).slice(0, 100); return arr; }
function socketRoomOf(socket, code) { return rooms.get(String(code || '').trim().toUpperCase()); }
function ensurePlayer(room, account) { const p = getPlayerByAccount(room, account.id); if (!p) throw new Error('Kamu belum ada di room ini.'); return p; }
function leaveRoom(socket, room, player, hard = false) { if (!room || !player) return; if (hard || room.status !== 'playing') { player.left = true; player.connected = false; addLog(room, `${player.name} keluar dari room.`, 'system'); } else { player.connected = false; player.socketId = null; player.disconnectedAt = Date.now(); addLog(room, `${player.name} terputus. Bisa reconnect.`, 'system'); } if (room.hostAccountId === player.accountId) { const next = activePlayers(room).find((p) => p.connected) || activePlayers(room)[0]; if (next) { room.hostAccountId = next.accountId; addLog(room, `${next.name} sekarang menjadi host.`, 'system'); } } if (activePlayers(room).length === 0 || (room.status !== 'playing' && connectedPlayers(room).length === 0)) { stopTurnTimer(room); rooms.delete(room.code); saveRooms(); io.emit('rooms:list', roomList()); return; } saveRooms(); emitRoom(room.code); io.emit('rooms:list', roomList()); }

function addItemToPlayer(p, itemId, qty = 1) { const item = SHOP.find((x) => x.id === itemId); if (!item) return; if (item.type === 'power') p.inventory.powers[item.id] = (p.inventory.powers[item.id] || 0) + qty; else if (!p.inventory.cosmetics.includes(item.id)) p.inventory.cosmetics.push(item.id); }
function rollRarity(odds) { const total = Object.values(odds).reduce((a, b) => a + b, 0); let r = Math.random() * total; for (const [rarity, weight] of Object.entries(odds)) { r -= weight; if (r <= 0) return rarity; } return 'Common'; }
function crateReward(crate) { const rarity = rollRarity(crate.odds); const pool = SHOP.filter((i) => i.rarity === rarity); if (pool.length && Math.random() > 0.25) return { kind: 'item', rarity, item: pool[Math.floor(Math.random() * pool.length)] }; const points = { Common: 120, Rare: 260, Epic: 550, Legendary: 1200, Mythic: 2500 }[rarity] || 100; return { kind: 'points', rarity, points }; }

io.on('connection', (socket) => {
  socket.on('auth:register', ({ username, pin } = {}, cb) => { try { const name = normalizeName(username); if (name.length < 3) throw new Error('Username minimal 3 karakter.'); if (String(pin || '').length < 4) throw new Error('PIN minimal 4 angka/karakter.'); if (db.byName[name]) throw new Error('Username sudah dipakai. Silakan login atau pilih nama lain.'); const p = basePlayer(name, pin); db.players[p.id] = p; db.byName[name] = p.id; savePlayers(); cb?.({ ok: true, profile: publicProfile(p), auth: { accountId: p.id, token: p.token } }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('auth:login', ({ username, pin } = {}, cb) => { try { const id = db.byName[normalizeName(username)]; const p = db.players[id]; if (!p || p.pinHash !== pinHash(pin)) throw new Error('Username atau PIN salah.'); p.lastLoginAt = Date.now(); if (!p.token) p.token = token(); savePlayers(); cb?.({ ok: true, profile: publicProfile(p), auth: { accountId: p.id, token: p.token } }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('auth:resume', ({ auth } = {}, cb) => { const p = authUser(auth); cb?.(p ? { ok: true, profile: publicProfile(p) } : { ok: false, error: 'Session login habis.' }); });
  socket.on('profile:update', ({ auth, displayName, avatarData } = {}, cb) => { try { const p = requireAuth(auth); if (displayName) p.displayName = cleanName(displayName); if (avatarData !== undefined) { const data = String(avatarData || ''); if (data && !data.startsWith('data:image/')) throw new Error('Foto harus berupa gambar.'); if (data.length > 450000) throw new Error('Foto terlalu besar. Pakai gambar lebih kecil.'); p.avatarData = data; } savePlayers(); cb?.({ ok: true, profile: publicProfile(p) }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('profile:get', ({ auth } = {}, cb) => { try { cb?.({ ok: true, profile: publicProfile(requireAuth(auth)), shop: SHOP, crates: CRATES }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('leaderboard:get', (_data, cb) => cb?.({ ok: true, leaderboard: leaderboard() }));
  socket.on('shop:buy', ({ auth, itemId } = {}, cb) => { try { const p = requireAuth(auth); const item = SHOP.find((x) => x.id === itemId); if (!item) throw new Error('Item tidak ditemukan.'); if (!spendPoints(p, item.price)) throw new Error('Poin tidak cukup.'); addItemToPlayer(p, item.id, 1); savePlayers(); cb?.({ ok: true, profile: publicProfile(p), item }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('inventory:equip', ({ auth, itemId } = {}, cb) => { try { const p = requireAuth(auth); const item = SHOP.find((x) => x.id === itemId) || { id: itemId, type: itemId === 'rookie' ? 'badge' : itemId === 'none' ? 'frame' : itemId === 'default' ? 'tableTheme' : 'cardSkin' }; if (!p.inventory.cosmetics.includes(itemId)) throw new Error('Item belum dimiliki.'); if (item.type === 'power') throw new Error('Power tidak bisa di-equip. Gunakan di game.'); p.equipped[item.type] = itemId; savePlayers(); cb?.({ ok: true, profile: publicProfile(p) }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('crate:open', ({ auth, crateId } = {}, cb) => { try { const p = requireAuth(auth); const crate = CRATES.find((c) => c.id === crateId); if (!crate) throw new Error('Crate tidak ditemukan.'); if (!spendPoints(p, crate.price)) throw new Error('Poin tidak cukup.'); const rewards = Array.from({ length: 12 }, () => crateReward(crate)); const reward = rewards[Math.floor(6 + Math.random() * 4)] || rewards[0]; if (reward.kind === 'points') addPoints(p, reward.points); else addItemToPlayer(p, reward.item.id, 1); p.inventory.cratesOpened += 1; savePlayers(); cb?.({ ok: true, rewards, reward, profile: publicProfile(p) }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('friends:search', ({ auth, query } = {}, cb) => { try { requireAuth(auth); const q = normalizeName(query); const results = Object.values(db.players).filter((p) => p.username.includes(q) || String(p.displayName || '').toLowerCase().includes(q)).slice(0, 12).map((p) => ({ id: p.id, username: p.username, displayName: p.displayName, avatarData: p.avatarData })); cb?.({ ok: true, results }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('friends:add', ({ auth, username } = {}, cb) => { try { const p = requireAuth(auth); const target = db.players[db.byName[normalizeName(username)]]; if (!target) throw new Error('Player tidak ditemukan.'); if (target.id === p.id) throw new Error('Tidak bisa tambah diri sendiri.'); if (p.friends.includes(target.id)) throw new Error('Sudah berteman.'); if (!target.requestsIn.includes(p.id)) target.requestsIn.push(p.id); if (!p.requestsOut.includes(target.id)) p.requestsOut.push(target.id); savePlayers(); cb?.({ ok: true, profile: publicProfile(p) }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('friends:accept', ({ auth, accountId } = {}, cb) => { try { const p = requireAuth(auth); const t = db.players[accountId]; if (!t || !p.requestsIn.includes(accountId)) throw new Error('Request tidak ada.'); p.requestsIn = p.requestsIn.filter((id) => id !== accountId); t.requestsOut = t.requestsOut.filter((id) => id !== p.id); if (!p.friends.includes(t.id)) p.friends.push(t.id); if (!t.friends.includes(p.id)) t.friends.push(p.id); savePlayers(); cb?.({ ok: true, profile: publicProfile(p) }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('friends:invite', ({ auth, friendId, roomCode } = {}, cb) => { try { const p = requireAuth(auth); const f = db.players[friendId]; const room = rooms.get(String(roomCode || '').toUpperCase()); if (!f || !p.friends.includes(friendId)) throw new Error('Teman tidak valid.'); if (!room || !getPlayerByAccount(room, p.id)) throw new Error('Kamu belum ada di room.'); f.invites.unshift({ id: uid('inv_'), from: p.id, fromName: p.displayName || p.username, roomCode: room.code, roomName: room.name, at: Date.now() }); f.invites = f.invites.slice(0, 20); savePlayers(); cb?.({ ok: true }); } catch (e) { cb?.({ ok: false, error: e.message }); } });

  socket.on('rooms:list', (_data, cb) => cb?.({ ok: true, rooms: roomList() }));
  socket.on('createRoom', ({ auth, name, password } = {}, cb) => { try { const acc = requireAuth(auth); removeAccountFromOtherLobby(acc.id); const room = makeRoom(acc, socket.id, { name, password }); socket.join(room.code); cb?.({ ok: true, roomCode: room.code, playerId: getPlayerByAccount(room, acc.id).id }); emitRoom(room.code); io.emit('rooms:list', roomList()); } catch (e) { cb?.({ ok: false, error: e.message }); emitError(socket, e.message); } });
  socket.on('joinRoom', ({ auth, roomCode, password, inviteId } = {}, cb) => { try { const acc = requireAuth(auth); const code = String(roomCode || '').trim().toUpperCase(); const room = rooms.get(code); if (!room) throw new Error('Room tidak ditemukan.'); if (room.status !== 'lobby') throw new Error('Game sudah berjalan. Reconnect jika kamu pemain lama.'); const hasInvite = !!inviteId && acc.invites.some((i) => i.id === inviteId && i.roomCode === code); if (room.passwordHash && !hasInvite && pinHash(password || '') !== room.passwordHash) throw new Error('Password room salah.'); removeAccountFromOtherLobby(acc.id, code); let p = getPlayerByAccount(room, acc.id); if (p) { p.socketId = socket.id; p.connected = true; p.left = false; p.disconnectedAt = null; p.name = acc.displayName || acc.username; p.avatarData = acc.avatarData || ''; p.equipped = acc.equipped || {}; addLog(room, `${p.name} reconnect ke lobby.`, 'system'); } else { if (activePlayers(room).length >= MAX_PLAYERS) throw new Error('Room penuh.'); p = makePlayerFromAccount(acc, socket.id, false); room.players.push(p); addLog(room, `${p.name} masuk ke room.`, 'system'); } acc.invites = acc.invites.filter((i) => i.id !== inviteId); socket.join(room.code); savePlayers(); saveRooms(); cb?.({ ok: true, roomCode: room.code, playerId: p.id }); emitRoom(room.code); io.emit('rooms:list', roomList()); } catch (e) { cb?.({ ok: false, error: e.message }); emitError(socket, e.message); } });
  socket.on('reconnectRoom', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = rooms.get(String(roomCode || '').trim().toUpperCase()); if (!room) throw new Error('Room lama sudah tidak ada.'); const p = getPlayerByAccount(room, acc.id); if (!p) throw new Error('Akun ini tidak ada di room tersebut.'); p.socketId = socket.id; p.connected = true; p.left = false; p.disconnectedAt = null; p.name = acc.displayName || acc.username; p.avatarData = acc.avatarData || ''; p.equipped = acc.equipped || {}; socket.join(room.code); addLog(room, `${p.name} reconnect.`, 'system'); saveRooms(); cb?.({ ok: true, roomCode: room.code, playerId: p.id }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('startGame', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); if (!room) throw new Error('Room tidak ditemukan.'); if (room.hostAccountId !== acc.id) throw new Error('Hanya host yang bisa mulai.'); startGame(room); cb?.({ ok: true }); emitRoom(room.code); io.emit('rooms:list', roomList()); } catch (e) { cb?.({ ok: false, error: e.message }); emitError(socket, e.message); } });
  socket.on('playCard', ({ auth, roomCode, cardId, chosenColor } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); const p = ensurePlayer(room, acc); playCard(room, p.id, cardId, chosenColor); cb?.({ ok: true }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); emitError(socket, e.message); } });
  socket.on('drawCard', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); const p = ensurePlayer(room, acc); const cards = drawOne(room, p.id); cb?.({ ok: true, cards }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); emitError(socket, e.message); } });
  socket.on('passTurn', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); const p = ensurePlayer(room, acc); passAfterDraw(room, p.id); cb?.({ ok: true }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); emitError(socket, e.message); } });
  socket.on('sayUno', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); const p = ensurePlayer(room, acc); sayUno(room, p.id); cb?.({ ok: true }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); emitError(socket, e.message); } });
  socket.on('challengeUno', ({ auth, roomCode, targetId } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); const p = ensurePlayer(room, acc); challengeUno(room, p.id, targetId); cb?.({ ok: true }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); emitError(socket, e.message); } });
  socket.on('usePower', ({ auth, roomCode, powerId } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); if (!room || room.status !== 'playing') throw new Error('Power hanya bisa saat game berjalan.'); const p = ensurePlayer(room, acc); const invKey = powerId; if ((acc.inventory.powers[invKey] || 0) <= 0) throw new Error('Stok power habis.'); if (p.powers.used?.[powerId] || p.powers[powerId]) throw new Error('Power ini sudah aktif/terpakai di game ini.'); if (powerId === 'power_draw_shield') p.powers.drawShield = true; else if (powerId === 'power_double_points') p.powers.doublePoints = true; else if (powerId === 'power_uno_guard') p.powers.unoGuard = true; else throw new Error('Power tidak dikenal.'); acc.inventory.powers[invKey] -= 1; addLog(room, `✨ ${p.name} mengaktifkan ${SHOP.find((i) => i.id === powerId)?.name || 'Power'}.`, 'power'); savePlayers(); saveRooms(); cb?.({ ok: true, profile: publicProfile(acc) }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('restartGame', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); if (room.hostAccountId !== acc.id) throw new Error('Hanya host.'); startGame(room); cb?.({ ok: true }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('backToLobby', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); if (room.hostAccountId !== acc.id) throw new Error('Hanya host.'); resetRoomToLobby(room, 'Host membuka lobby lagi.'); cb?.({ ok: true }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('sendChat', ({ auth, roomCode, text } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); const p = ensurePlayer(room, acc); addChat(room, p, text); saveRooms(); cb?.({ ok: true }); emitRoom(room.code); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('leaveRoom', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); if (room) leaveRoom(socket, room, getPlayerByAccount(room, acc.id), true); cb?.({ ok: true }); } catch (e) { cb?.({ ok: false, error: e.message }); } });

  socket.on('music:room-play', ({ auth, roomCode, song, positionSec = 0 } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); if (!room || room.hostAccountId !== acc.id) throw new Error('Hanya host yang bisa memutar musik room.'); const clean = cleanSong(song); if (!clean?.videoId) throw new Error('Lagu YouTube tidak valid.'); room.music = { status: 'playing', song: clean, startedAt: Date.now(), positionSec: Number(positionSec || 0), updatedAt: Date.now(), by: acc.displayName || acc.username }; addLog(room, `🎧 Host memutar: ${clean.title}`, 'music'); saveRooms(); emitMusic(room); emitRoom(room.code); cb?.({ ok: true, music: publicMusic(room.music) }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('music:room-pause', ({ auth, roomCode, positionSec = 0 } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); if (!room || room.hostAccountId !== acc.id) throw new Error('Hanya host.'); room.music = { ...room.music, status: 'paused', positionSec: Number(positionSec || 0), updatedAt: Date.now() }; saveRooms(); emitMusic(room); cb?.({ ok: true }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('music:room-stop', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); if (!room || room.hostAccountId !== acc.id) throw new Error('Hanya host.'); room.music = { status: 'stopped', song: null, startedAt: null, positionSec: 0, updatedAt: Date.now(), by: acc.displayName || acc.username }; saveRooms(); emitMusic(room); cb?.({ ok: true }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('music:room-request', ({ roomCode } = {}, cb) => { const room = rooms.get(String(roomCode || '').toUpperCase()); if (room) { socket.emit('music:room-state', publicMusic(room.music)); cb?.({ ok: true, music: publicMusic(room.music) }); } });

  socket.on('voice:join', ({ auth, roomCode } = {}, cb) => { try { const acc = requireAuth(auth); const room = socketRoomOf(socket, roomCode); const p = ensurePlayer(room, acc); if (!voiceRooms.has(room.code)) voiceRooms.set(room.code, new Map()); const vr = voiceRooms.get(room.code); for (const [pid, sid] of [...vr.entries()]) { if (sid === socket.id || pid === p.id) vr.delete(pid); } vr.set(p.id, socket.id); socket.join(`voice:${room.code}`); const participants = voiceParticipants(room.code); emitVoiceList(room.code); cb?.({ ok: true, peers: participants.filter((x) => x.playerId !== p.id), participants }); } catch (e) { cb?.({ ok: false, error: e.message }); } });
  socket.on('voice:leave', ({ auth, roomCode } = {}, cb) => { const acc = authUser(auth); const room = rooms.get(String(roomCode || '').toUpperCase()); const p = room && acc ? getPlayerByAccount(room, acc.id) : null; if (room && p && voiceRooms.has(room.code)) { voiceRooms.get(room.code).delete(p.id); socket.leave(`voice:${room.code}`); socket.to(room.code).emit('voice:peer-left', { playerId: p.id }); emitVoiceList(room.code); } cb?.({ ok: true }); });
  socket.on('voice:signal', ({ auth, roomCode, toPlayerId, data } = {}) => { const room = rooms.get(String(roomCode || '').toUpperCase()); const acc = authUser(auth); const fromPlayer = room && acc ? getPlayerByAccount(room, acc.id) : null; const pmap = room && voiceRooms.get(room.code); const targetSocketId = pmap?.get(toPlayerId); const fromPlayerId = fromPlayer?.id || [...(pmap?.entries?.() || [])].find(([, sid]) => sid === socket.id)?.[0]; if (targetSocketId && fromPlayerId) io.to(targetSocketId).emit('voice:signal', { fromPlayerId, data }); });

  socket.on('disconnect', () => { for (const room of rooms.values()) { const p = room.players.find((x) => x.socketId === socket.id && !x.left); if (p) { p.socketId = null; p.connected = false; p.disconnectedAt = Date.now(); addLog(room, `${p.name} terputus.`, 'system'); const vr = voiceRooms.get(room.code); if (vr) { vr.delete(p.id); socket.to(room.code).emit('voice:peer-left', { playerId: p.id }); emitVoiceList(room.code); } emitRoom(room.code); } } saveRooms(); });
});
function voiceParticipants(code) { const room = rooms.get(code); const vr = voiceRooms.get(code) || new Map(); return [...vr.keys()].map((pid) => { const p = room && getPlayer(room, pid); return { playerId: pid, name: p?.name || 'Player', avatarData: p?.avatarData || '', self: false }; }); }
function emitVoiceList(code) { const payload = { participants: voiceParticipants(code) }; io.to(code).emit('voice:list', payload); io.to(`voice:${code}`).emit('voice:list', payload); }

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) { stopTurnTimer(room); rooms.delete(code); continue; }
    for (const p of room.players) if (!p.connected && p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_KEEP_MS) p.left = true;
    if (activePlayers(room).length === 0 || (room.status !== 'playing' && connectedPlayers(room).length === 0)) { stopTurnTimer(room); rooms.delete(code); }
  }
  saveRooms(); io.emit('rooms:list', roomList());
}, 60_000);

server.listen(PORT, HOST, () => console.log(`UNO by Ryuu Final running on http://${HOST}:${PORT}`));
