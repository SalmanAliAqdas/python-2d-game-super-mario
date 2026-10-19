import { World } from './world.js';
import { LEVELS } from './levels.js';
import { Input, CONTROL_KEYS, bindPointers } from './input.js';
import { Progress } from './progress.js';
const canvas = document.querySelector('#gameCanvas');
const ctx = canvas.getContext('2d');
const overlay = document.querySelector('#overlay');
const overlayKicker = document.querySelector('#overlayKicker');
const overlayTitle = document.querySelector('#overlayTitle');
const overlayText = document.querySelector('#overlayText');
const primaryButton = document.querySelector('#primaryButton');
const secondaryButton = document.querySelector('#secondaryButton');
const bestScore = document.querySelector('#bestScore');
const soundButton = document.querySelector('#soundButton');
const helpButton = document.querySelector('#helpButton');
const helpDialog = document.querySelector('#helpDialog');

const W=960, H=560, TILE=40, ROWS=14, PLAYER_W=28, PLAYER_H=38, ENEMY_W=30, ENEMY_H=26;
const input = new Input();
function clearInput() {
  input.clear();
  document.querySelectorAll('[data-control]').forEach(b => b.classList.remove('active'));
}
let muted = false;
let audioContext;
let state = 'menu';
let levelIndex = 0;
let score = 0;
let lives = 3;
let levelStart = { score: 0, lives: 3 };
let world;
let elapsed = 0;
let previousTime = performance.now();
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const progress = new Progress(storage, LEVELS.length);
let highScore = progress.best;
let cameraX = 0;
// Live session exports let browser integration checks exercise the real game flow.
export { world, state, levelIndex };

function startGame(index=0){if(index>=progress.unlocked)return;levelIndex=index;score=0;lives=3;loadLevel();}
function loadLevel(){levelStart={score,lives};world=new World(LEVELS[levelIndex],score,lives,tone);state='playing';clearInput();cameraX=Math.max(0,world.player.x-W/2);hideOverlay();canvas.focus({preventScroll:true});}
function restartGame(){startGame();}
function restartLevel(){score=levelStart.score;lives=levelStart.lives;loadLevel();}
function nextLevel(){if(levelIndex+1<LEVELS.length){levelIndex++;loadLevel();}else finish('won');}
function finish(kind){clearInput();state=kind;progress.record(score);highScore=progress.best;showEndOverlay();}
function hideOverlay(){overlay.classList.add('hidden');}
function setOverlay(kicker,title,text,primary,secondary=''){clearInput();overlayKicker.textContent=kicker;overlayTitle.textContent=title;overlayText.textContent=text;primaryButton.textContent=primary;secondaryButton.textContent=secondary;secondaryButton.classList.toggle('hidden',!secondary);bestScore.textContent=`Best score: ${highScore}`;overlay.classList.remove('hidden');}
function showEndOverlay(){if(state==='won')setOverlay('All ten flags reached','You win!',`Final score: ${score}. The whole trail is behind you.`,'Play again','Back to title');else setOverlay('No lives remaining','Game over',`Final score: ${score}. Dust off and give it another run.`,'Restart game','Back to title');}
function pause(){clearInput();if(state==='playing'){state='paused';setOverlay(`Level ${levelIndex+1}: ${LEVELS[levelIndex].name}`,'Paused','Take a breath. Your run is waiting.','Resume','Restart level');}else if(state==='paused'){state='playing';hideOverlay();canvas.focus();}}

primaryButton.addEventListener('click',()=>{if(state==='menu'||state==='won'||state==='game_over')startGame();else if(state==='paused')pause();else if(state==='level_complete')nextLevel();});
secondaryButton.addEventListener('click',()=>{if(state==='paused'||state==='level_complete')restartLevel();else{state='menu';world=undefined;setOverlay('Ten stages. A whole adventure.','Ready to run?','Collect coins, stomp trouble, dodge hazards, and make it to the flag.','Start game');}});
helpButton.addEventListener('click',()=>{if(state==='playing')pause();helpDialog.showModal();});
soundButton.addEventListener('click',()=>{muted=!muted;soundButton.textContent=muted?'Sound off':'Sound on';soundButton.setAttribute('aria-label',muted?'Unmute sound':'Mute sound');});

