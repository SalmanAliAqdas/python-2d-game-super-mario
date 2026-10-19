const W = 960, H = 560, TILE = 40, ROWS = 14;
const GRAVITY = 2200, MAX_FALL = 900, MOVE_SPEED = 260, JUMP_SPEED = 760;
const COYOTE = .1, JUMP_BUFFER = .1, JUMP_CUT = .45;
const PLAYER_W = 28, PLAYER_H = 38, ENEMY_W = 30, ENEMY_H = 26;
export class World {
  constructor(level, carryScore=0, carryLives=3, sound=()=>{}) {
    this.level = level;
    this.sound = sound;
    this.time = 0;
    this.movers = (level.movers || []).map(m => ({ ...m, originX: m.x, dx: 0, h: 14 }));
    this.hazards = (level.hazards || []).map(h => ({ ...h, originX: h.x, active: true }));
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
    this.time += dt;
    this.updateFeatures(dt);
    p.invulnerable=Math.max(0,p.invulnerable-dt);
    p.coyote=p.onGround?COYOTE:p.coyote-dt;
    p.jumpBuffer=pressed?JUMP_BUFFER:p.jumpBuffer-dt;
    if(p.jumpBuffer>0&&p.coyote>0){p.vy=-JUMP_SPEED;p.coyote=0;p.jumpBuffer=0;p.onGround=false;this.sound('jump');}
    if(!held&&p.vy < -JUMP_SPEED*JUMP_CUT) p.vy=-JUMP_SPEED*JUMP_CUT;
    p.knockTime=Math.max(0,p.knockTime-dt);
    if(p.knockTime>0) p.vx=p.knockVx;
    else if(this.level.ice && p.onGround) {
      const target=move*MOVE_SPEED, amount=(move?800:420)*dt;
      p.vx += Math.max(-amount,Math.min(amount,target-p.vx));
    } else p.vx=move*MOVE_SPEED;
    if(move&&p.knockTime<=0)p.facing=move;
    p.vy=Math.min(p.vy+GRAVITY*dt,MAX_FALL);
    const oldBottom=p.y+PLAYER_H;
    const riding = this.movers.find(m => p.onGround && Math.abs(oldBottom-m.y)<2 && p.x+PLAYER_W>m.x-m.dx && p.x<m.x-m.dx+m.w);
    if(riding) p.x += riding.dx;
    this.movePlayer(dt);
    if(p.vy>=0) for(const m of this.movers) {
      if(oldBottom<=m.y+2 && p.y+PLAYER_H>=m.y && p.x+PLAYER_W>m.x && p.x<m.x+m.w) {
        p.y=m.y-PLAYER_H; p.vy=0; p.onGround=true;
      }
    }
    p.x=Math.max(0,Math.min(this.widthPx-PLAYER_W,p.x));
    for(const h of this.hazards) if(h.active && World.touch(this.playerBox(),{x:h.x,y:h.y,w:30,h:40})) this.hurt(h.x+15);
    this.enemies.filter(e=>e.alive).forEach(e=>this.moveEnemy(e,dt));
    this.collectCoins(); this.checkEnemies(oldBottom); this.checkSpikes(); this.updateCheckpoint(dt);
    if(p.y>H+3*TILE)this.hurt(null,true);
    const [fc,fr]=this.flag;
    if(this.status==='playing'&&World.touch(this.playerBox(),{x:fc*TILE+8,y:(fr-4)*TILE,w:TILE-16,h:TILE*5}))this.complete();
  }

  updateFeatures(dt) {
    for(const m of this.movers) {
      const x=m.originX+Math.sin(this.time*m.speed)*m.range;
      m.dx=x-m.x; m.x=x;
    }
    for(const h of this.hazards) {
      h.x=h.originX+Math.sin(this.time*h.speed)*h.range;
      h.active=h.kind==='saw'||(this.time*h.speed)%3>1.4;
    }
  }

