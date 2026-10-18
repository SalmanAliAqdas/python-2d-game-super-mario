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

const W = 960, H = 560, TILE = 40, ROWS = 14;
const GRAVITY = 2200, MAX_FALL = 900, MOVE_SPEED = 260, JUMP_SPEED = 760;
const COYOTE = .1, JUMP_BUFFER = .1, JUMP_CUT = .45;
const PLAYER_W = 28, PLAYER_H = 38, ENEMY_W = 30, ENEMY_H = 26;
const LEVELS = [
  { name: 'Sunny Meadow', palette: 'meadow', rows: [
    '........................................................................','........................................................................','........................................................................','........................................................................','........................................................................','........................................................................','........................................................................','................oooo....................................................','................####....................................................','...........ooo.........o..........ooo........o........oooo..............','.....oooo.#####.......o.o........#####......o.o......######.....ooo.....','..P...........................E.....................#######...E.....F...','######################...###################...#########################','######################...###################...#########################'] },
  { name: 'Crystal Caves', palette: 'cave', rows: [
    '....................................................................................','....................................................................................','....................................................................................','....................................................................................','....................................................................................','............................................................ooo.....................','............................................................###.....................','........................................................ooo.........................','..............................ooo...oo..................###.........................','......................................E..^^.........ooo...............ooo...........','...ooooo.........oo..oo...ooo......###########.oo...###....................oooo.....','..P..............##..##.......^^^..###########.##.................E...^^^.......F...','################.........#####################....##################################','################.........#####################....##################################'] },
  { name: 'Sky Islands', palette: 'sky', rows: [
    '....................................................................................................','....................................................................................................','....................................................................................................','....................................................................................................','....................................................................................................','................................................oo..................................................','....................................................................................................','..........................................ooo.oo^^oo....................ooo.........................','......................oooo..ooEooo........###.######..ooo..........ooo..###..ooo....................','................oooo..####..######..ooo...............###..ooEooo..###.......###..ooo^^oEoo.........','..ooooo....ooo..####................###....................######.................#########.........','..P........###...................................................................................F..','#########...................................................................................########','#########...................................................................................########'] }
];

const keys = new Set();
const touch = { left: false, right: false, jump: false };
let jumpPressed = false;
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
let highScore = Number(localStorage.getItem('coinRunnerHighScore')) || 0;

