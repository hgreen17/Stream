/**
 * STREAM BATTLE — Server
 * Serves HTML files over HTTPS AND handles WSS on the same port 3000
 * npm install ws
 * node server.js
 */
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
};

// HTTPS server — serves static files AND upgrades to WSS
const server = https.createServer(sslOptions, (req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'app.html' : req.url);
  // strip query strings
  filePath = filePath.split('?')[0];
  const ext = path.extname(filePath);
  const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.pem':'text/plain' }[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const PORT = 3000;

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
  fire_blast:  { label:'Fire Blast',  icon:'🔥', color:'#f60', type:'instant', desc:"Burns opponent's next card", effect:'burn' },
  ice_freeze:  { label:'Ice Freeze',  icon:'❄️',  color:'#8cf', type:'instant', desc:'Freezes opponent — skips their pick', effect:'freeze' },
  lightning:   { label:'Lightning',   icon:'⚡',  color:'#ff0', type:'instant', desc:'Deals 15 bonus damage this round', effect:'lightning' },
  bomb:        { label:'Bomb',        icon:'💣', color:'#f40', type:'card',    desc:'Beats all basic cards', card:'bomb' },
  mirror:      { label:'Mirror',      icon:'🪞', color:'#aef', type:'card',    desc:"Copies opponent's last card", card:'mirror' },
  shield_gift: { label:'Shield',      icon:'🛡️', color:'#08f', type:'card',    desc:'Blocks all damage this round', card:'shield' },
  heal_gift:   { label:'Heal',        icon:'💚', color:'#0f4', type:'card',    desc:'Restores 20 HP', card:'heal' },
};

function getStreamers() {
  const list = [];
  for (const [id, c] of clients) if (c.role === 'streamer') list.push({ id, name: c.name, status: c.status });
  return list;
}
function broadcastStreamers() { broadcast({ type: 'streamer_list', streamers: getStreamers() }); }

const BASICS = ['rock','paper','scissors'];
const ELEMENTALS = ['fire_rock','fire_paper','fire_scissors','ice_rock','ice_paper','ice_scissors','lightning_rock','lightning_paper','lightning_scissors'];

function dealHand() {
  // Plain RPS only — 5 cards
  const hand = [];
  for (let i=0;i<5;i++) hand.push(BASICS[Math.floor(Math.random()*3)]);
  return hand;
}

function randomElemental() {
  return ELEMENTALS[Math.floor(Math.random()*ELEMENTALS.length)];
}

function getBase(card) {
  if (card.includes('rock')) return 'rock';
  if (card.includes('paper')) return 'paper';
  if (card.includes('scissors')) return 'scissors';
  return card;
}
function getElement(card) {
  if (card.startsWith('fire_')) return 'fire';
  if (card.startsWith('ice_')) return 'ice';
  if (card.startsWith('lightning_')) return 'lightning';
  return 'none';
}
function cardName(card) { return card.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }
function addLog(battle, msg, color) {
  battle.log.push({ msg, color:color||'#0ff' });
  if (battle.log.length > 60) battle.log.shift();
}
function notifyPlayers(battle, data) {
  battle.players.forEach(pid => { const c=clients.get(pid); if(c) send(c.ws,data); });
}
function notifySpectators(battle, data) {
  for (const [id,c] of clients) if (c.battleId===battle.id && !battle.players.includes(id)) send(c.ws,data);
}
function notifyAll(battle, data) { notifyPlayers(battle,data); notifySpectators(battle,data); }