const levelDialog = document.querySelector('#levelDialog');
const levelGrid = document.querySelector('#levelGrid');
function renderLevels() {
  levelGrid.replaceChildren();
  LEVELS.forEach((level, index) => {
    const button = document.createElement('button');
    button.textContent = `${index+1}. ${level.name}${index>=progress.unlocked?' (locked)':''}`;
    button.disabled = index>=progress.unlocked;
    button.addEventListener('click', () => { levelDialog.close(); startGame(index); });
    levelGrid.append(button);
  });
}
document.querySelector('#levelsButton').addEventListener('click', () => {
  if(state==='playing')pause(); clearInput(); renderLevels(); levelDialog.showModal();
});
document.querySelector('#resetButton').addEventListener('click', () => {
  if(window.confirm('Reset unlocked levels and best score in this browser?')) {
    progress.reset(); highScore=0; state='menu'; world=undefined;
    setOverlay('A fresh adventure','Ready to run?','Collect coins and reach all ten flags.','Start game');
    renderLevels();
  }
});
document.querySelector('#pauseButton').addEventListener('click',pause);
document.querySelector('#restartButton').addEventListener('click',()=>{if(state==='playing'||state==='paused')restartLevel();});
addEventListener('keydown', e => {
  if(helpDialog.open || levelDialog.open) return;
  if(e.target.closest?.('button') && (e.code==='Space'||e.code==='Enter')) return;
  if(CONTROL_KEYS[e.code] && state==='playing') {
    e.preventDefault(); input.down(`key:${e.code}`,CONTROL_KEYS[e.code]);
  }
  if(!e.repeat && (e.code==='KeyP'||e.code==='Escape')) {e.preventDefault();pause();}
  if(!e.repeat && e.code==='KeyM')soundButton.click();
  if(!e.repeat && e.code==='Enter'&&!overlay.classList.contains('hidden'))primaryButton.click();
});
addEventListener('keyup',e=>input.up(`key:${e.code}`));
function suspend() {clearInput();if(state==='playing')pause();}
addEventListener('blur',suspend);
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
bindPointers(document.querySelectorAll('[data-control]'),input,()=>state==='playing');

function tone(name){if(muted)return;const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;audioContext??=new Audio();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});const recipes={jump:[[330,.05],[440,.07]],coin:[[880,.05],[1320,.09]],stomp:[[200,.05],[140,.08]],hurt:[[330,.08],[220,.08],[140,.12]],complete:[[523,.1],[659,.1],[784,.1],[1047,.2]]};let at=audioContext.currentTime;for(const[f,d]of recipes[name]){const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='square';o.frequency.value=f;g.gain.setValueAtTime(.055,at);g.gain.exponentialRampToValueAtTime(.001,at+d);o.connect(g).connect(audioContext.destination);o.onended=()=>{o.disconnect();g.disconnect();};o.start(at);o.stop(at+d);at+=d;}}

