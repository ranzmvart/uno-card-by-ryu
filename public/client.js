const socket = io({ transports: ['websocket', 'polling'] });
const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const el = {
  loader:$('loader'), miniProfile:$('miniProfile'), logoutBtn:$('logoutBtn'), toastStack:$('toastStack'),
  loginName:$('loginName'), loginPin:$('loginPin'), loginBtn:$('loginBtn'), regName:$('regName'), regPin:$('regPin'), regBtn:$('regBtn'),
  roomList:$('roomList'), refreshRoomsBtn:$('refreshRoomsBtn'), joinCode:$('joinCode'), joinPass:$('joinPass'), joinManualBtn:$('joinManualBtn'), roomName:$('roomName'), roomPass:$('roomPass'), createRoomBtn:$('createRoomBtn'),
  roomCodeText:$('roomCodeText'), roomNameText:$('roomNameText'), connectionBadge:$('connectionBadge'), copyRoomBtn:$('copyRoomBtn'), leaveRoomBtn:$('leaveRoomBtn'), lobbyPanel:$('lobbyPanel'), lobbyPlayers:$('lobbyPlayers'), startGameBtn:$('startGameBtn'),
  boardPanel:$('boardPanel'), statusText:$('statusText'), turnAdvice:$('turnAdvice'), turnTimer:$('turnTimer'), deckCount:$('deckCount'), discardCard:$('discardCard'), currentColor:$('currentColor'), drawBtn:$('drawBtn'), passBtn:$('passBtn'), unoBtn:$('unoBtn'), restartBtn:$('restartBtn'), backLobbyBtn:$('backLobbyBtn'), playersList:$('playersList'), logList:$('logList'), chatList:$('chatList'), chatInput:$('chatInput'), sendChatBtn:$('sendChatBtn'), powerList:$('powerList'), handCards:$('handCards'), handHint:$('handHint'), myNameText:$('myNameText'),
  colorModal:$('colorModal'), cancelColorBtn:$('cancelColorBtn'), profilePage:$('profilePage'), shopList:$('shopList'), shopPoints:$('shopPoints'), inventoryList:$('inventoryList'), crateList:$('crateList'), crateAnimation:$('crateAnimation'), crateRail:$('crateRail'), crateReward:$('crateReward'), friendSearch:$('friendSearch'), friendSearchBtn:$('friendSearchBtn'), friendResults:$('friendResults'), friendsPanel:$('friendsPanel'), leaderboardList:$('leaderboardList'), refreshLeaderboardBtn:$('refreshLeaderboardBtn'),
  musicFab:$('musicFab'), musicPanel:$('musicPanel'), musicClose:$('musicClose'), musicListenHost:$('musicListenHost'), musicPrivateMode:$('musicPrivateMode'), musicModeHint:$('musicModeHint'), musicVolume:$('musicVolume'), musicVolumeText:$('musicVolumeText'), musicSearch:$('musicSearch'), musicSearchBtn:$('musicSearchBtn'), musicResults:$('musicResults'), musicActivate:$('musicActivate'), musicPauseRoom:$('musicPauseRoom'), musicStopRoom:$('musicStopRoom'), musicNow:$('musicNow'), ytPlayer:$('ytPlayer'),
  joinVoiceBtn:$('joinVoiceBtn'), leaveVoiceBtn:$('leaveVoiceBtn'), voiceList:$('voiceList'), cinematic:$('cinematic'), cineIcon:$('cineIcon'), cineTitle:$('cineTitle'), cineText:$('cineText')
};

let auth = load('uno_auth', null);
let profile = null;
let state = null, prevState = null;
let shop = [], crates = [];
let pendingWildCardId = null;
let timerInterval = null;
let ytPlayer = null;
let ytReady = false;
let localStream = null;
const peers = new Map();
let voiceActive = false;
let currentMusic = null;
let currentYtVideoId = null;
let currentYtOwner = null;
let lastRoomMusicKey = '';
let musicMode = load('uno_music_mode','host');
let musicVolume = Number(load('uno_music_volume',70));
let draggingMusic = false;
let dragOffset = { x:0, y:0 };

window.onYouTubeIframeAPIReady = () => { ytReady = true; };

setTimeout(() => el.loader.classList.add('hidden'), 600);
init();
function init(){
  bindNavigation(); bindAuth(); bindRooms(); bindGame(); bindShop(); bindCrates(); bindFriends(); bindMusic(); bindVoice(); bindTabs();
  setAuthUI(false);
  if(auth) resumeAuth(); else refreshLeaderboard();
  refreshRooms();
}

socket.on('connect',()=>{ setConnection(true); if(auth) resumeAuth(true); const s=load('uno_room',null); if(s?.roomCode&&auth&&!state){ reconnectRoom(s.roomCode,false); }});
socket.on('disconnect',()=>setConnection(false));
socket.on('toast',({message,type})=>toast(message,type));
socket.on('state',(newState)=>{ prevState=state; state=newState; if(state?.code) save('uno_room',{roomCode:state.code}); showPage('game'); renderGame(); announce(); updateMusicModeUI(); if(state.music) receiveRoomMusic(state.music); });
socket.on('rooms:list',({rooms})=>renderRoomList(rooms||[]));
socket.on('music:room-state',(music)=>receiveRoomMusic(music));
socket.on('voice:list',({participants})=>renderVoiceList(participants||[]));
socket.on('voice:peer-left',({playerId})=>closePeer(playerId));
socket.on('voice:signal',async({fromPlayerId,data})=>handleVoiceSignal(fromPlayerId,data));