function resolveRound(battle) {
  const [c0,c1] = battle.choices;
  const b0=getBase(c0), b1=getBase(c1);
  const e0=getElement(c0), e1=getElement(c1);
  let winner=-1, reason='', dmg=[0,0], baseDmg=20;

  if (c0==='bomb'||c1==='bomb'||c0==='shield'||c1==='shield'||c0==='heal'||c1==='heal'||c0==='mirror'||c1==='mirror') {
    if (c0==='bomb'&&c1==='bomb') { winner=-1; reason='💣 Both played Bomb — draw!'; dmg=[10,10]; }
    else if (c0==='bomb') { winner=0; dmg=[0,40]; reason='💣 Bomb obliterates '+c1+'!'; }
    else if (c1==='bomb') { winner=1; dmg=[40,0]; reason='💣 Bomb obliterates '+c0+'!'; }
    else if (c0==='shield') { winner=-1; dmg=[0,0]; reason='🛡️ '+battle.names[0]+' blocked everything!'; }
    else if (c1==='shield') { winner=-1; dmg=[0,0]; reason='🛡️ '+battle.names[1]+' blocked everything!'; }
    else if (c0==='heal') { battle.hp[0]=Math.min(battle.format?.value||100,battle.hp[0]+20); winner=1; dmg=[0,baseDmg]; reason='💚 '+battle.names[0]+' healed 20 HP!'; }
    else if (c1==='heal') { battle.hp[1]=Math.min(battle.format?.value||100,battle.hp[1]+20); winner=0; dmg=[baseDmg,0]; reason='💚 '+battle.names[1]+' healed 20 HP!'; }
    else if (c0==='mirror') { const mc=battle.lastCards[1]||'rock'; battle.choices[0]=mc; resolveRound({...battle,choices:[mc,c1]}); return; }
    else if (c1==='mirror') { const mc=battle.lastCards[0]||'rock'; battle.choices[1]=mc; resolveRound({...battle,choices:[c0,mc]}); return; }
  } else {
    // Elemental triangle: fire>ice>lightning>fire
    function elBeats(a,b) {
      return (a==='fire'&&b==='ice')||(a==='ice'&&b==='lightning')||(a==='lightning'&&b==='fire');
    }
    const rpsBeats = (a,b) => (a==='rock'&&b==='scissors')||(a==='scissors'&&b==='paper')||(a==='paper'&&b==='rock');
    const plain0 = e0==='none', plain1 = e1==='none';

    if (plain0 && plain1) {
      // Both plain — standard RPS
      if (b0===b1) { winner=-1; reason='Draw! Both played '+cardName(c0); }
      else if (rpsBeats(b0,b1)) { winner=0; reason=cardName(c0)+' beats '+cardName(c1)+'!'; }
      else { winner=1; reason=cardName(c1)+' beats '+cardName(c0)+'!'; }
    } else if (!plain0 && plain1) {
      // c0 is elemental, c1 is plain — elemental always wins
      winner=0; reason=cardName(c0)+' overpowers plain '+cardName(c1)+'! ✨';
    } else if (plain0 && !plain1) {
      // c1 is elemental, c0 is plain — elemental always wins
      winner=1; reason=cardName(c1)+' overpowers plain '+cardName(c0)+'! ✨';
    } else {
      // Both elemental
      if (b0===b1) {
        // Same base — elemental triangle decides
        if (e0===e1) { winner=-1; reason='Draw! Both played '+cardName(c0); }
        else if (elBeats(e0,e1)) { winner=0; reason=cardName(c0)+' overpowers '+cardName(c1)+'!'; }
        else { winner=1; reason=cardName(c1)+' overpowers '+cardName(c0)+'!'; }
      } else {
        // Different base — RPS decides first
        if (rpsBeats(b0,b1)) { winner=0; reason=cardName(c0)+' beats '+cardName(c1)+'!'; }
        else { winner=1; reason=cardName(c1)+' beats '+cardName(c0)+'!'; }
      }
    }

    if (winner!==-1) {
      const winEl=winner===0?e0:e1;
      if (winEl==='fire')      { baseDmg=28; reason+=' 🔥 Fire bonus!'; }
      if (winEl==='ice')       { baseDmg=22; battle.effects.freeze[1-winner]=true; reason+=' ❄️ Frozen!'; }
      if (winEl==='lightning') { baseDmg=25; reason+=' ⚡ Lightning!'; }
      dmg[1-winner]=baseDmg;
    }
  }

  if (battle.effects.lightning) { dmg[battle.effects.lightning.seat]+=15; delete battle.effects.lightning; }
  [0,1].forEach(s=>{ if(battle.effects.burn[s]){dmg[s]+=10; battle.effects.burn[s]=false; reason+=` 🔥 ${battle.names[s]} burned!`;} });

  if (battle.format?.type==='hp') {
    battle.hp[0]=Math.max(0,battle.hp[0]-dmg[0]);
    battle.hp[1]=Math.max(0,battle.hp[1]-dmg[1]);
  } else {
    if (winner===0) battle.scores[0]++;
    if (winner===1) battle.scores[1]++;
  }
  battle.lastCards=[...battle.choices];
  addLog(battle,reason,winner===-1?'#aaa':'#ff0');

  let matchWinner=-1;
  if (battle.format?.type==='hp') {
    if (battle.hp[0]<=0&&battle.hp[1]<=0) matchWinner=-1;
    else if (battle.hp[0]<=0) matchWinner=1;
    else if (battle.hp[1]<=0) matchWinner=0;
  } else {
    const t=battle.format?.value||5;
    if (battle.scores[0]>=t) matchWinner=0;
    else if (battle.scores[1]>=t) matchWinner=1;
  }

  const result = { type:'round_result', round:battle.round, choices:battle.choices, winner, reason, scores:battle.scores, hp:battle.hp, dmg, matchWinner, matchWinnerName:matchWinner>=0?battle.names[matchWinner]:null, log:battle.log.slice(-10) };

  if (matchWinner>=0) {
    battle.phase='gameover';
    addLog(battle,'🏆 '+battle.names[matchWinner]+' WINS!','#fa0');
    result.log=battle.log.slice(-10);
    battle.players.forEach(pid=>{ const c=clients.get(pid); if(c) c.status='idle'; });
    broadcastStreamers();
  }

  notifyAll(battle,result);
  // Send full round result to spectators
  for(const[,c]of clients) if(c.battleId===battle.id&&c.isSpectator) {
    send(c.ws,{type:'watch_round_result',round:battle.round,choices:battle.choices,winner,reason,scores:battle.scores,hp:battle.hp,dmg,matchWinner,matchWinnerName:matchWinner>=0?battle.names[matchWinner]:null});
  }

  if (matchWinner<0) {
    setTimeout(()=>{
      battle.phase='picking'; battle.choices=[null,null]; battle.locked=[false,false]; battle.round++;
      battle.players.forEach((pid,seat)=>{
        // Replenish with 2 plain cards only
        for (let i=0;i<2;i++) battle.hands[seat].push(BASICS[Math.floor(Math.random()*3)]);
        send(clients.get(pid)?.ws,{type:'new_round',round:battle.round,hand:battle.hands[seat],scores:battle.scores,hp:battle.hp});
      });
      notifyAll(battle,{type:'round_start',round:battle.round,scores:battle.scores,hp:battle.hp});
    },4500);
  }
}