function roundRect(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function text(value,x,y,size,color='#fff',align='left',weight=800){ctx.save();ctx.font=`${weight} ${size}px ui-rounded, Segoe UI, sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.lineWidth=Math.max(2,size/12);ctx.strokeStyle='rgba(7,13,32,.65)';ctx.strokeText(value,x,y);ctx.fillStyle=color;ctx.fillText(value,x,y);ctx.restore();}
function drawBackground(cam,palette){const colors=({cave:['#152b55','#596e94'],forest:['#173f42','#86c79b'],mountain:['#54739b','#d2e5f4'],desert:['#c97b4e','#ffe0a0'],snow:['#799ac7','#edfaff'],haunted:['#231e41','#75658e'],sky:['#69b8ef','#dff6ff'],lava:['#321b30','#ae4936'],castle:['#211e32','#7e6884']})[palette]||['#5caaeb','#c8e8fa'];const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,colors[0]);grad.addColorStop(1,colors[1]);ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);if(palette==='cave'){ctx.fillStyle='rgba(104,86,154,.36)';for(let i=0;i<14;i++){const x=(i*173-cam*.12)%(W+200)-60;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+38,90+(i%3)*32);ctx.lineTo(x+78,0);ctx.fill();}}else{for(let i=0;i<7;i++){const x=(i*260-cam*.15)%(W+300)-150,y=62+(i*53)%130;ctx.fillStyle='rgba(255,255,255,.9)';for(const[dx,dy,r]of[[0,0,26],[28,8,20],[-28,10,18],[10,14,22]]){ctx.beginPath();ctx.arc(x+dx,y+dy,r,0,Math.PI*2);ctx.fill();}}ctx.fillStyle=palette==='sky'?'#7696bd':'#78be8c';ctx.beginPath();ctx.moveTo(0,H);for(let x=0;x<=W+30;x+=30)ctx.lineTo(x,430-50*Math.sin((x+cam*.25)/110)-25*Math.sin((x+cam*.25)/47));ctx.lineTo(W,H);ctx.fill();}}
function drawWorld(){const cam=cameraX;drawBackground(cam,world.level.palette);const c0=Math.floor(cam/TILE),c1=Math.floor((cam+W)/TILE)+1;for(let c=c0;c<=c1;c++)for(let r=0;r<ROWS;r++)if(world.solidAt(c,r)){const x=c*TILE-cam,y=r*TILE;ctx.fillStyle=(['cave','haunted','castle'].includes(world.level.palette)?'#545071':world.level.ice?'#94bace':world.level.palette==='desert'?'#be884b':world.level.palette==='lava'?'#4b343c':'#865c3a');ctx.fillRect(x,y,TILE,TILE);ctx.strokeStyle='rgba(22,22,35,.22)';ctx.strokeRect(x+.5,y+.5,TILE-1,TILE-1);if(!world.solidAt(c,r-1)){ctx.fillStyle=(world.level.ice?'#e5faff':world.level.palette==='desert'?'#efc96b':['cave','haunted','castle'].includes(world.level.palette)?'#8e7ad0':world.level.palette==='lava'?'#f57842':'#54aa46');ctx.fillRect(x,y,TILE,9);ctx.fillStyle=world.level.palette==='cave'?'#6a5ba5':'#3c8737';ctx.fillRect(x,y+9,TILE,3);}}for(const[c,r]of world.spikes){const x=c*TILE-cam,y=r*TILE;ctx.fillStyle='#d5d9e2';ctx.strokeStyle='#797f91';for(let i=0;i<2;i++){ctx.beginPath();ctx.moveTo(x+i*20,y+40);ctx.lineTo(x+i*20+20,y+40);ctx.lineTo(x+i*20+10,y+10);ctx.closePath();ctx.fill();ctx.stroke();}}const[fc,fr]=world.flag,px=fc*TILE+TILE/2-cam;ctx.fillStyle='#edf0f5';ctx.fillRect(px-3,(fr-3)*TILE,6,4*TILE);ctx.fillStyle='#e63f51';ctx.beginPath();ctx.moveTo(px+3,(fr-3)*TILE);ctx.lineTo(px+43,(fr-3)*TILE+12+Math.sin(elapsed*6)*4);ctx.lineTo(px+3,(fr-3)*TILE+27);ctx.fill();for(const coin of world.coins)if(!coin.collected&&coin.col>=c0&&coin.col<=c1){const x=coin.col*TILE+20-cam,y=coin.row*TILE+20+Math.sin(elapsed*4+coin.col)*3,hw=Math.max(3,Math.abs(Math.cos(elapsed*3+coin.col))*11);ctx.fillStyle='#c8960a';ctx.beginPath();ctx.ellipse(x,y,hw+1,12,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffd52f';ctx.beginPath();ctx.ellipse(x,y,hw,10.5,0,0,Math.PI*2);ctx.fill();}for(const e of world.enemies)if(e.alive){const x=e.x-cam,y=e.y+4+Math.sin(elapsed*8+e.x)*2;ctx.fillStyle='#9842be';ctx.strokeStyle='#5a1e78';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x+ENEMY_W/2,y+(ENEMY_H-4)/2,ENEMY_W/2,(ENEMY_H-4)/2,0,0,Math.PI*2);ctx.fill();ctx.stroke();for(const ox of[9,21]){ctx.fillStyle='white';ctx.beginPath();ctx.arc(x+ox,y+8,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#161727';ctx.beginPath();ctx.arc(x+ox+e.direction*1.5,y+8,2,0,Math.PI*2);ctx.fill();}}for(const m of world.movers) roundRect(m.x-cam,m.y,m.w,m.h,5,'#64c7cb','#c2ffff');
    for(const h of world.hazards) {
      roundRect(h.x-cam,h.y,30,40,h.kind==='saw'?15:5,h.active?'#ff6748':'#685367','#ffd18c');
      if(!h.active) text('!',h.x+15-cam,h.y+18,20,'#ffe39b','center');
    }
    const [cx,cy]=world.checkpoint;
    ctx.fillStyle='#8affc1';ctx.fillRect(cx-cam+12,cy+16,3,22);ctx.fillRect(cx-cam+15,cy+16,14,8);
    drawPlayer(cam);drawHud();}
function drawPlayer(cam){const p=world.player;if(p.invulnerable>0&&Math.floor(elapsed*12)%2===0)return;const x=p.x-cam,y=p.y,step=Math.abs(p.vx)>1&&p.onGround?Math.sin(elapsed*18)*4:0;roundRect(x+4+step,y+PLAYER_H-8,8,8,2,'#213775');roundRect(x+PLAYER_W-12-step,y+PLAYER_H-8,8,8,2,'#213775');roundRect(x,y,PLAYER_W,PLAYER_H-6,7,'#3f7bdd','#1f4da4');roundRect(x-1,y+3,PLAYER_W+2,6,3,'#e13d4b');for(const ox of[8,19]){ctx.fillStyle='white';ctx.beginPath();ctx.arc(x+ox+p.facing*2,y+15,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#131625';ctx.beginPath();ctx.arc(x+ox+p.facing*3.5,y+15,2,0,Math.PI*2);ctx.fill();}}
function drawHud(){ctx.fillStyle='rgba(7,14,35,.72)';ctx.fillRect(0,0,W,42);text(`Level ${levelIndex+1}/10: ${LEVELS[levelIndex].name}`,14,22,19);text(`Coins ${world.coinsCollected}/${world.totalCoins}`,425,22,23,'#ffd52f','center');text(`Score ${world.score}`,590,22,23,'#fff','center');text(`Best ${Math.max(highScore,world.score)}`,730,22,23,'#b8ccff','center');for(let i=0;i<world.lives;i++){const x=928-i*32,y=11;ctx.fillStyle='#e63e50';ctx.beginPath();ctx.moveTo(x,y+7);ctx.bezierCurveTo(x-10,y-3,x-16,y+9,x,y+23);ctx.bezierCurveTo(x+16,y+9,x+10,y-3,x,y+7);ctx.fill();}}

let accumulator=0;
function frame(now){const dt=Math.max(0,Math.min((now-previousTime)/1000,.1));previousTime=now;elapsed+=dt;
  if(state==='playing'&&world){
    accumulator+=dt;
    while(accumulator>=1/60 && world.status==='playing'){
      world.update(1/60,input.move,input.consumeJump(),input.held('jump'));
      accumulator-=1/60;
    }
    const target=Math.max(0,Math.min(world.player.x+PLAYER_W/2-W*.42,world.widthPx-W));
    cameraX+=(target-cameraX)*(1-Math.exp(-dt*12));
    if(Math.abs(world.player.x-cameraX)>W)cameraX=target;
    score=world.score;lives=world.lives;
    if(world.status==='complete'){state='level_complete';progress.complete(levelIndex,score);highScore=progress.best;setOverlay(`Level ${levelIndex+1} clear`,'Level complete!',`${world.coinsCollected}/${world.totalCoins} coins · +${world.levelBonus} bonus · +1 life (max 3) · Score ${score}`,(levelIndex===LEVELS.length-1?'Finish adventure':'Next level'),'Restart level');}else if(world.status==='game_over')finish('game_over');}else accumulator=0;if(world)drawWorld();else{drawBackground(elapsed*35,'meadow');text('COIN RUNNER',W/2,H/2-12,76,'#ffd52f','center',900);text('A 2D platform adventure',W/2,H/2+48,28,'#fff','center',700);}requestAnimationFrame(frame);}

bestScore.textContent=`Best score: ${highScore}`;
requestAnimationFrame(frame);