function bindNavigation(){
  $$('[data-page]').forEach(btn=>btn.addEventListener('click',()=>showPage(btn.dataset.page)));
  el.logoutBtn.addEventListener('click',()=>{ localStorage.removeItem('uno_auth'); localStorage.removeItem('uno_room'); auth=null; profile=null; state=null; setAuthUI(false); showPage('home'); toast('Logout berhasil.'); });
}
function showPage(name){
  $$('.page').forEach(p=>p.classList.remove('active'));
  const page=$(`page-${name}`);
  if(page) page.classList.add('active');
  $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.page===name));
  document.body.dataset.page = name;
  document.body.classList.toggle('in-room', name==='game' && !!state?.code);
  document.body.classList.toggle('game-lobby', name==='game' && state?.status==='lobby');
  document.body.classList.toggle('game-playing', name==='game' && state?.status!=='lobby');
  if(name==='rooms') refreshRooms();
  if(name==='leaderboard') refreshLeaderboard();
  if(name==='profile') renderProfile();
  if(name==='shop') renderShop();
  if(name==='inventory') renderInventory();
  if(name==='crates') renderCrates();
  if(name==='friends') renderFriends();
}
function setAuthUI(ok){ document.body.classList.toggle('is-auth',!!ok); if(ok&&profile){ el.miniProfile.classList.remove('hidden'); el.miniProfile.innerHTML=`${avatarHTML(profile,'avatar')}<div><b>${esc(profile.displayName)}</b><br><span>${fmtPoints(profile.points)} pts</span></div>`; } else { el.miniProfile.classList.add('hidden'); } }
function bindAuth(){
  el.loginBtn.addEventListener('click',()=>socket.emit('auth:login',{username:el.loginName.value,pin:el.loginPin.value},handleAuth));
  el.regBtn.addEventListener('click',()=>socket.emit('auth:register',{username:el.regName.value,pin:el.regPin.value},handleAuth));
}
function handleAuth(res){ if(!res?.ok) return toast(res?.error||'Gagal login','error'); auth=res.auth; profile=res.profile; save('uno_auth',auth); setAuthUI(true); toast('Login berhasil','success'); loadShopData(); showPage('rooms'); renderProfile(); }
function resumeAuth(silent=false){ socket.emit('auth:resume',{auth},(res)=>{ if(!res?.ok){ if(!silent) toast('Session login habis. Login ulang.','error'); localStorage.removeItem('uno_auth'); auth=null; setAuthUI(false); showPage('auth'); return; } profile=res.profile; setAuthUI(true); loadShopData(); renderProfile(); renderInventory(); }); }
function authPayload(){ return { auth }; }

function bindRooms(){
  el.refreshRoomsBtn.addEventListener('click',refreshRooms);
  el.createRoomBtn.addEventListener('click',()=>{ if(!auth) return showPage('auth'); socket.emit('createRoom',{...authPayload(),name:el.roomName.value,password:el.roomPass.value},(res)=>{ if(!res?.ok)return toast(res?.error,'error'); save('uno_room',{roomCode:res.roomCode}); toast('Room dibuat','success'); showPage('game'); }); });
  el.joinManualBtn.addEventListener('click',()=>joinRoom(el.joinCode.value,el.joinPass.value));
}
function refreshRooms(){ socket.emit('rooms:list',{},(res)=>renderRoomList(res?.rooms||[])); }
function renderRoomList(rooms){ el.roomList.innerHTML = rooms.length ? rooms.map(r=>`<div class="room-card"><h3>${esc(r.name)}</h3><p class="hint">Kode ${r.code} • ${r.players}/${r.maxPlayers} pemain • Host ${esc(r.host)} ${r.locked?'• 🔒':''}</p><button class="btn primary full" data-join-room="${r.code}" data-locked="${r.locked}">Join Room</button></div>`).join('') : `<div class="panel glass">Belum ada room aktif. Buat room baru dulu.</div>`; $$('[data-join-room]').forEach(b=>b.addEventListener('click',()=>{ const pass=b.dataset.locked==='true'?prompt('Password room?')||'':''; joinRoom(b.dataset.joinRoom,pass); })); }
function joinRoom(code,pass='',inviteId=''){ if(!auth) return showPage('auth'); socket.emit('joinRoom',{...authPayload(),roomCode:code,password:pass,inviteId},(res)=>{ if(!res?.ok)return toast(res?.error,'error'); save('uno_room',{roomCode:res.roomCode}); showPage('game'); toast('Masuk room','success'); }); }
function reconnectRoom(code,showError=true){ socket.emit('reconnectRoom',{...authPayload(),roomCode:code},(res)=>{ if(!res?.ok&&showError) toast(res.error,'error'); if(res?.ok) showPage('game'); }); }