  movePlayer(dt){const p=this.player;p.x=Math.max(0,Math.min(this.widthPx-PLAYER_W,p.x+p.vx*dt));for(const[c]of this.overlapping(p.x,p.y,PLAYER_W,PLAYER_H))p.x=p.vx>0?c*TILE-PLAYER_W:(c+1)*TILE;p.y+=p.vy*dt;p.onGround=false;for(const[,r]of this.overlapping(p.x,p.y,PLAYER_W,PLAYER_H)){if(p.vy>0){p.y=r*TILE-PLAYER_H;p.onGround=true;}else if(p.vy<0)p.y=(r+1)*TILE;p.vy=0;}}
  moveEnemy(e,dt){e.x+=e.direction*70*dt;const hit=this.overlapping(e.x,e.y,ENEMY_W,ENEMY_H)[0];if(hit){e.x=e.direction>0?hit[0]*TILE-ENEMY_W:(hit[0]+1)*TILE;e.direction*=-1;}else{const px=e.x+(e.direction>0?ENEMY_W+2:-2),py=e.y+ENEMY_H+2;if(!this.solidAt(Math.floor(px/TILE),Math.floor(py/TILE)))e.direction*=-1;}e.vy=Math.min(e.vy+GRAVITY*dt,MAX_FALL);e.y+=e.vy*dt;const floor=this.overlapping(e.x,e.y,ENEMY_W,ENEMY_H)[0];if(floor){if(e.vy>0)e.y=floor[1]*TILE-ENEMY_H;e.vy=0;}}
  collectCoins(){const box=this.playerBox();for(const c of this.coins)if(!c.collected&&World.touch(box,{x:c.col*TILE+9,y:c.row*TILE+9,w:TILE-18,h:TILE-18})){c.collected=true;this.score+=10;this.sound('coin');}}
  checkEnemies(oldBottom){const p=this.player;for(const e of this.enemies){if(!e.alive||!World.touch(this.playerBox(),{x:e.x,y:e.y,w:ENEMY_W,h:ENEMY_H}))continue;if(p.vy>0&&oldBottom<=e.y+14){e.alive=false;p.vy=-JUMP_SPEED*.6;p.onGround=false;this.score+=100;this.sound('stomp');}else if(p.invulnerable<=0)this.hurt(e.x+ENEMY_W/2);}}
  checkSpikes(){const p=this.player;if(p.invulnerable>0)return;const box={x:p.x+4,y:p.y+4,w:PLAYER_W-8,h:PLAYER_H-4};for(const[c,r]of this.spikes)if(World.touch(box,{x:c*TILE+6,y:r*TILE+TILE*.55,w:TILE-12,h:TILE*.45})){this.hurt(c*TILE+TILE/2);break;}}
  updateCheckpoint(dt){const p=this.player;this.checkpointTimer-=dt;if(!p.onGround||this.checkpointTimer>0)return;const danger=this.spikes.some(([c,r])=>Math.abs(c*TILE+TILE/2-p.x)<3*TILE&&Math.abs(r*TILE-p.y)<3*TILE)||this.enemies.some(e=>e.alive&&Math.abs(e.x-p.x)<3*TILE&&Math.abs(e.y-p.y)<2*TILE);const stable=this.solidAt(Math.floor((p.x+PLAYER_W/2)/TILE),Math.round((p.y+PLAYER_H)/TILE)) && this.solidAt(Math.floor((p.x-TILE)/TILE),Math.round((p.y+PLAYER_H)/TILE)) && this.solidAt(Math.floor((p.x+PLAYER_W+TILE)/TILE),Math.round((p.y+PLAYER_H)/TILE));
    const movingDanger=this.hazards.some(h=>Math.abs(h.originX-p.x)<h.range+3*TILE && Math.abs(h.y-p.y)<3*TILE);
    if(!danger&&stable&&!movingDanger){this.checkpoint=[p.x,p.y];this.checkpointTimer=.5;}}
  hurt(sourceX=null,fell=false){const p=this.player;if(p.invulnerable>0&&!fell)return;this.lives--;this.sound('hurt');if(this.lives<=0){this.status='game_over';return;}p.invulnerable=1.5;if(fell){[p.x,p.y]=this.checkpoint;p.vx=p.vy=0;p.knockTime=0;}else{p.vy=-JUMP_SPEED*.55;p.onGround=false;p.knockVx=(sourceX!==null&&sourceX>p.x+PLAYER_W/2?-1:1)*220;p.knockTime=.25;}}
  complete(){this.levelBonus=200+(this.totalCoins>0&&this.coinsCollected===this.totalCoins?300:0);this.score+=this.levelBonus;this.lives=Math.min(3,this.lives+1);this.status='complete';this.sound('complete');}
}

