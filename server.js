/**
 * STREAM BATTLE — Server
 * Protocol:
 *   1. Client loads → sends videos_ready
 *   2. Both players videos_ready → battle can start
 *   3. Both players lock cards → server sends clash_info (which video)
 *   4. Client preps video → sends clash_ready
 *   5. Both clash_ready → server sends clash_play
 *   6. Clients play video instantly
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const express = require('express');
const expressApp = express();
expressApp.use(express.static(path.join(__dirname)));
expressApp.get('/', (req, res) => res.sendFile(path.join(__dirname, 'app.html')));
expressApp.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
expressApp.get('/sw.js', (req, res) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

const http = require('http');
const server = http.createServer(expressApp);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(data, excludeId) {
  const msg = JSON.stringify(data);
  for (const [id, c] of clients) {
    if (id !== excludeId && c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }
}

const clients = new Map();
const battles = new Map();
let nextId = 1;

const GIFTS = {
  fire_blast:  { label:'Fire Blast',  icon:'🔥', color:'#f60', type:'card', desc:'Gift a Fire card!',      card:'fire' },
  ice_freeze:  { label:'Ice Freeze',  icon:'❄️',  color:'#8cf', type:'card', desc:'Gift an Ice card!',       card:'ice' },
  lightning:   { label:'Lightning',   icon:'⚡',  color:'#ff0', type:'card', desc:'Gift a Lightning card!',  card:'lightning' },
  rock_drop:   { label:'Rock Drop',   icon:'🪨', color:'#c94', type:'card', desc:'Gift a Rock card!',       card:'rock' },
  wind_gust:   { label:'Wind Gust',   icon:'💨', color:'#afc', type:'card', desc:'Gift a Wind card!',       card:'wind' },
  rubber_band: { label:'Rubber',      icon:'⚫', color:'#888', type:'card', desc:'Gift a Rubber card!',     card:'rubber' },
  plant_surge: { label:'Plant Surge', icon:'🌿', color:'#4f8', type:'card', desc:'Gift a Plant card!',      card:'plant' },
};

function getStreamers() {
  const list = [];
  for (const [id, c] of clients) if (c.role === 'streamer') list.push({ id, name: c.name, status: c.status });
  return list;
}
function broadcastStreamers() { broadcast({ type: 'streamer_list', streamers: getStreamers() }); }

const ELEMENTS = ['fire','ice','lightning','rock','wind','rubber','plant'];
const BEATS = {
  fire:      ['ice', 'plant', 'wind'],
  ice:       ['rock', 'lightning', 'wind'],
  lightning: ['fire', 'plant', 'rock'],
  rock:      ['fire', 'wind', 'rubber'],
  wind:      ['lightning', 'rubber', 'plant'],
  rubber:    ['lightning', 'fire', 'ice'],
  plant:     ['rock', 'ice', 'rubber'],
};

function dealHand() {
  return [...ELEMENTS].sort(() => Math.random() - .5).slice(0, 4);
}
function cardName(card) { return card.charAt(0).toUpperCase() + card.slice(1); }
function addLog(battle, msg, color) {
  battle.log.push({ msg, color: color || '#0ff' });
  if (battle.log.length > 60) battle.log.shift();
}
function notifyPlayers(battle, data) {
  battle.players.forEach(pid => { const c = clients.get(pid); if (c) send(c.ws, data); });
}
function notifySpectators(battle, data) {
  for (const [id, c] of clients) if (c.battleId === battle.id && !battle.players.includes(id)) send(c.ws, data);
}
function notifyAll(battle, data) { notifyPlayers(battle, data); notifySpectators(battle, data); }

// ─── CLASH VIDEO MAP (same as client) ────────────────────────────────────────
const CLASH_VIDEOS = {
  'fire-ice':         'clash-fire-ice.mp4',
  'ice-fire':         'clash-fire-ice.mp4',
  'ice-rock':         'clash-ice-rock.mp4',
  'rock-ice':         'clash-ice-rock.mp4',
  'wind-lightning':   'clash-female-wind-lightning.mp4',
  'lightning-wind':   'clash-female-wind-lightning.mp4',
  'fire-plant':       'clash-fire-plant.mp4',
  'plant-fire':       'clash-fire-plant.mp4',
  'rubber-lightning': 'clash-rubber-lightning.mp4',
  'lightning-rubber': 'clash-rubber-lightning.mp4',
  'fire-wind':        'clash-fire-wind.mp4',
  'wind-fire':        'clash-fire-wind.mp4',
  'plant-rock':       'clash-plant-rock.mp4',
  'rock-plant':       'clash-plant-rock.mp4',
  'rock-fire':        'clash-rock-fire.mp4',
  'fire-rock':        'clash-rock-fire.mp4',
  'wind-plant':       'clash-female-wind-plant.mp4',
  'plant-wind':       'clash-female-wind-plant.mp4',
  'ice-rubber':       'clash-ice-rubber.mp4',
  'rubber-ice':       'clash-ice-rubber.mp4',
  'plant-rubber':     'clash-plant-rubber.mp4',
  'rubber-plant':     'clash-plant-rubber.mp4',
  'wind-rubber':      'clash-female-wind-rubber.mp4',
  'rubber-wind':      'clash-female-wind-rubber.mp4',
  'rock-rubber':      'clash-rock-rubber.mp4',
  'rubber-rock':      'clash-rock-rubber.mp4',
  'rock-wind':        'clash-rock-female-wind.mp4',
  'wind-rock':        'clash-rock-female-wind.mp4',
  'lightning-plant':  'clash-lightning-plant.mp4',
  'plant-lightning':  'clash-lightning-plant.mp4',
  'lightning-rock':   'clash-lightning-rock.mp4',
  'rock-lightning':   'clash-lightning-rock.mp4',
  'ice-wind':         'clash-ice-female-wind.mp4',
  'wind-ice':         'clash-ice-female-wind.mp4',
  'plant-ice':        'clash-plant-ice.mp4',
  'ice-plant':        'clash-plant-ice.mp4',
  'lightning-fire':   'clash-lightning-fire.mp4',
  'fire-lightning':   'clash-lightning-fire.mp4',
  'fire-rubber':      'clash-rubber-fire.mp4',
  'rubber-fire':      'clash-rubber-fire.mp4',
  'ice-lightning':    'clash-ice-lightning.mp4',
  'lightning-ice':    'clash-ice-lightning.mp4',
};

function resolveRound(battle) {
  const [c0, c1] = battle.choices;
  let winner = -1, reason = '', dmg = [0, 0];

  if (c0 === c1) {
    winner = -1; reason = 'Draw! Both played ' + cardName(c0) + '!';
  } else if (BEATS[c0]?.includes(c1)) {
    winner = 0; reason = cardName(c0) + ' defeats ' + cardName(c1) + '!'; dmg[1] = 25;
  } else if (BEATS[c1]?.includes(c0)) {
    winner = 1; reason = cardName(c1) + ' defeats ' + cardName(c0) + '!'; dmg[0] = 25;
  } else {
    winner = -1; reason = 'Draw! ' + cardName(c0) + ' vs ' + cardName(c1) + '!';
  }

  if (battle.format?.type === 'hp') {
    battle.hp[0] = Math.max(0, battle.hp[0] - dmg[0]);
    battle.hp[1] = Math.max(0, battle.hp[1] - dmg[1]);
  } else {
    if (winner === 0) battle.scores[0]++;
    if (winner === 1) battle.scores[1]++;
  }
  battle.lastCards = [...battle.choices];
  addLog(battle, reason, winner === -1 ? '#aaa' : '#ff0');

  let matchWinner = -1;
  if (battle.format?.type === 'hp') {
    if (battle.hp[0] <= 0 && battle.hp[1] <= 0) matchWinner = -1;
    else if (battle.hp[0] <= 0) matchWinner = 1;
    else if (battle.hp[1] <= 0) matchWinner = 0;
  } else {
    const t = battle.format?.value || 5;
    if (battle.scores[0] >= t) matchWinner = 0;
    else if (battle.scores[1] >= t) matchWinner = 1;
  }

  if (matchWinner >= 0) {
    battle.phase = 'gameover';
    addLog(battle, '🏆 ' + battle.names[matchWinner] + ' WINS!', '#fa0');
    battle.players.forEach(pid => { const c = clients.get(pid); if (c) c.status = 'idle'; });
    broadcastStreamers();
  }

  // Determine clash video key
  const clashKey = c0 + '-' + c1;
  const clashVideo = CLASH_VIDEOS[clashKey] || null;

  // Send clash_info to both players — they prep the video then send clash_ready
  battle.phase = matchWinner >= 0 ? 'gameover' : 'revealing';
  battle.clashInfo = {
    choices: [...battle.choices],
    winner, reason, dmg,
    scores: [...battle.scores],
    hp: [...battle.hp],
    matchWinner,
    matchWinnerName: matchWinner >= 0 ? battle.names[matchWinner] : null,
    log: battle.log.slice(-10),
    round: battle.round,
    clashVideo, // filename or null for elemental
  };
  battle.clashReady = new Set();

  notifyPlayers(battle, { type: 'clash_info', ...battle.clashInfo });

  // Spectators get the result immediately (no clash sync needed)
  for (const [, c] of clients) {
    if (c.battleId === battle.id && c.isSpectator) {
      send(c.ws, { type: 'watch_round_result', round: battle.round, choices: battle.choices, winner, reason, scores: battle.scores, hp: battle.hp, dmg, matchWinner, matchWinnerName: battle.clashInfo.matchWinnerName });
    }
  }

  // Safety net: if a client never sends clash_ready, play after 5s anyway
  battle.clashReadyTimeout = setTimeout(() => {
    console.log('[clash] safety net fired for battle ' + battle.id);
    sendClashPlay(battle);
  }, 5000);
}

function sendClashPlay(battle) {
  if (battle.clashReadyTimeout) { clearTimeout(battle.clashReadyTimeout); battle.clashReadyTimeout = null; }
  notifyPlayers(battle, { type: 'clash_play' });

  // After animation, advance round (or end match)
  if (battle.phase === 'revealing') {
    battle.clashDoneTimeout = setTimeout(() => advanceRound(battle), 20000);
  }
}

function advanceRound(battle) {
  if (battle.phase !== 'revealing') return;
  if (battle.clashDoneTimeout) { clearTimeout(battle.clashDoneTimeout); battle.clashDoneTimeout = null; }
  battle.phase = 'picking';
  battle.choices = [null, null];
  battle.locked = [false, false];
  battle.round++;
  battle.players.forEach((pid, seat) => {
    // The 2 new cards dealt this round must not duplicate each other,
    // but repeating a card the player already holds from a prior round is fine.
    const newCards = [...ELEMENTS].sort(() => Math.random() - .5).slice(0, 2);
    battle.hands[seat].push(...newCards);
    send(clients.get(pid)?.ws, { type: 'new_round', round: battle.round, hand: battle.hands[seat], scores: battle.scores, hp: battle.hp });
  });
  notifyAll(battle, { type: 'round_start', round: battle.round, scores: battle.scores, hp: battle.hp });
}

wss.on('connection', (ws) => {
  const id = nextId++;
  clients.set(id, { ws, name: null, role: null, status: 'idle', battleId: null, videosReady: false });
  send(ws, { type: 'connected', id, gifts: GIFTS });

  // Heartbeat: keep the connection alive through any idle-timeout enforced by
  // GoDaddy's hosting infrastructure or intermediary proxies. Without regular
  // traffic, idle WebSocket connections get silently dropped after some
  // threshold — this affected players who sat too long before picking a card.
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const client = clients.get(id); if (!client) return;

    if (msg.type === 'login') {
      client.name = msg.name.slice(0, 20);
      client.role = msg.role;
      client.status = 'idle';

      // Check if this name matches a player who recently disconnected from an
      // active battle — if so, reconnect them to it instead of starting fresh.
      let rejoinBattle = null, rejoinSeat = -1;
      for (const [bid, b] of battles) {
        if (b.phase !== 'gameover' && b.disconnectedSeat !== undefined && b.disconnectedSeat !== null) {
          if (b.names[b.disconnectedSeat] === client.name) {
            rejoinBattle = b; rejoinSeat = b.disconnectedSeat;
            break;
          }
        }
      }

      if (rejoinBattle) {
        if (rejoinBattle.disconnectGraceTimeout) { clearTimeout(rejoinBattle.disconnectGraceTimeout); rejoinBattle.disconnectGraceTimeout = null; }
        rejoinBattle.disconnectedSeat = null;
        rejoinBattle.players[rejoinSeat] = id;
        client.battleId = rejoinBattle.id;
        client.status = 'battling';
        send(ws, { type: 'login_ok', id, name: client.name, role: client.role });
        send(ws, {
          type: 'battle_rejoin', battleId: rejoinBattle.id, seat: rejoinSeat,
          names: rejoinBattle.names,
          opponentName: rejoinBattle.names[1 - rejoinSeat], opponentId: rejoinBattle.players[1 - rejoinSeat],
          hand: rejoinBattle.hands[rejoinSeat], phase: rejoinBattle.phase,
          scores: rejoinBattle.scores, hp: rejoinBattle.hp, round: rejoinBattle.round,
          format: rejoinBattle.format, log: rejoinBattle.log.slice(-10),
        });
        notifyAll(rejoinBattle, { type: 'opponent_reconnected', name: client.name, seat: rejoinSeat });
        console.log('[rejoin] ' + client.name + ' reconnected to battle ' + rejoinBattle.id + ' seat ' + rejoinSeat);
      } else {
        send(ws, { type: 'login_ok', id, name: client.name, role: client.role });
      }
      broadcastStreamers();
    }

    else if (msg.type === 'videos_ready') {
      // Client has preloaded all videos — mark as ready
      client.videosReady = true;
      console.log('[videos_ready] client ' + id + ' is ready');
    }

    else if (msg.type === 'app_ping') {
      // Application-level heartbeat — some proxies only count actual message
      // frames as "activity," not low-level WebSocket protocol pings. Echo
      // back so the client knows the round-trip succeeded.
      send(ws, { type: 'app_pong' });
    }

    else if (msg.type === 'challenge') {
      const t = clients.get(msg.targetId);
      if (!t || t.role !== 'streamer' || t.status !== 'idle') { send(ws, { type: 'error', msg: 'Player unavailable' }); return; }
      client.status = 'challenging';
      client.pendingConfig = msg.config || { mode: 'wins', value: 5 };
      send(t.ws, { type: 'challenge_received', fromId: id, fromName: client.name, config: client.pendingConfig });
      send(ws, { type: 'challenge_sent', toId: msg.targetId, toName: t.name });
    }

    else if (msg.type === 'challenge_response' || msg.type === 'challenge_accept') {
      if (msg.accepted !== false) {
        const chal = clients.get(msg.fromId); if (!chal) return;
        const battleId = 'b' + Date.now();
        const startHands = [dealHand(), dealHand()];
        const pendingConfig = chal.pendingConfig || { mode: 'wins', value: 5 };
        const battle = { id: battleId, players: [msg.fromId, id], names: [chal.name, client.name], phase: 'setup', format: pendingConfig, scores: [0, 0], hp: [100, 100], choices: [null, null], locked: [false, false], hands: startHands, lastCards: [null, null], effects: { burn: [false, false], freeze: [false, false] }, log: [], round: 0, elementalGifts: [0, 0] };
        battles.set(battleId, battle);
        [msg.fromId, id].forEach((pid, seat) => {
          const c = clients.get(pid); if (c) { c.battleId = battleId; c.status = 'battling'; }
          send(clients.get(pid)?.ws, { type: 'battle_start', battleId, seat, opponentName: battle.names[1 - seat], opponentId: battle.players[1 - seat], hand: battle.hands[seat], phase: 'setup', isInitiator: seat === 0, config: pendingConfig });
        });
        broadcast({ type: 'battle_created', battleId, names: battle.names });
        broadcastStreamers();
      } else {
        const chal = clients.get(msg.fromId); if (chal) { chal.status = 'idle'; send(chal.ws, { type: 'challenge_declined', byName: client.name }); }
      }
    }

    else if (msg.type === 'challenge_decline') {
      const chal = clients.get(msg.fromId); if (chal) { chal.status = 'idle'; send(chal.ws, { type: 'challenge_declined', byName: client.name }); }
    }

    else if (msg.type === 'battle_setup') {
      const battle = battles.get(client.battleId); if (!battle || battle.phase !== 'setup') return;
      // Use format from challenge config (already stored); seat 0 may override
      if (msg.format) battle.format = msg.format;
      if (battle.format?.type === 'hp') battle.hp = [battle.format.value, battle.format.value];
      battle.phase = 'picking'; battle.round = 1;
      notifyAll(battle, { type: 'battle_setup_done', format: battle.format, round: 1, hp: battle.hp, scores: [0, 0] });
    }

    else if (msg.type === 'webrtc_offer' || msg.type === 'webrtc_answer' || msg.type === 'webrtc_ice') {
      const t = clients.get(msg.targetId); if (t) send(t.ws, { ...msg, fromId: id });
    }

    else if (msg.type === 'join_battle') {
      const battle = battles.get(msg.battleId); if (!battle) return;
      client.battleId = msg.battleId;
      send(ws, { type: 'battle_state', battleId: battle.id, names: battle.names, phase: battle.phase, scores: battle.scores, hp: battle.hp, round: battle.round, format: battle.format, log: battle.log.slice(-10) });
      notifyPlayers(battle, { type: 'spectator_joined', spectatorId: id, name: client.name });
    }

    else if (msg.type === 'spectator_watch') {
      const target = clients.get(msg.targetId); if (!target || !target.battleId) { send(ws, { type: 'error', msg: 'Player not in a battle' }); return; }
      const battle = battles.get(target.battleId); if (!battle) return;
      let specCount = 0;
      for (const [, c] of clients) if (c.battleId === battle.id && c.isSpectator) specCount++;
      if (specCount >= 40) { send(ws, { type: 'error', msg: 'Stream is full' }); return; }
      client.battleId = battle.id;
      client.isSpectator = true;
      send(ws, { type: 'watch_ready', battleId: battle.id, names: battle.names, scores: battle.scores, hp: battle.hp });
      battle.players.forEach((pid, seat) => {
        const p = clients.get(pid);
        if (p) send(p.ws, { type: 'spectator_watch_request', spectatorId: id, seat });
      });
    }

    else if (msg.type === 'spectator_offer') {
      const spectator = clients.get(msg.spectatorId);
      if (spectator) send(spectator.ws, { type: 'watch_offer', sdp: msg.sdp, fromId: id, seat: msg.seat });
    }
    else if (msg.type === 'spectator_answer') {
      const streamer = clients.get(msg.targetId);
      if (streamer) send(streamer.ws, { type: 'spectator_answer_received', sdp: msg.sdp, spectatorId: id, seat: msg.seat });
    }
    else if (msg.type === 'spectator_ice') {
      const target = clients.get(msg.targetId);
      if (target) send(target.ws, { type: 'spectator_ice_received', candidate: msg.candidate, fromId: id, seat: msg.seat });
    }

    else if (msg.type === 'play_card') {
      const battle = battles.get(client.battleId);
      if (!battle) {
        console.warn('[play_card] no battle found for client', id, 'battleId=', client.battleId);
        send(ws, { type: 'clash_error', code: 'SERVER_E2', detail: 'no battle found' });
        return;
      }
      if (battle.phase !== 'picking') {
        console.warn('[play_card] wrong phase, battle=' + battle.id + ' phase=' + battle.phase + ' client=' + id);
        send(ws, { type: 'clash_error', code: 'SERVER_E3', detail: 'wrong phase: ' + battle.phase });
        return;
      }
      const seat = battle.players.indexOf(id);
      if (seat === -1) {
        console.warn('[play_card] client', id, 'not a player in battle', battle.id);
        send(ws, { type: 'clash_error', code: 'SERVER_E4', detail: 'not a player in this battle' });
        return;
      }
      if (battle.locked[seat]) {
        console.warn('[play_card] seat', seat, 'already locked in battle', battle.id);
        send(ws, { type: 'clash_error', code: 'SERVER_E5', detail: 'already locked this round' });
        return;
      }
      let card = msg.card;
      if (battle.effects.freeze[seat]) {
        battle.effects.freeze[seat] = false;
        const basics = ['rock', 'paper', 'scissors'];
        card = basics[Math.floor(Math.random() * 3)];
        send(ws, { type: 'frozen', forcedCard: card });
        addLog(battle, '❄️ ' + battle.names[seat] + ' was frozen! Random card played.', '#8cf');
      }
      const idx = battle.hands[seat].indexOf(card);
      if (idx !== -1) battle.hands[seat].splice(idx, 1);
      battle.choices[seat] = card; battle.locked[seat] = true;
      console.log('[play_card] battle=' + battle.id + ' seat=' + seat + ' card=' + card + ' locked=' + JSON.stringify(battle.locked));
      notifyAll(battle, { type: 'player_locked', seat, name: battle.names[seat] });

      if (battle.locked[0] && battle.locked[1]) {
        battle.phase = 'revealing';
        try {
          resolveRound(battle);
        } catch (err) {
          console.error('[resolveRound] threw:', err);
          // Tell clients something broke instead of leaving them frozen
          notifyPlayers(battle, { type: 'clash_error', code: 'SERVER_E1', detail: String(err && err.message || err) });
          // Force the round to advance anyway so the game doesn't permanently stall
          battle.phase = 'picking';
        }
      }
    }

    else if (msg.type === 'clash_ready') {
      // Client has prepped the video and is ready to play
      const battle = battles.get(client.battleId);
      if (!battle || !battle.clashReady) return;
      battle.clashReady.add(id);
      console.log('[clash_ready] battle=' + battle.id + ' ready=' + battle.clashReady.size + '/' + battle.players.length);
      if (battle.clashReady.size >= battle.players.length) {
        sendClashPlay(battle);
      }
    }

    else if (msg.type === 'clash_done') {
      // Client finished playing the animation — advance to next round
      const battle = battles.get(client.battleId);
      if (!battle || battle.phase !== 'revealing') return;
      battle.clashDone = battle.clashDone || new Set();
      battle.clashDone.add(id);
      if (battle.clashDone.size >= battle.players.length) {
        if (battle.clashDoneTimeout) { clearTimeout(battle.clashDoneTimeout); battle.clashDoneTimeout = null; }
        advanceRound(battle);
      }
    }

    else if (msg.type === 'gift') {
      const gift = GIFTS[msg.giftId]; if (!gift) return;
      let battle = msg.battleId ? battles.get(msg.battleId) : null;
      if (!battle) for (const [, b] of battles) { if (b.phase !== 'gameover') { battle = b; break; } }
      if (!battle) return;
      const targetSeat = msg.targetSeat, viewerName = msg.viewerName || client.name || 'Fan';
      addLog(battle, `🎁 ${viewerName} → ${battle.names[targetSeat]}: ${gift.icon}${gift.label}`, gift.color);
      if (gift.type === 'instant') {
        const opp = 1 - targetSeat;
        if (gift.effect === 'burn') battle.effects.burn[opp] = true;
        else if (gift.effect === 'freeze') battle.effects.freeze[opp] = true;
        notifyAll(battle, { type: 'gift_effect', effect: gift.effect, targetSeat, gift, viewerName });
      } else {
        const isElemental = Object.keys(BEATS).includes(gift.card);
        if (isElemental) {
          if (!battle.elementalGifts) battle.elementalGifts = [0, 0];
          if (battle.elementalGifts[targetSeat] >= 2) {
            send(clients.get(battle.players[targetSeat])?.ws, { type: 'gift_blocked', reason: 'Elemental gift limit reached (max 2 per game)', gift, viewerName });
            return;
          }
          battle.elementalGifts[targetSeat]++;
        }
        battle.hands[targetSeat].push(gift.card);
        send(clients.get(battle.players[targetSeat])?.ws, { type: 'gift_card', card: gift.card, gift, viewerName });
        notifyAll(battle, { type: 'gift_announce', gift, viewerName, targetSeat, targetName: battle.names[targetSeat] });
      }
    }

    else if (msg.type === 'rematch') {
      const battle = battles.get(client.battleId); if (!battle || battle.phase !== 'gameover') return;
      const rmHands = [dealHand(), dealHand()];
      Object.assign(battle, { phase: 'picking', scores: [0, 0], hp: [100, 100], choices: [null, null], locked: [false, false], hands: rmHands, lastCards: [null, null], effects: { burn: [false, false], freeze: [false, false] }, log: [], round: 1, format: battle.format, elementalGifts: [0, 0] });
      battle.players.forEach((pid, seat) => {
        const c = clients.get(pid); if (c) c.status = 'battling';
        send(clients.get(pid)?.ws, { type: 'rematch_start', hand: battle.hands[seat] });
      });
    }
  });

  ws.on('close', () => {
    const c = clients.get(id); if (!c) return;
    if (c.battleId) {
      const battle = battles.get(c.battleId);
      if (battle && battle.phase !== 'gameover' && battle.players.includes(id)) {
        const seat = battle.players.indexOf(id);
        // Grace period: don't end the battle immediately. Give the player
        // a window to reconnect (flaky cellular, brief drop) before declaring
        // them gone. The disconnected seat is marked so play_card etc. fail
        // gracefully in the meantime rather than the battle just vanishing.
        battle.disconnectedSeat = seat;
        notifyAll(battle, { type: 'opponent_disconnected', name: c.name, seat });
        battle.disconnectGraceTimeout = setTimeout(() => {
          // Still gone after grace period — now actually end it
          const stillBattle = battles.get(c.battleId);
          if (stillBattle && stillBattle.disconnectedSeat === seat && stillBattle.phase !== 'gameover') {
            stillBattle.phase = 'gameover';
            notifyAll(stillBattle, { type: 'opponent_left', name: c.name });
          }
        }, 25000); // 25s grace period to reconnect
      }
    }
    clients.delete(id);
    broadcast({ type: 'user_left', id });
    broadcastStreamers();
  });
});

// Ping every connected client every 25s. Most idle-timeout thresholds on
// hosting infra (load balancers, reverse proxies) are 30-60s of silence —
// this keeps well under that. If a client doesn't respond to a ping with a
// pong before the next interval, it's genuinely gone and we terminate it
// (which triggers the normal close handler / grace-period reconnect logic).
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(heartbeatInterval));

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════╗\n║  STREAM BATTLE Server            ║\n║  Port: ${PORT}                      ║\n╚══════════════════════════════════╝\n`);
});