wss.on('connection',(ws)=>{
  const id=nextId++;
  clients.set(id,{ws,name:null,role:null,status:'idle',battleId:null});
  send(ws,{type:'connected',id,gifts:GIFTS});

  ws.on('message',(raw)=>{
    let msg; try{msg=JSON.parse(raw);}catch{return;}
    const client=clients.get(id); if(!client) return;
    console.log('[msg] id='+id+' type='+msg.type+' battleId='+client.battleId);

    if (msg.type==='login') {
      client.name=msg.name.slice(0,20); client.role=msg.role; client.status='idle';
      send(ws,{type:'login_ok',id,name:client.name,role:client.role});
      broadcastStreamers();
    }
    else if (msg.type==='challenge') {
      const t=clients.get(msg.targetId);
      if (!t||t.role!=='streamer'||t.status!=='idle') { send(ws,{type:'error',msg:'Player unavailable'}); return; }
      client.status='challenging';
      send(t.ws,{type:'challenge_received',fromId:id,fromName:client.name,config:msg.config||{mode:'wins',value:5}});
      send(ws,{type:'challenge_sent',toId:msg.targetId,toName:t.name});
    }
    else if (msg.type==='challenge_response') {
      if (msg.accepted) {
        const chal=clients.get(msg.fromId); if(!chal) return;
        const battleId='b'+Date.now();
        const startHands = [dealHand(), dealHand()];
        // Each player gets exactly 1 random elemental at game start
        startHands[0].push(randomElemental());
        startHands[1].push(randomElemental());
        const battle={id:battleId,players:[msg.fromId,id],names:[chal.name,client.name],phase:'setup',format:null,scores:[0,0],hp:[100,100],choices:[null,null],locked:[false,false],hands:startHands,lastCards:[null,null],effects:{burn:[false,false],freeze:[false,false]},log:[],round:0,elementalGifts:[0,0]};
        battles.set(battleId,battle);
        [msg.fromId,id].forEach((pid,seat)=>{
          const c=clients.get(pid); if(c){c.battleId=battleId;c.status='battling';}
          send(clients.get(pid)?.ws,{type:'battle_start',battleId,seat,opponentName:battle.names[1-seat],opponentId:battle.players[1-seat],hand:battle.hands[seat],phase:'setup',isInitiator:seat===0});
        });
        broadcast({type:'battle_created',battleId,names:battle.names});
        broadcastStreamers();
      } else {
        const chal=clients.get(msg.fromId); if(chal){chal.status='idle'; send(chal.ws,{type:'challenge_declined',byName:client.name});}
      }
    }
    else if (msg.type==='challenge_accept') {
      const chal=clients.get(msg.fromId); if(!chal) return;
      const battleId='b'+Date.now();
      const startHands = [dealHand(), dealHand()];
        // Each player gets exactly 1 random elemental at game start
        startHands[0].push(randomElemental());
        startHands[1].push(randomElemental());
        const battle={id:battleId,players:[msg.fromId,id],names:[chal.name,client.name],phase:'setup',format:null,scores:[0,0],hp:[100,100],choices:[null,null],locked:[false,false],hands:startHands,lastCards:[null,null],effects:{burn:[false,false],freeze:[false,false]},log:[],round:0,elementalGifts:[0,0]};
      battles.set(battleId,battle);
      [msg.fromId,id].forEach((pid,seat)=>{
        const c=clients.get(pid); if(c){c.battleId=battleId;c.status='battling';}
        send(clients.get(pid)?.ws,{type:'battle_start',battleId,seat,opponentName:battle.names[1-seat],opponentId:battle.players[1-seat],hand:battle.hands[seat],phase:'setup',isInitiator:seat===0});
      });
      broadcast({type:'battle_created',battleId,names:battle.names});
      broadcastStreamers();
    }
    else if (msg.type==='challenge_decline') {
      const chal=clients.get(msg.fromId); if(chal){chal.status='idle'; send(chal.ws,{type:'challenge_declined',byName:client.name});}
    }
    else if (msg.type==='battle_setup') {
      console.log('[setup] battleId='+client.battleId+' phase='+(battles.get(client.battleId)?.phase)+' format='+JSON.stringify(msg.format));
      const battle=battles.get(client.battleId); if(!battle||battle.phase!=='setup') { console.log('[setup] REJECTED'); return; }
      battle.format=msg.format;
      if (msg.format.type==='hp') battle.hp=[msg.format.value,msg.format.value];
      battle.phase='picking'; battle.round=1;
      const p0 = clients.get(battle.players[0]);
      const p1 = clients.get(battle.players[1]);
      console.log('[setup_done] players='+JSON.stringify(battle.players)+' p0ready='+(p0?.ws.readyState)+' p1ready='+(p1?.ws.readyState));
      notifyAll(battle,{type:'battle_setup_done',format:battle.format,round:1,hp:battle.hp,scores:[0,0]});
    }
    else if (msg.type==='webrtc_offer'||msg.type==='webrtc_answer'||msg.type==='webrtc_ice') {
      const t=clients.get(msg.targetId); if(t) send(t.ws,{...msg,fromId:id});
    }
    else if (msg.type==='join_battle') {
      const battle=battles.get(msg.battleId); if(!battle) return;
      client.battleId=msg.battleId;
      send(ws,{type:'battle_state',battleId:battle.id,names:battle.names,phase:battle.phase,scores:battle.scores,hp:battle.hp,round:battle.round,format:battle.format,log:battle.log.slice(-10)});
      notifyPlayers(battle,{type:'spectator_joined',spectatorId:id,name:client.name});
    }
    else if (msg.type==='spectator_watch') {
      // Auto-accept — no player approval needed, max 40 spectators (20 per side)
      const target=clients.get(msg.targetId); if(!target||!target.battleId) { send(ws,{type:'error',msg:'Player not in a battle'}); return; }
      const battle=battles.get(target.battleId); if(!battle) return;
      let specCount=0;
      for(const[,c]of clients) if(c.battleId===battle.id&&c.isSpectator) specCount++;
      if(specCount>=40){ send(ws,{type:'error',msg:'Stream is full'}); return; }
      client.battleId=battle.id;
      client.isSpectator=true;
      send(ws,{type:'watch_ready',battleId:battle.id,names:battle.names,scores:battle.scores,hp:battle.hp});
      battle.players.forEach((pid,seat)=>{
        const p=clients.get(pid);
        if(p) send(p.ws,{type:'spectator_watch_request',spectatorId:id,seat});
      });
    }
    else if (msg.type==='spectator_offer') {
      const spectator=clients.get(msg.spectatorId);
      if(spectator) send(spectator.ws,{type:'watch_offer',sdp:msg.sdp,fromId:id,seat:msg.seat});
    }
    else if (msg.type==='spectator_answer') {
      const streamer=clients.get(msg.targetId);
      if(streamer) send(streamer.ws,{type:'spectator_answer_received',sdp:msg.sdp,spectatorId:id,seat:msg.seat});
    }
    else if (msg.type==='spectator_ice') {
      const target=clients.get(msg.targetId);
      if(target) send(target.ws,{type:'spectator_ice_received',candidate:msg.candidate,fromId:id,seat:msg.seat});
    }
    else if (msg.type==='play_card') {
      console.log('[play_card] battleId='+client.battleId+' phase='+(battles.get(client.battleId)?.phase)+' card='+msg.card);
      const battle=battles.get(client.battleId); if(!battle||battle.phase!=='picking') { console.log('[play_card] REJECTED phase='+(battles.get(client.battleId)?.phase)); return; }
      const seat=battle.players.indexOf(id); if(seat===-1||battle.locked[seat]) return;
      let card=msg.card;
      if (battle.effects.freeze[seat]) {
        battle.effects.freeze[seat]=false;
        const basics=['rock','paper','scissors'];
        card=basics[Math.floor(Math.random()*3)];
        send(ws,{type:'frozen',forcedCard:card});
        addLog(battle,'❄️ '+battle.names[seat]+' was frozen! Random card played.','#8cf');
      }
      const idx=battle.hands[seat].indexOf(card);
      if (idx!==-1) battle.hands[seat].splice(idx,1);
      battle.choices[seat]=card; battle.locked[seat]=true;
      notifyAll(battle,{type:'player_locked',seat,name:battle.names[seat]});
      // Notify spectators which card was played (reveal to them immediately)
      for(const[,c]of clients) if(c.battleId===battle.id&&c.isSpectator)
        send(c.ws,{type:'watch_card_played',seat,card});
      if (battle.locked[0]&&battle.locked[1]) { battle.phase='revealing'; setTimeout(()=>resolveRound(battle),800); }
    }
    else if (msg.type==='gift') {
      const gift=GIFTS[msg.giftId]; if(!gift) return;
      let battle=msg.battleId?battles.get(msg.battleId):null;
      if (!battle) for(const[,b]of battles){if(b.phase!=='gameover'){battle=b;break;}}
      if (!battle) return;
      const targetSeat=msg.targetSeat, viewerName=msg.viewerName||client.name||'Fan';
      addLog(battle,`🎁 ${viewerName} → ${battle.names[targetSeat]}: ${gift.icon}${gift.label}`,gift.color);
      if (gift.type==='instant') {
        const opp=1-targetSeat;
        if (gift.effect==='burn') battle.effects.burn[opp]=true;
        else if (gift.effect==='freeze') battle.effects.freeze[opp]=true;
        else if (gift.effect==='lightning') battle.effects.lightning={seat:opp,damage:15};
        notifyAll(battle,{type:'gift_effect',effect:gift.effect,targetSeat,gift,viewerName});
      } else {
        // Check if this is an elemental card gift — max 2 per player per game
        const isElemental = ELEMENTALS.includes(gift.card);
        if (isElemental) {
          if (!battle.elementalGifts) battle.elementalGifts=[0,0];
          if (battle.elementalGifts[targetSeat] >= 2) {
            // Already at limit — send notice but don't add card
            send(clients.get(battle.players[targetSeat])?.ws,{type:'gift_blocked',reason:'Elemental gift limit reached (max 2 per game)',gift,viewerName});
            return;
          }
          battle.elementalGifts[targetSeat]++;
        }
        battle.hands[targetSeat].push(gift.card);
        send(clients.get(battle.players[targetSeat])?.ws,{type:'gift_card',card:gift.card,gift,viewerName});
        notifyAll(battle,{type:'gift_announce',gift,viewerName,targetSeat,targetName:battle.names[targetSeat]});
      }
    }
    else if (msg.type==='rematch') {
      const battle=battles.get(client.battleId); if(!battle||battle.phase!=='gameover') return;
      const rmHands=[dealHand(),dealHand()];
      rmHands[0].push(randomElemental()); rmHands[1].push(randomElemental());
      Object.assign(battle,{phase:'picking',scores:[0,0],hp:[100,100],choices:[null,null],locked:[false,false],hands:rmHands,lastCards:[null,null],effects:{burn:[false,false],freeze:[false,false]},log:[],round:1,format:battle.format,elementalGifts:[0,0]});
      battle.players.forEach((pid,seat)=>{ const c=clients.get(pid); if(c) c.status='battling'; send(clients.get(pid)?.ws,{type:'rematch_start',hand:battle.hands[seat]}); });
    }
  });

  ws.on('close',()=>{
    const c=clients.get(id); if(!c) return;
    if (c.battleId) {
      const battle=battles.get(c.battleId);
      if (battle&&battle.phase!=='gameover'&&battle.players.includes(id)) {
        battle.phase='gameover';
        notifyAll(battle,{type:'opponent_left',name:c.name});
      }
    }
    clients.delete(id);
    broadcast({type:'user_left',id});
    broadcastStreamers();
  });
});

server.listen(PORT,()=>{
  console.log(`\n╔══════════════════════════════════╗\n║  STREAM BATTLE Server            ║\n║  https://localhost:${PORT}         ║\n║  wss://localhost:${PORT}  (same!)  ║\n╚══════════════════════════════════╝\n`);
});