function bindGame(){
  el.copyRoomBtn.addEventListener('click',()=>navigator.clipboard?.writeText(state?.code||''));
  el.leaveRoomBtn.addEventListener('click',()=>{ socket.emit('leaveRoom',{...authPayload(),roomCode:state?.code},()=>{ state=null; localStorage.removeItem('uno_room'); document.body.classList.remove('in-room','game-lobby','game-playing'); showPage('rooms'); refreshRooms(); }); });
  el.startGameBtn.addEventListener('click',()=>socket.emit('startGame',{...authPayload(),roomCode:state?.code},cbToast));
  el.drawBtn.addEventListener('click',()=>socket.emit('drawCard',{...authPayload(),roomCode:state?.code},(res)=>{ if(!res?.ok){ animateNoCards(false); return toast(res?.error||'Gagal ambil kartu','error'); } }));
  el.passBtn.addEventListener('click',()=>socket.emit('passTurn',{...authPayload(),roomCode:state?.code},cbToast));
  el.unoBtn.addEventListener('click',()=>socket.emit('sayUno',{...authPayload(),roomCode:state?.code},cbToast));
  el.restartBtn.addEventListener('click',()=>socket.emit('restartGame',{...authPayload(),roomCode:state?.code},cbToast));
  el.backLobbyBtn.addEventListener('click',()=>socket.emit('backToLobby',{...authPayload(),roomCode:state?.code},cbToast));
  el.sendChatBtn.addEventListener('click',sendChat); el.chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendChat()});
  el.cancelColorBtn.addEventListener('click',closeColorModal); $$('#colorModal [data-color]').forEach(btn=>btn.addEventListener('click',()=>{ if(!pendingWildCardId)return; socket.emit('playCard',{...authPayload(),roomCode:state?.code,cardId:pendingWildCardId,chosenColor:btn.dataset.color},cbToast); closeColorModal(); }));
}
function cbToast(res){ if(!res?.ok) toast(res?.error||'Gagal','error'); }
function sendChat(){ const text=el.chatInput.value.trim(); if(!text)return; el.chatInput.value=''; socket.emit('sendChat',{...authPayload(),roomCode:state?.code,text},cbToast); }
function bindTabs(){ $$('[data-game-tab]').forEach(b=>b.addEventListener('click',()=>{ $$('[data-game-tab]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); $$('.tab-panel').forEach(p=>p.classList.remove('active')); $(`tab-${b.dataset.gameTab}`).classList.add('active'); })); }
function renderGame(){ if(!state)return; const me=state.me||{}; const isLobby=state.status==='lobby'; const isPlaying=state.status==='playing'; const isFinished=state.status==='finished'; const isHost=me.isHost; const turn=state.players.find(p=>p.id===state.currentPlayerId); const winner=state.players.find(p=>p.accountId===state.winnerAccountId); const myTurn=isPlaying&&state.currentPlayerId===me.id;
  document.body.classList.add('in-room');
  document.body.classList.toggle('game-lobby', isLobby);
  document.body.classList.toggle('game-playing', !isLobby);
  el.roomCodeText.textContent=state.code; el.roomNameText.textContent=state.name||''; el.lobbyPanel.style.display=isLobby?'block':'none'; el.boardPanel.style.display=isLobby?'none':'grid'; el.startGameBtn.disabled=!isHost||state.players.length<2; el.restartBtn.style.display=isFinished&&isHost?'inline-flex':'none'; el.backLobbyBtn.style.display=isFinished&&isHost?'inline-flex':'none';
  el.drawBtn.disabled=!(myTurn&&!state.myTurnState?.hasDrawn); el.passBtn.disabled=!(myTurn&&state.myTurnState?.hasDrawn&&state.myTurnState?.drawnCardPlayable); el.unoBtn.disabled=!(isPlaying&&me.hand?.length===1);
  if(isLobby){ el.statusText.textContent='Lobby'; el.turnAdvice.textContent='Host memulai game saat pemain siap.'; el.handHint.textContent='Kartu dibagikan setelah game dimulai.'; }
  else if(isFinished){ el.statusText.textContent=winner?`${winner.name} menang!`:'Game selesai'; el.turnAdvice.textContent=state.autoResetAt?'Room akan reset otomatis.':'Tunggu host.'; el.handHint.textContent='Ronde selesai.'; }
  else if(myTurn){ el.statusText.textContent='Giliran Kamu'; el.turnAdvice.textContent=state.myTurnState?.hasDrawn?'Mainkan kartu baru atau Pass.':'Pilih kartu menyala atau ambil kartu.'; el.handHint.textContent='Kartu playable akan menyala.'; }
  else { el.statusText.textContent=`Giliran ${turn?.name||'pemain lain'}`; el.turnAdvice.textContent='Tunggu giliranmu.'; el.handHint.textContent='Siapkan strategi.'; }
  el.deckCount.textContent=`Deck: ${state.deckCount}`; el.currentColor.textContent=`Warna aktif: ${colorName(state.currentColor)}`; renderCard(el.discardCard,state.discardTop,true); renderLobbyPlayers(); renderPlayers(); renderLogs(); renderChat(); renderPowerList(); renderHand(); setupTimer(); updateMusicModeUI(); if(state.music) receiveRoomMusic(state.music);
}
function renderLobbyPlayers(){ el.lobbyPlayers.innerHTML=(state.players||[]).map(p=>`<div class="player-card"><div class="player-main">${avatarHTML(p,'avatar')}<div><div class="player-name">${esc(p.name)}</div><div class="player-meta">${p.isHost?'Host':'Player'} • ${p.connected?'Online':'Offline'} • ${p.cardCount||0} kartu</div></div></div></div>`).join(''); }
function renderPlayers(){ el.playersList.innerHTML=(state.players||[]).map(p=>{ const challenge=canChallenge(p)?`<button data-challenge="${p.id}" class="btn warning small">Challenge UNO</button>`:''; return `<div class="player-card ${p.id===state.currentPlayerId?'turn-player':''} ${p.id===state.me?.id?'me-player':''}"><div class="player-main">${avatarHTML(p,'avatar')}<div><div class="player-name">${esc(p.name)}</div><div class="player-meta">${p.isHost?'Host':'Player'} • ${p.cardCount} kartu • ${p.connected?'Online':'Offline'} ${p.saidUno?'• UNO':''}</div></div></div>${challenge}</div>`}).join(''); $$('[data-challenge]').forEach(b=>b.addEventListener('click',()=>socket.emit('challengeUno',{...authPayload(),roomCode:state.code,targetId:b.dataset.challenge},cbToast))); }
function renderLogs(){ el.logList.innerHTML=(state.logs||[]).map(l=>`<div class="log-item">${esc(l.text)}</div>`).join('')||'<div class="log-item">Belum ada log.</div>'; }
function renderChat(){ el.chatList.innerHTML=(state.chat||[]).map(c=>`<div class="chat-item"><b>${esc(c.name)}</b><br>${esc(c.text)}</div>`).join('')||'<div class="chat-item">Belum ada chat.</div>'; el.chatList.scrollTop=el.chatList.scrollHeight; }
function renderPowerList(){ const powers=profile?.inventory?.powers||{}; const powerIds=['power_draw_shield','power_double_points','power_uno_guard']; el.powerList.innerHTML=powerIds.map(id=>{ const item=shop.find(i=>i.id===id)||{name:id,desc:''}; const qty=powers[id]||0; return `<div class="item-card"><h3>${esc(item.name)} <span class="pill">x${qty}</span></h3><p class="hint">${esc(item.desc)}</p><button class="btn secondary full" data-use-power="${id}" ${qty<1?'disabled':''}>Aktifkan</button></div>`; }).join(''); $$('[data-use-power]').forEach(b=>b.addEventListener('click',()=>socket.emit('usePower',{...authPayload(),roomCode:state.code,powerId:b.dataset.usePower},(res)=>{ if(!res?.ok)return toast(res.error,'error'); profile=res.profile; toast('Power aktif','success'); renderPowerList(); }))); }
function renderHand(){
  const hand=state.me?.hand||[];
  const myTurn=state?.status==='playing'&&state.currentPlayerId===state.me?.id;
  el.myNameText.textContent=state.me?.name||'Player';
  if(!hand.length){
    el.handCards.innerHTML='<div class="empty-hand-card"><b>Tidak ada kartu</b><span>Tunggu kartu dibagikan atau ronde baru dimulai.</span></div>';
    return;
  }
  el.handCards.innerHTML='';
  let playableCount=0;
  hand.forEach((card,i)=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='game-card hand-card';
    btn.style.setProperty('--i',i);
    renderCard(btn,card);
    const playable=isPlayableClient(card);
    if(playable) playableCount++;
    btn.classList.toggle('playable',playable);
    btn.classList.toggle('disabled',!playable);
    btn.disabled=!playable;
    btn.addEventListener('click',()=>playCard(card));
    el.handCards.appendChild(btn);
  });
  if(myTurn && playableCount===0 && !state.myTurnState?.hasDrawn){
    const notice=document.createElement('div');
    notice.className='no-playable-banner';
    notice.innerHTML='<b>Tidak ada kartu cocok</b><span>Tekan Ambil Kartu untuk lanjut.</span>';
    el.handCards.prepend(notice);
    animateNoCards(false);
  }
}
function playCard(card){
  if(!isPlayableClient(card)){ animateNoCards(true); return; }
  if(card.color==='wild'||card.type==='wild'||card.type==='wild4'){ pendingWildCardId=card.id; el.colorModal.classList.remove('hidden'); return; }
  socket.emit('playCard',{...authPayload(),roomCode:state.code,cardId:card.id},cbToast);
}
function closeColorModal(){ pendingWildCardId=null; el.colorModal.classList.add('hidden'); }
function renderCard(target,card,big=false){ target.className=`game-card ${big?'big-card':''}`; if(!card){target.classList.add('empty-card');target.innerHTML='?';return;} target.classList.add(`card-${card.color}`,'asset-card'); if(card.color==='wild')target.classList.add('card-wild'); const text=cardText(card), asset=cardAssetPath(card); target.innerHTML=`<img class="card-img" src="${asset}" alt="${esc(text)}" draggable="false" onerror="this.remove()"><span class="fallback-corner top">${esc(text)}</span><span class="fallback-value">${esc(text)}</span><span class="fallback-corner bottom">${esc(text)}</span>`; }
function cardAssetPath(card){ const base='/assets/cards/'; if(card.type==='wild')return base+'Wild.jpg'; if(card.type==='wild4')return base+'Wild_Draw_4.jpg'; const m={red:'Red',yellow:'Yellow',green:'Green',blue:'Blue'}; const c=m[card.color]||'Red'; if(card.type==='number')return `${base}${c}_${card.value}.jpg`; if(card.type==='draw2')return `${base}${c}_Draw_2.jpg`; if(card.type==='skip')return `${base}${c}_Skip.jpg`; if(card.type==='reverse')return `${base}${card.color==='red'?'RED':c}_Reverse.jpg`; return base+'Wild.jpg'; }
function cardText(card){ if(card.type==='number')return String(card.value); if(card.type==='skip')return 'SKIP'; if(card.type==='reverse')return 'REV'; if(card.type==='draw2')return '+2'; if(card.type==='wild')return 'WILD'; if(card.type==='wild4')return '+4'; return '?'; }
function isPlayableClient(card){ if(!state||state.status!=='playing'||state.currentPlayerId!==state.me?.id)return false; if(state.myTurnState?.hasDrawn)return state.myTurnState.drawnCardPlayable&&state.myTurnState.drawnCardId===card.id; const top=state.discardTop; if(!top)return true; if(card.color==='wild'||card.type==='wild'||card.type==='wild4')return true; if(state.currentColor&&card.color===state.currentColor)return true; if(card.type===top.type&&card.type!=='number')return true; if(card.type==='number'&&top.type==='number'&&card.value===top.value)return true; return false; }
function canChallenge(p){ return state?.status==='playing'&&state.me?.id&&p.id!==state.me.id&&p.cardCount===1&&!p.saidUno; }
function setupTimer(){ if(timerInterval)clearInterval(timerInterval); const tick=()=>{ const at=state?.status==='finished'?state.autoResetAt:state?.turnEndsAt; if(!at){el.turnTimer.textContent='--';return;} const left=Math.max(0,Math.ceil((at-Date.now())/1000)); el.turnTimer.textContent=`${left}s`; }; tick(); timerInterval=setInterval(tick,500); }
function announce(){
  if(!state?.me)return;
  if(prevState?.discardTop?.id && state.discardTop?.id && prevState.discardTop.id!==state.discardTop.id && state.status==='playing'){
    animateCardToDiscard(state.discardTop);
  }
  if(prevState?.currentPlayerId!==state.currentPlayerId&&state.currentPlayerId===state.me.id&&state.status==='playing'){ toast('Giliran kamu!','turn'); cine('🎴','Giliran Kamu','Pilih kartu atau ambil dari deck.'); }
  if(!prevState?.winnerAccountId&&state.winnerAccountId){ const winner=state.players.find(p=>p.accountId===state.winnerAccountId); cine('🏆','Ronde Selesai',`${winner?.name||'Pemain'} menang!`); }
}

function animateCardToDiscard(card){
  if(!card || !el.discardCard) return;
  const end=el.discardCard.getBoundingClientRect();
  const hand=el.handCards?.getBoundingClientRect?.();
  const startX=hand ? Math.min(innerWidth-48, Math.max(48, hand.left+hand.width/2)) : innerWidth/2;
  const startY=hand ? Math.min(innerHeight-80, hand.top+Math.min(hand.height,120)/2) : innerHeight-80;
  const ghost=document.createElement('div');
  renderCard(ghost,card,true);
  ghost.classList.add('play-card-ghost');
  ghost.style.left=startX+'px';
  ghost.style.top=startY+'px';
  document.body.appendChild(ghost);
  requestAnimationFrame(()=>{
    ghost.style.left=(end.left+end.width/2)+'px';
    ghost.style.top=(end.top+end.height/2)+'px';
    ghost.classList.add('fly-in');
  });
  setTimeout(()=>ghost.remove(),900);
}
function animateNoCards(forceToast=false){
  if(forceToast) toast('Kartu ini belum bisa dimainkan. Ambil kartu atau tunggu giliran.','error');
  el.handCards?.classList.add('no-card-bounce');
  setTimeout(()=>el.handCards?.classList.remove('no-card-bounce'),650);
}

function loadShopData(){ fetch('/api/shop').then(r=>r.json()).then(d=>{shop=d.shop||[];crates=d.crates||[];renderShop();renderCrates();renderInventory();}); }
function bindShop(){ }
function renderShop(){ if(!profile)return; el.shopPoints.textContent=`${fmtPoints(profile.points)} pts`; el.shopList.innerHTML=(shop||[]).map(item=>{ const owned=profile.inventory.cosmetics.includes(item.id); const qty=profile.inventory.powers[item.id]||0; return `<div class="item-card rarity-${item.rarity}"><span class="pill">${item.rarity}</span><h3>${esc(item.name)}</h3><p class="hint">${esc(item.desc)}</p><p><b>${fmtPoints(item.price)} pts</b> ${item.type==='power'?`• Stok ${qty}`:owned?'• Owned':''}</p><button class="btn primary full" data-buy="${item.id}" ${owned&&item.type!=='power'?'disabled':''}>${item.type==='power'?'Beli Power':'Beli'}</button></div>`; }).join(''); $$('[data-buy]').forEach(b=>b.addEventListener('click',()=>socket.emit('shop:buy',{auth,itemId:b.dataset.buy},(res)=>{ if(!res?.ok)return toast(res.error,'error'); profile=res.profile; toast(`${res.item.name} masuk inventory`,'success'); renderShop();renderInventory(); }))); }
function renderInventory(){ if(!profile)return; const owned=profile.inventory.cosmetics||[]; const powers=profile.inventory.powers||{}; const cards=[...owned.map(id=>shop.find(i=>i.id===id)||{id,name:id,type:id==='rookie'?'badge':id==='none'?'frame':'tableTheme',rarity:'Common',desc:''}),...Object.entries(powers).filter(([,q])=>q>0).map(([id,q])=>({...shop.find(i=>i.id===id),qty:q}))]; el.inventoryList.innerHTML=cards.map(item=>`<div class="item-card rarity-${item.rarity||'Common'}"><span class="pill">${item.rarity||'Common'}</span><h3>${esc(item.name||item.id)} ${item.qty?`x${item.qty}`:''}</h3><p class="hint">${esc(item.desc||'Item bawaan.')}</p>${item.type&&item.type!=='power'?`<button class="btn secondary full" data-equip="${item.id}">Equip</button>`:''}</div>`).join('')||'<div class="panel glass">Inventory kosong.</div>'; $$('[data-equip]').forEach(b=>b.addEventListener('click',()=>socket.emit('inventory:equip',{auth,itemId:b.dataset.equip},(res)=>{ if(!res?.ok)return toast(res.error,'error'); profile=res.profile; toast('Item dipakai','success'); renderInventory();setAuthUI(true); }))); }
function renderCrates(){ el.crateList.innerHTML=(crates||[]).map(c=>`<div class="crate-card"><span class="pill">Gacha</span><h3>${esc(c.name)}</h3><p class="hint">Odds: ${Object.entries(c.odds).map(([r,w])=>`${r} ${w}%`).join(' • ')}</p><p><b>${fmtPoints(c.price)} pts</b></p><button class="btn primary full" data-open-crate="${c.id}">Open Crate</button></div>`).join(''); $$('[data-open-crate]').forEach(b=>b.addEventListener('click',()=>openCrate(b.dataset.openCrate))); }
function bindCrates(){}
function openCrate(crateId){ socket.emit('crate:open',{auth,crateId},(res)=>{ if(!res?.ok)return toast(res.error,'error'); animateCrate(res.rewards,res.reward,()=>{ profile=res.profile; toast('Reward masuk ke inventory','success'); renderCrates();renderInventory();setAuthUI(true); }); }); }
function animateCrate(rewards,reward,done){ el.crateAnimation.classList.remove('hidden'); el.crateReward.innerHTML=''; el.crateRail.style.transition='none'; el.crateRail.style.transform='translateX(0)'; el.crateRail.innerHTML=(rewards||[]).concat([reward]).map(r=>`<div class="crate-tile rarity-${r.rarity}"><b>${r.rarity}</b><small>${esc(r.kind==='points'?`${r.points} pts`:r.item.name)}</small></div>`).join(''); setTimeout(()=>{el.crateRail.style.transition='transform 4s cubic-bezier(.11,.82,.18,1)'; el.crateRail.style.transform='translateX(-760px)';},50); setTimeout(()=>{ el.crateReward.innerHTML=`<h2>${reward.rarity} Reward</h2><p>${esc(reward.kind==='points'?`${reward.points} Points`:reward.item.name)}</p><button class="btn primary" id="closeCrate">Ambil</button>`; $('closeCrate').onclick=()=>{el.crateAnimation.classList.add('hidden'); done?.();}; },4300); }

function renderProfile(){ if(!profile){ el.profilePage.innerHTML='<div class="panel glass">Login dulu.</div>'; return; } const s=profile.stats; el.profilePage.innerHTML=`<div class="profile-card glass"><div class="center">${avatarHTML(profile,'avatar big')}<h2>${esc(profile.displayName)}</h2><p class="pill">${fmtPoints(profile.points)} pts</p></div><input id="profileDisplayName" value="${esc(profile.displayName)}" placeholder="Display name"><input id="profileAvatar" type="file" accept="image/*"><button id="saveProfileBtn" class="btn primary full">Simpan Profil</button></div><div class="profile-stats"><div class="profile-stat"><b>${s.games}</b><span>Game</span></div><div class="profile-stat"><b>${s.wins}</b><span>Win</span></div><div class="profile-stat"><b>${s.losses}</b><span>Lose</span></div><div class="profile-stat"><b>${s.bestStreak}</b><span>Best Streak</span></div><div class="profile-stat"><b>${s.cardsPlayed}</b><span>Kartu Dimainkan</span></div><div class="profile-stat"><b>${s.unoCalls}</b><span>UNO Call</span></div></div>`; $('saveProfileBtn').onclick=saveProfile; }
async function saveProfile(){ const file=$('profileAvatar').files?.[0]; let avatarData; if(file) avatarData=await fileToDataUrl(file); socket.emit('profile:update',{auth,displayName:$('profileDisplayName').value,avatarData},(res)=>{ if(!res?.ok)return toast(res.error,'error'); profile=res.profile; setAuthUI(true); renderProfile(); toast('Profil disimpan','success'); }); }

function bindFriends(){ el.friendSearchBtn.addEventListener('click',()=>socket.emit('friends:search',{auth,query:el.friendSearch.value},(res)=>{ if(!res?.ok)return toast(res.error,'error'); el.friendResults.innerHTML=res.results.map(p=>`<div class="player-card"><div class="player-main">${avatarHTML(p,'avatar')}<b>${esc(p.displayName)}</b></div><button data-add-friend="${p.username}" class="btn secondary small">Add</button></div>`).join(''); $$('[data-add-friend]').forEach(b=>b.onclick=()=>socket.emit('friends:add',{auth,username:b.dataset.addFriend},(r)=>{ if(!r?.ok)return toast(r.error,'error'); profile=r.profile; toast('Request terkirim'); renderFriends(); })); })); }
function renderFriends(){ if(!profile)return; const idToName=id=>{ const p=profileIndex[id]||{}; return p.displayName||id.slice(0,6); }; const invites=profile.invites||[], requests=profile.requestsIn||[], friends=profile.friends||[]; el.friendsPanel.innerHTML=`<h3>Invite Room</h3>${invites.map(i=>`<div class="player-card"><div><b>${esc(i.fromName)}</b><div class="hint">Invite ke ${esc(i.roomName)} (${i.roomCode})</div></div><button class="btn primary small" data-join-invite="${i.roomCode}" data-invite-id="${i.id}">Join</button></div>`).join('')||'<p class="hint">Belum ada invite.</p>'}<h3>Request</h3>${requests.map(id=>`<div class="player-card"><span>${esc(id.slice(0,8))}</span><button data-accept="${id}" class="btn secondary small">Accept</button></div>`).join('')||'<p class="hint">Tidak ada request.</p>'}<h3>Teman</h3>${friends.map(id=>`<div class="player-card"><span>${esc(idToName(id))}</span>${state?.code?`<button data-invite-friend="${id}" class="btn primary small">Invite</button>`:''}</div>`).join('')||'<p class="hint">Belum ada teman.</p>'}`; $$('[data-accept]').forEach(b=>b.onclick=()=>socket.emit('friends:accept',{auth,accountId:b.dataset.accept},res=>{if(!res?.ok)return toast(res.error,'error'); profile=res.profile; renderFriends();})); $$('[data-invite-friend]').forEach(b=>b.onclick=()=>socket.emit('friends:invite',{auth,friendId:b.dataset.inviteFriend,roomCode:state.code},res=>toast(res?.ok?'Invite terkirim':res.error,res?.ok?'success':'error'))); $$('[data-join-invite]').forEach(b=>b.onclick=()=>joinRoom(b.dataset.joinInvite,'',b.dataset.inviteId)); }
const profileIndex={};
function refreshLeaderboard(){ socket.emit('leaderboard:get',{},(res)=>{ const list=res?.leaderboard||[]; list.forEach(p=>profileIndex[p.id]=p); el.leaderboardList.innerHTML=list.map((p,i)=>`<div class="leader-row"><b>#${i+1}</b><div class="player-main">${avatarHTML(p,'avatar')}<span>${esc(p.displayName)}</span></div><span>${p.stats.wins} win</span><span>${fmtPoints(p.points)} pts</span></div>`).join('')||'<div class="panel glass">Belum ada data.</div>'; }); }
el.refreshLeaderboardBtn.addEventListener('click',refreshLeaderboard);

function bindMusic(){
  updateMusicModeUI();
  setMusicVolume(musicVolume, false);
  el.musicFab.addEventListener('click',()=>el.musicPanel.classList.toggle('hidden'));
  el.musicClose.addEventListener('click',()=>el.musicPanel.classList.add('hidden'));
  el.musicSearchBtn.addEventListener('click',searchMusic);
  el.musicSearch.addEventListener('keydown',e=>{if(e.key==='Enter')searchMusic()});
  el.musicActivate.addEventListener('click',()=>{ try{ ytPlayer?.setVolume?.(musicVolume); ytPlayer?.playVideo?.(); toast('Audio diaktifkan','success'); }catch{} });
  el.musicPauseRoom.addEventListener('click',()=>socket.emit('music:room-pause',{...authPayload(),roomCode:state?.code,positionSec:getYtTime()},cbToast));
  el.musicStopRoom.addEventListener('click',()=>socket.emit('music:room-stop',{...authPayload(),roomCode:state?.code},cbToast));
  el.musicListenHost.addEventListener('click',()=>{ musicMode='host'; save('uno_music_mode',musicMode); updateMusicModeUI(); if(currentMusic) receiveRoomMusic(currentMusic,true); });
  el.musicPrivateMode.addEventListener('click',()=>{ musicMode='private'; save('uno_music_mode',musicMode); updateMusicModeUI(); toast('Mode streaming sendiri aktif. Musik host tidak akan mengganggu lagu kamu.','success'); });
  el.musicVolume.addEventListener('input',()=>setMusicVolume(Number(el.musicVolume.value),true));
  makeDraggable(el.musicFab);
}
async function searchMusic(){
  const q=el.musicSearch.value.trim(); if(!q)return;
  el.musicResults.innerHTML='<p class="hint">Mencari...</p>';
  const res=await fetch('/api/music/youtube?q='+encodeURIComponent(q)).then(r=>r.json()).catch(()=>({ok:false,error:'Gagal search'}));
  if(!res.ok)return el.musicResults.innerHTML=`<p class="hint">${esc(res.error)}</p>`;
  const isHost=!!state?.me?.isHost;
  el.musicResults.innerHTML=res.results.map(s=>{
    const data=esc(JSON.stringify(s));
    return `<div class="music-item"><img src="${esc(s.thumbnail)}" alt="cover"><div><b>${esc(s.title)}</b><br><span class="hint">${esc(s.artist)} • ${esc(s.duration)}</span></div><div class="music-item-actions"><button class="btn secondary small" data-private-song='${data}'>Play</button>${isHost?`<button class="btn primary small" data-room-song='${data}'>Room</button>`:''}</div></div>`;
  }).join('')||'<p class="hint">Tidak ada hasil.</p>';
  $$('[data-private-song]').forEach(b=>b.onclick=()=>{ const song=JSON.parse(b.dataset.privateSong); playPrivateSong(song); });
  $$('[data-room-song]').forEach(b=>b.onclick=()=>{ const song=JSON.parse(b.dataset.roomSong); playRoomSong(song); });
}
function playPrivateSong(song){
  musicMode='private'; save('uno_music_mode',musicMode); updateMusicModeUI();
  currentMusic = currentMusic || null;
  playYoutube(song,0,'private',true);
  el.musicNow.textContent=`Streaming sendiri: ${song.title}`;
  toast('Lagu pribadi diputar','success');
}
function playRoomSong(song){ if(!state?.me?.isHost)return toast('Hanya host yang bisa play ke room','error'); socket.emit('music:room-play',{...authPayload(),roomCode:state.code,song,positionSec:0},(res)=>{ if(!res?.ok)return toast(res.error,'error'); musicMode='host'; save('uno_music_mode',musicMode); updateMusicModeUI(); toast('Musik room diputar','success'); }); }
function receiveRoomMusic(music, force=false){
  currentMusic=music;
  const key=music?.song?`${music.status}:${music.song.videoId}:${music.startedAt||0}:${music.updatedAt||0}:${Math.floor(Number(music.positionSec||0))}`:'empty';
  const hasRoom=!!state?.code;
  if(!music?.song){
    if(currentYtOwner==='room'&&ytPlayer) ytPlayer.stopVideo();
    if(musicMode==='host') el.musicNow.textContent='Belum ada musik room.';
    lastRoomMusicKey=key;
    return;
  }
  if(hasRoom && musicMode==='private'){
    el.musicNow.textContent=`Mode pribadi aktif. Musik host tersedia: ${music.song.title}`;
    return;
  }
  el.musicNow.textContent=`Room ${music.status}: ${music.song.title} — ${music.by||'Host'}`;
  if(!force && key===lastRoomMusicKey && currentYtOwner==='room') return;
  lastRoomMusicKey=key;
  if(music.status==='playing') syncRoomYoutube(music);
  else if(music.status==='paused'){
    if(currentYtOwner!=='room'||currentYtVideoId!==music.song.videoId) playYoutube(music.song,music.positionSec||0,'room',false);
    setTimeout(()=>{ try{ ytPlayer?.seekTo?.(Number(music.positionSec||0),true); ytPlayer?.pauseVideo?.(); }catch{} },250);
  } else if(music.status==='stopped'&&currentYtOwner==='room'&&ytPlayer) ytPlayer.stopVideo();
}
function syncRoomYoutube(music){
  const pos=calcMusicPos(music);
  if(currentYtOwner==='room' && currentYtVideoId===music.song.videoId && ytPlayer){
    const actual=getYtTime();
    if(Math.abs(actual-pos)>5) { try{ ytPlayer.seekTo(pos,true); }catch{} }
    try{ ytPlayer.setVolume(musicVolume); ytPlayer.playVideo(); }catch{}
    return;
  }
  playYoutube(music.song,pos,'room',true);
}
function calcMusicPos(music){ if(music.status!=='playing')return music.positionSec||0; return Math.max(0,Number(music.positionSec||0)+(Date.now()-Number(music.startedAt||Date.now()))/1000); }
function playYoutube(song,start=0,owner='private',autoplay=true){
  if(!ytReady||!song?.videoId){setTimeout(()=>playYoutube(song,start,owner,autoplay),500);return;}
  currentYtVideoId=song.videoId; currentYtOwner=owner;
  const startAt=Math.max(0,Math.floor(start||0));
  if(!ytPlayer){
    ytPlayer=new YT.Player('ytPlayer',{height:'1',width:'1',videoId:song.videoId,playerVars:{autoplay:autoplay?1:0,playsinline:1,start:startAt,origin:location.origin},events:{onReady:e=>{ try{e.target.setVolume(musicVolume); if(autoplay)e.target.playVideo();}catch{} }}});
  } else {
    try{ ytPlayer.setVolume(musicVolume); }catch{}
    if(ytPlayer.getVideoData?.().video_id===song.videoId){ try{ ytPlayer.seekTo(startAt,true); if(autoplay)ytPlayer.playVideo(); }catch{} }
    else ytPlayer.loadVideoById({videoId:song.videoId,startSeconds:startAt});
  }
}
function setMusicVolume(v,persist=true){
  musicVolume=Math.max(0,Math.min(100,Number(v)||0));
  if(el.musicVolume) el.musicVolume.value=musicVolume;
  if(el.musicVolumeText) el.musicVolumeText.textContent=`${musicVolume}%`;
  if(persist) save('uno_music_volume',musicVolume);
  try{ ytPlayer?.setVolume?.(musicVolume); }catch{}
}
function updateMusicModeUI(){
  const inRoom=!!state?.code;
  el.musicListenHost?.classList.toggle('primary',musicMode==='host');
  el.musicListenHost?.classList.toggle('secondary',musicMode!=='host');
  el.musicPrivateMode?.classList.toggle('primary',musicMode==='private');
  el.musicPrivateMode?.classList.toggle('ghost',musicMode!=='private');
  if(el.musicModeHint) el.musicModeHint.textContent = inRoom ? (musicMode==='host' ? 'Kamu mendengar musik host. Volume tetap bisa kamu atur sendiri.' : 'Streaming sendiri aktif. Kamu tidak mendengar musik host.') : 'Belum masuk room: semua user bebas play lagu sendiri.';
  if(el.musicPauseRoom) el.musicPauseRoom.style.display=state?.me?.isHost?'inline-flex':'none';
  if(el.musicStopRoom) el.musicStopRoom.style.display=state?.me?.isHost?'inline-flex':'none';
}
function getYtTime(){ try{return ytPlayer?.getCurrentTime?.()||0}catch{return 0} }
function makeDraggable(node){ node.addEventListener('pointerdown',e=>{ if(e.button!==0)return; draggingMusic=true; dragOffset={x:e.clientX-node.offsetLeft,y:e.clientY-node.offsetTop};node.setPointerCapture(e.pointerId); node.classList.add('dragging'); }); node.addEventListener('pointermove',e=>{ if(!draggingMusic)return; node.style.left=Math.max(8,Math.min(innerWidth-66,e.clientX-dragOffset.x))+'px'; node.style.top=Math.max(8,Math.min(innerHeight-66,e.clientY-dragOffset.y))+'px'; node.style.right='auto'; node.style.bottom='auto'; }); node.addEventListener('pointerup',()=>{draggingMusic=false; node.classList.remove('dragging');}); node.addEventListener('pointercancel',()=>{draggingMusic=false; node.classList.remove('dragging');}); }

function bindVoice(){ el.joinVoiceBtn.addEventListener('click',joinVoice); el.leaveVoiceBtn.addEventListener('click',leaveVoice); }
async function joinVoice(){ if(!state?.code)return toast('Masuk room dulu','error'); try{ localStream=await navigator.mediaDevices.getUserMedia({audio:true}); voiceActive=true; socket.emit('voice:join',{...authPayload(),roomCode:state.code},async(res)=>{ if(!res?.ok)return toast(res.error,'error'); for(const peer of res.peers||[]) await createOffer(peer.playerId); }); toast('Voice aktif','success'); }catch(e){toast('Voice gagal: '+e.message,'error')} }
function leaveVoice(){ voiceActive=false; for(const id of [...peers.keys()])closePeer(id); localStream?.getTracks().forEach(t=>t.stop()); localStream=null; socket.emit('voice:leave',{...authPayload(),roomCode:state?.code}); }
function renderVoiceList(list){ el.voiceList.innerHTML=list.map(p=>`<span class="voice-pill">● ${esc(p.name)}${p.playerId===state?.me?.id?' (Kamu)':''}</span>`).join('')||'<span class="hint">Voice kosong</span>'; if(voiceActive){ for(const p of list){ if(p.playerId!==state?.me?.id&&!peers.has(p.playerId)) createOffer(p.playerId); } } }
async function getPeer(id){ if(peers.has(id))return peers.get(id); const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]}); peers.set(id,pc); localStream?.getTracks().forEach(t=>pc.addTrack(t,localStream)); pc.onicecandidate=e=>{ if(e.candidate)socket.emit('voice:signal',{roomCode:state.code,toPlayerId:id,data:{candidate:e.candidate}}); }; pc.ontrack=e=>{ let a=document.querySelector(`audio[data-peer="${id}"]`); if(!a){a=document.createElement('audio');a.autoplay=true;a.dataset.peer=id;document.body.appendChild(a)} a.srcObject=e.streams[0]; }; return pc; }
async function createOffer(id){ const pc=await getPeer(id); const offer=await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('voice:signal',{roomCode:state.code,toPlayerId:id,data:{sdp:pc.localDescription}}); }
async function handleVoiceSignal(from,data){ if(!from||!voiceActive)return; const pc=await getPeer(from); if(data.sdp){ await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); if(data.sdp.type==='offer'){ const ans=await pc.createAnswer(); await pc.setLocalDescription(ans); socket.emit('voice:signal',{roomCode:state.code,toPlayerId:from,data:{sdp:pc.localDescription}}); } } if(data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(()=>{}); }
function closePeer(id){ const pc=peers.get(id); if(pc)pc.close(); peers.delete(id); document.querySelector(`audio[data-peer="${id}"]`)?.remove(); }

function setConnection(ok){ el.connectionBadge.textContent=ok?'Online':'Offline'; el.connectionBadge.className=`badge ${ok?'ok':'bad'}`; }
function toast(msg,type='info'){ if(!msg)return; const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=msg;el.toastStack.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(20px)';setTimeout(()=>t.remove(),250)},3500); }
function cine(icon,title,text){ el.cineIcon.textContent=icon; el.cineTitle.textContent=title; el.cineText.textContent=text; el.cinematic.classList.remove('hidden'); setTimeout(()=>el.cinematic.classList.add('hidden'),1800); }
function save(k,v){localStorage.setItem(k,JSON.stringify(v))} function load(k,d){try{return JSON.parse(localStorage.getItem(k)||'null')??d}catch{return d}}
function esc(s){return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')} function fmtPoints(n){return Number(n||0).toLocaleString('id-ID')}
function avatarHTML(p,cls='avatar'){ const src=p?.avatarData; return src?`<img class="${cls}" src="${src}" alt="avatar">`:`<div class="${cls}">${(p?.displayName||p?.name||p?.username||'P').slice(0,1).toUpperCase()}</div>`; }
function fileToDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
function colorName(c){return({red:'Merah',yellow:'Kuning',green:'Hijau',blue:'Biru',wild:'Bebas'})[c]||'-'}