class World {
  constructor(level, carryScore, carryLives) {
    this.level = level;
    this.solids = new Set(); this.coins = []; this.spikes = []; this.enemies = [];
    this.widthTiles = level.rows[0].length;
    this.score = carryScore; this.lives = carryLives; this.status = 'playing'; this.levelBonus = 0;
    level.rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === '#') this.solids.add(`${c},${r}`);
      else if (ch === 'o') this.coins.push({ col: c, row: r, collected: false });
      else if (ch === '^') this.spikes.push([c, r]);
      else if (ch === 'E') this.enemies.push({ x: c*TILE+(TILE-ENEMY_W)/2, y: (r+1)*TILE-ENEMY_H, direction: -1, vy: 0, alive: true });
      else if (ch === 'P') this.start = [c, r];
      else if (ch === 'F') this.flag = [c, r];
    }));
    this.player = this.spawnPlayer();
    this.checkpoint = [this.player.x, this.player.y];
    this.checkpointTimer = 0;
  }

  spawnPlayer() { const [c,r]=this.start; return { x:c*TILE+(TILE-PLAYER_W)/2, y:(r+1)*TILE-PLAYER_H, vx:0, vy:0, onGround:false, facing:1, coyote:0, jumpBuffer:0, invulnerable:0, knockVx:0, knockTime:0 }; }
  get widthPx() { return this.widthTiles*TILE; }
  get totalCoins() { return this.coins.length; }
  get coinsCollected() { return this.coins.filter(c=>c.collected).length; }
  solidAt(c,r) { return this.solids.has(`${c},${r}`); }
  static touch(a,b) { return a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h; }
  playerBox() { return {x:this.player.x,y:this.player.y,w:PLAYER_W,h:PLAYER_H}; }
  overlapping(left,top,width,height) {
    const found=[];
    for(let c=Math.floor(left/TILE);c<=Math.floor((left+width-1e-6)/TILE);c++) for(let r=Math.floor(top/TILE);r<=Math.floor((top+height-1e-6)/TILE);r++) if(this.solidAt(c,r)) found.push([c,r]);
    return found;
  }

  update(dt, move, pressed, held) {
    if(this.status!=='playing') return;
    const p=this.player;
    p.invulnerable=Math.max(0,p.invulnerable-dt);
    p.coyote=p.onGround?COYOTE:p.coyote-dt;
    p.jumpBuffer=pressed?JUMP_BUFFER:p.jumpBuffer-dt;
    if(p.jumpBuffer>0&&p.coyote>0){p.vy=-JUMP_SPEED;p.coyote=0;p.jumpBuffer=0;p.onGround=false;tone('jump');}
    if(!held&&p.vy < -JUMP_SPEED*JUMP_CUT) p.vy=-JUMP_SPEED*JUMP_CUT;
    p.knockTime=Math.max(0,p.knockTime-dt);
    p.vx=p.knockTime>0?p.knockVx:move*MOVE_SPEED;
    if(move&&p.knockTime<=0)p.facing=move;
    p.vy=Math.min(p.vy+GRAVITY*dt,MAX_FALL);
    const oldBottom=p.y+PLAYER_H;
    this.movePlayer(dt);
    this.enemies.filter(e=>e.alive).forEach(e=>this.moveEnemy(e,dt));
    this.collectCoins(); this.checkEnemies(oldBottom); this.checkSpikes(); this.updateCheckpoint(dt);
    if(p.y>H+3*TILE)this.hurt(null,true);
    const [fc,fr]=this.flag;
    if(this.status==='playing'&&World.touch(this.playerBox(),{x:fc*TILE+8,y:(fr-4)*TILE,w:TILE-16,h:TILE*5}))this.complete();
  }

  movePlayer(dt){const p=this.player;p.x=Math.max(0,Math.min(this.widthPx-PLAYER_W,p.x+p.vx*dt));for(const[c]of this.overlapping(p.x,p.y,PLAYER_W,PLAYER_H))p.x=p.vx>0?c*TILE-PLAYER_W:(c+1)*TILE;p.y+=p.vy*dt;p.onGround=false;for(const[,r]of this.overlapping(p.x,p.y,PLAYER_W,PLAYER_H)){if(p.vy>0){p.y=r*TILE-PLAYER_H;p.onGround=true;}else if(p.vy<0)p.y=(r+1)*TILE;p.vy=0;}}
  moveEnemy(e,dt){e.x+=e.direction*70*dt;const hit=this.overlapping(e.x,e.y,ENEMY_W,ENEMY_H)[0];if(hit){e.x=e.direction>0?hit[0]*TILE-ENEMY_W:(hit[0]+1)*TILE;e.direction*=-1;}else{const px=e.x+(e.direction>0?ENEMY_W+2:-2),py=e.y+ENEMY_H+2;if(!this.solidAt(Math.floor(px/TILE),Math.floor(py/TILE)))e.direction*=-1;}e.vy=Math.min(e.vy+GRAVITY*dt,MAX_FALL);e.y+=e.vy*dt;const floor=this.overlapping(e.x,e.y,ENEMY_W,ENEMY_H)[0];if(floor){if(e.vy>0)e.y=floor[1]*TILE-ENEMY_H;e.vy=0;}}
  collectCoins(){const box=this.playerBox();for(const c of this.coins)if(!c.collected&&World.touch(box,{x:c.col*TILE+9,y:c.row*TILE+9,w:TILE-18,h:TILE-18})){c.collected=true;this.score+=10;tone('coin');}}
  checkEnemies(oldBottom){const p=this.player;for(const e of this.enemies){if(!e.alive||!World.touch(this.playerBox(),{x:e.x,y:e.y,w:ENEMY_W,h:ENEMY_H}))continue;if(p.vy>0&&oldBottom<=e.y+14){e.alive=false;p.vy=-JUMP_SPEED*.6;p.onGround=false;this.score+=100;tone('stomp');}else if(p.invulnerable<=0)this.hurt(e.x+ENEMY_W/2);}}
  checkSpikes(){const p=this.player;if(p.invulnerable>0)return;const box={x:p.x+4,y:p.y+4,w:PLAYER_W-8,h:PLAYER_H-4};for(const[c,r]of this.spikes)if(World.touch(box,{x:c*TILE+6,y:r*TILE+TILE*.55,w:TILE-12,h:TILE*.45})){this.hurt(c*TILE+TILE/2);break;}}
  updateCheckpoint(dt){const p=this.player;this.checkpointTimer-=dt;if(!p.onGround||this.checkpointTimer>0)return;const danger=this.spikes.some(([c,r])=>Math.abs(c*TILE+TILE/2-p.x)<3*TILE&&Math.abs(r*TILE-p.y)<3*TILE)||this.enemies.some(e=>e.alive&&Math.abs(e.x-p.x)<3*TILE&&Math.abs(e.y-p.y)<2*TILE);if(!danger){this.checkpoint=[p.x,p.y];this.checkpointTimer=.5;}}
  hurt(sourceX=null,fell=false){const p=this.player;if(p.invulnerable>0&&!fell)return;this.lives--;tone('hurt');if(this.lives<=0){this.status='game_over';return;}p.invulnerable=1.5;if(fell){[p.x,p.y]=this.checkpoint;p.vx=p.vy=0;p.knockTime=0;}else{p.vy=-JUMP_SPEED*.55;p.onGround=false;p.knockVx=(sourceX!==null&&sourceX>p.x+PLAYER_W/2?-1:1)*220;p.knockTime=.25;}}
  complete(){this.levelBonus=200+(this.totalCoins>0&&this.coinsCollected===this.totalCoins?300:0);this.score+=this.levelBonus;this.status='complete';tone('complete');}
}

function startGame(){levelIndex=0;score=0;lives=3;loadLevel();hideOverlay();}
function loadLevel(){levelStart={score,lives};world=new World(LEVELS[levelIndex],score,lives);state='playing';jumpPressed=false;hideOverlay();canvas.focus();}
function restartGame(){startGame();}
function restartLevel(){score=levelStart.score;lives=levelStart.lives;loadLevel();}
function nextLevel(){if(levelIndex+1<LEVELS.length){levelIndex++;loadLevel();}else finish('won');}
function finish(kind){state=kind;if(score>highScore){highScore=score;localStorage.setItem('coinRunnerHighScore',String(score));}showEndOverlay();}
function hideOverlay(){overlay.classList.add('hidden');}
function setOverlay(kicker,title,text,primary,secondary=''){overlayKicker.textContent=kicker;overlayTitle.textContent=title;overlayText.textContent=text;primaryButton.textContent=primary;secondaryButton.textContent=secondary;secondaryButton.classList.toggle('hidden',!secondary);bestScore.textContent=`Best score: ${highScore}`;overlay.classList.remove('hidden');}
function showEndOverlay(){if(state==='won')setOverlay('All three flags reached','You win!',`Final score: ${score}. The whole trail is behind you.`,'Play again','Back to title');else setOverlay('No lives remaining','Game over',`Final score: ${score}. Dust off and give it another run.`,'Restart game','Back to title');}
function pause(){if(state==='playing'){state='paused';setOverlay(`Level ${levelIndex+1}: ${LEVELS[levelIndex].name}`,'Paused','Take a breath. Your run is waiting.','Resume','Restart level');}else if(state==='paused'){state='playing';hideOverlay();canvas.focus();}}

primaryButton.addEventListener('click',()=>{if(state==='menu'||state==='won'||state==='game_over')startGame();else if(state==='paused')pause();else if(state==='level_complete')nextLevel();});
secondaryButton.addEventListener('click',()=>{if(state==='paused'||state==='level_complete')restartLevel();else{state='menu';world=undefined;setOverlay('Three levels. One tiny hero.','Ready to run?','Collect coins, stomp trouble, dodge hazards, and make it to the flag.','Start game');}});
helpButton.addEventListener('click',()=>helpDialog.showModal());
soundButton.addEventListener('click',()=>{muted=!muted;soundButton.textContent=muted?'Sound off':'Sound on';soundButton.setAttribute('aria-label',muted?'Unmute sound':'Mute sound');});

const controlKeys={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',Space:'jump',ArrowUp:'jump',KeyW:'jump'};
addEventListener('keydown',e=>{if(controlKeys[e.code]){e.preventDefault();if(controlKeys[e.code]==='jump'&&!keys.has(e.code))jumpPressed=true;keys.add(e.code);}if(e.code==='KeyP'||e.code==='Escape'){e.preventDefault();pause();}if(e.code==='KeyM')soundButton.click();if(e.code==='Enter'&&!overlay.classList.contains('hidden'))primaryButton.click();});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{keys.clear();Object.keys(touch).forEach(k=>touch[k]=false);if(state==='playing')pause();});
document.querySelectorAll('[data-control]').forEach(button=>{const name=button.dataset.control;const down=e=>{e.preventDefault();if(name==='jump'&&!touch.jump)jumpPressed=true;touch[name]=true;button.classList.add('active');};const up=e=>{e.preventDefault();touch[name]=false;button.classList.remove('active');};button.addEventListener('pointerdown',down);button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);button.addEventListener('pointerleave',up);});

function tone(name){if(muted)return;audioContext??=new AudioContext();if(audioContext.state==='suspended')audioContext.resume();const recipes={jump:[[330,.05],[440,.07]],coin:[[880,.05],[1320,.09]],stomp:[[200,.05],[140,.08]],hurt:[[330,.08],[220,.08],[140,.12]],complete:[[523,.1],[659,.1],[784,.1],[1047,.2]]};let at=audioContext.currentTime;for(const[f,d]of recipes[name]){const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='square';o.frequency.value=f;g.gain.setValueAtTime(.055,at);g.gain.exponentialRampToValueAtTime(.001,at+d);o.connect(g).connect(audioContext.destination);o.start(at);o.stop(at+d);at+=d;}}

function roundRect(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function text(value,x,y,size,color='#fff',align='left',weight=800){ctx.save();ctx.font=`${weight} ${size}px ui-rounded, Segoe UI, sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.lineWidth=Math.max(2,size/12);ctx.strokeStyle='rgba(7,13,32,.65)';ctx.strokeText(value,x,y);ctx.fillStyle=color;ctx.fillText(value,x,y);ctx.restore();}
function drawBackground(cam,palette){const colors=palette==='cave'?['#152b55','#596e94']:palette==='sky'?['#69b8ef','#dff6ff']:['#5caaeb','#c8e8fa'];const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,colors[0]);grad.addColorStop(1,colors[1]);ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);if(palette==='cave'){ctx.fillStyle='rgba(104,86,154,.36)';for(let i=0;i<14;i++){const x=(i*173-cam*.12)%(W+200)-60;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+38,90+(i%3)*32);ctx.lineTo(x+78,0);ctx.fill();}}else{for(let i=0;i<7;i++){const x=(i*260-cam*.15)%(W+300)-150,y=62+(i*53)%130;ctx.fillStyle='rgba(255,255,255,.9)';for(const[dx,dy,r]of[[0,0,26],[28,8,20],[-28,10,18],[10,14,22]]){ctx.beginPath();ctx.arc(x+dx,y+dy,r,0,Math.PI*2);ctx.fill();}}ctx.fillStyle=palette==='sky'?'#7696bd':'#78be8c';ctx.beginPath();ctx.moveTo(0,H);for(let x=0;x<=W+30;x+=30)ctx.lineTo(x,430-50*Math.sin((x+cam*.25)/110)-25*Math.sin((x+cam*.25)/47));ctx.lineTo(W,H);ctx.fill();}}
function drawWorld(){const cam=Math.max(0,Math.min(world.player.x+PLAYER_W/2-W/2,world.widthPx-W));drawBackground(cam,world.level.palette);const c0=Math.floor(cam/TILE),c1=Math.floor((cam+W)/TILE)+1;for(let c=c0;c<=c1;c++)for(let r=0;r<ROWS;r++)if(world.solidAt(c,r)){const x=c*TILE-cam,y=r*TILE;ctx.fillStyle=world.level.palette==='cave'?'#545071':'#865c3a';ctx.fillRect(x,y,TILE,TILE);ctx.strokeStyle='rgba(22,22,35,.22)';ctx.strokeRect(x+.5,y+.5,TILE-1,TILE-1);if(!world.solidAt(c,r-1)){ctx.fillStyle=world.level.palette==='cave'?'#8e7ad0':'#54aa46';ctx.fillRect(x,y,TILE,9);ctx.fillStyle=world.level.palette==='cave'?'#6a5ba5':'#3c8737';ctx.fillRect(x,y+9,TILE,3);}}for(const[c,r]of world.spikes){const x=c*TILE-cam,y=r*TILE;ctx.fillStyle='#d5d9e2';ctx.strokeStyle='#797f91';for(let i=0;i<2;i++){ctx.beginPath();ctx.moveTo(x+i*20,y+40);ctx.lineTo(x+i*20+20,y+40);ctx.lineTo(x+i*20+10,y+10);ctx.closePath();ctx.fill();ctx.stroke();}}const[fc,fr]=world.flag,px=fc*TILE+TILE/2-cam;ctx.fillStyle='#edf0f5';ctx.fillRect(px-3,(fr-3)*TILE,6,4*TILE);ctx.fillStyle='#e63f51';ctx.beginPath();ctx.moveTo(px+3,(fr-3)*TILE);ctx.lineTo(px+43,(fr-3)*TILE+12+Math.sin(elapsed*6)*4);ctx.lineTo(px+3,(fr-3)*TILE+27);ctx.fill();for(const coin of world.coins)if(!coin.collected&&coin.col>=c0&&coin.col<=c1){const x=coin.col*TILE+20-cam,y=coin.row*TILE+20+Math.sin(elapsed*4+coin.col)*3,hw=Math.max(3,Math.abs(Math.cos(elapsed*3+coin.col))*11);ctx.fillStyle='#c8960a';ctx.beginPath();ctx.ellipse(x,y,hw+1,12,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffd52f';ctx.beginPath();ctx.ellipse(x,y,hw,10.5,0,0,Math.PI*2);ctx.fill();}for(const e of world.enemies)if(e.alive){const x=e.x-cam,y=e.y+4+Math.sin(elapsed*8+e.x)*2;ctx.fillStyle='#9842be';ctx.strokeStyle='#5a1e78';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x+ENEMY_W/2,y+(ENEMY_H-4)/2,ENEMY_W/2,(ENEMY_H-4)/2,0,0,Math.PI*2);ctx.fill();ctx.stroke();for(const ox of[9,21]){ctx.fillStyle='white';ctx.beginPath();ctx.arc(x+ox,y+8,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#161727';ctx.beginPath();ctx.arc(x+ox+e.direction*1.5,y+8,2,0,Math.PI*2);ctx.fill();}}drawPlayer(cam);drawHud();}
function drawPlayer(cam){const p=world.player;if(p.invulnerable>0&&Math.floor(elapsed*12)%2===0)return;const x=p.x-cam,y=p.y,step=Math.abs(p.vx)>1&&p.onGround?Math.sin(elapsed*18)*4:0;roundRect(x+4+step,y+PLAYER_H-8,8,8,2,'#213775');roundRect(x+PLAYER_W-12-step,y+PLAYER_H-8,8,8,2,'#213775');roundRect(x,y,PLAYER_W,PLAYER_H-6,7,'#3f7bdd','#1f4da4');roundRect(x-1,y+3,PLAYER_W+2,6,3,'#e13d4b');for(const ox of[8,19]){ctx.fillStyle='white';ctx.beginPath();ctx.arc(x+ox+p.facing*2,y+15,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#131625';ctx.beginPath();ctx.arc(x+ox+p.facing*3.5,y+15,2,0,Math.PI*2);ctx.fill();}}
function drawHud(){ctx.fillStyle='rgba(7,14,35,.72)';ctx.fillRect(0,0,W,42);text(`Level ${levelIndex+1}: ${LEVELS[levelIndex].name}`,14,22,23);text(`Coins ${world.coinsCollected}/${world.totalCoins}`,425,22,23,'#ffd52f','center');text(`Score ${world.score}`,590,22,23,'#fff','center');text(`Best ${Math.max(highScore,world.score)}`,730,22,23,'#b8ccff','center');for(let i=0;i<world.lives;i++){const x=928-i*32,y=11;ctx.fillStyle='#e63e50';ctx.beginPath();ctx.moveTo(x,y+7);ctx.bezierCurveTo(x-10,y-3,x-16,y+9,x,y+23);ctx.bezierCurveTo(x+16,y+9,x+10,y-3,x,y+7);ctx.fill();}}

function frame(now){const dt=Math.min((now-previousTime)/1000,1/30);previousTime=now;elapsed+=dt;if(state==='playing'&&world){const left=keys.has('ArrowLeft')||keys.has('KeyA')||touch.left,right=keys.has('ArrowRight')||keys.has('KeyD')||touch.right,held=keys.has('Space')||keys.has('ArrowUp')||keys.has('KeyW')||touch.jump;world.update(dt,(right?1:0)-(left?1:0),jumpPressed,held);jumpPressed=false;score=world.score;lives=world.lives;if(world.status==='complete'){state='level_complete';setOverlay(`Level ${levelIndex+1} clear`,'Level complete!',`${world.coinsCollected}/${world.totalCoins} coins · +${world.levelBonus} level bonus · Score ${score}`,(levelIndex===LEVELS.length-1?'Finish adventure':'Next level'),'Restart level');}else if(world.status==='game_over')finish('game_over');}if(world)drawWorld();else{drawBackground(elapsed*35,'meadow');text('COIN RUNNER',W/2,H/2-12,76,'#ffd52f','center',900);text('A 2D platform adventure',W/2,H/2+48,28,'#fff','center',700);}requestAnimationFrame(frame);}

bestScore.textContent=`Best score: ${highScore}`;
requestAnimationFrame(frame);
