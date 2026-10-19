import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { LEVELS } from '../docs/js/levels.js';
import { World } from '../docs/js/world.js';
import { Input, CONTROL_KEYS, bindPointers } from '../docs/js/input.js';
import { Progress } from '../docs/js/progress.js';

test('ten unique valid maps with safe starts, finishes, coins and enemies', () => {
  assert.equal(LEVELS.length, 10);
  assert.equal(new Set(LEVELS.map(l => JSON.stringify(l.rows))).size, 10);
  for (const level of LEVELS) {
    assert.equal(level.rows.length, 14);
    assert(level.rows.every(r => r.length === level.rows[0].length && /^[.#o^EPF]+$/.test(r)));
    for (const char of ['P','F']) assert.equal(level.rows.join('').split(char).length-1, 1);
    const world = new World(level);
    for (const [c,r] of [world.start,world.flag]) assert(world.solidAt(c,r+1));
    assert(world.totalCoins>15); assert(world.enemies.length>=2);
  }
});

test('keyboard aliases and independent simultaneous input sources', () => {
  const input = new Input();
  for (const code of ['Space','ArrowUp','KeyW']) assert.equal(CONTROL_KEYS[code],'jump');
  input.down('key:KeyD',CONTROL_KEYS.KeyD); input.down('finger:1','jump');
  assert.equal(input.move,1); assert(input.held('jump')); assert(input.consumeJump());
  assert(!input.consumeJump());
  input.down('finger:2','jump'); input.up('finger:1'); assert(input.held('jump'));
  input.up('finger:2'); assert(!input.held('jump'));
  input.clear(); assert.equal(input.move,0); assert(!input.consumeJump());
});

test('pointer capture, release, cancellation and lost capture', () => {
  const input=new Input(); let enabled=true;
  function button(name) {
    return {dataset:{control:name}, handlers:{}, classList:{toggle(){}},
      setPointerCapture(id){this.capture=id;}, addEventListener(n,f){this.handlers[n]=f;}};
  }
  const right=button('right'), jump=button('jump');
  bindPointers([right,jump],input,()=>enabled);
  const event=id=>({pointerId:id,preventDefault(){}});
  right.handlers.pointerdown(event(1)); jump.handlers.pointerdown(event(2));
  assert.equal(right.capture,1); assert.equal(input.move,1); assert(input.held('jump'));
  right.handlers.pointerup(event(1)); assert.equal(input.move,0); assert(input.held('jump'));
  jump.handlers.pointercancel(event(2)); assert(!input.held('jump'));
  right.handlers.pointerdown(event(3)); right.handlers.lostpointercapture(event(3));
  assert.equal(input.move,0);
  enabled=false; right.handlers.pointerdown(event(4)); assert.equal(input.move,0);
});

test('sequential unlock, replay, persistence, corrupt/denied storage, reset', () => {
  const data=new Map(); const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  let progress=new Progress(storage,10); assert.equal(progress.unlocked,1);
  for(let i=0;i<10;i++){progress.complete(i,100*i);assert.equal(progress.unlocked,Math.min(10,i+2));}
  progress.complete(0,0); assert.equal(progress.unlocked,10);
  progress=new Progress(storage,10); assert.equal(progress.unlocked,10); assert.equal(progress.best,900);
  progress.reset(); assert.equal(new Progress(storage,10).unlocked,1);
  data.set('coinRunnerProgress','broken'); assert.equal(new Progress(storage,10).unlocked,1);
  data.set('coinRunnerProgress',JSON.stringify({version:1,unlocked:999,best:-4}));
  assert.equal(new Progress(storage,10).unlocked,10);
  progress=new Progress(null,10); progress.complete(0,20); assert.equal(progress.unlocked,2);
});

test('moving platform supports/carries player; timed hazards cycle; ice brakes gradually', () => {
  const w=new World(LEVELS[4]); const m=w.movers[0];
  w.player.x=m.x+20; w.player.y=m.y-38; w.player.onGround=true;
  const before=w.player.x; w.update(1/60,0,false,false);
  assert(w.player.x>before); assert.equal(w.player.y,m.y-38); assert(w.player.onGround);
  const flame=new World(LEVELS[6]); flame.updateFeatures(0); assert(!flame.hazards[0].active);
  flame.time=2;flame.updateFeatures(0);assert(flame.hazards[0].active);
  const ice=new World(LEVELS[5]);ice.player.onGround=true;ice.player.vx=260;
  ice.update(1/60,0,false,false);assert(ice.player.vx>0 && ice.player.vx<260);
});

test('every recorded route completes in the actual browser physics', () => {
  const runs=JSON.parse(readFileSync(new URL('./browser-replays.json',import.meta.url)));
  for(const level of LEVELS){
    assert(runs[level.name],`Missing route: ${level.name}`);
    const w=new World(level);
    for(const [count,move,pressed,held] of runs[level.name])
      for(let i=0;i<count;i++)w.update(1/60,move,Boolean(pressed)&&i===0,Boolean(held));
    assert.equal(w.status,'complete',`${level.name}: x=${w.player.x}, lives=${w.lives}`);
  }
});

test('a full ten-stage campaign carries score and lives through to victory', () => {
  const runs=JSON.parse(readFileSync(new URL('./browser-replays.json',import.meta.url)));
  let score=0,lives=3;
  for(const level of LEVELS){
    const w=new World(level,score,lives);
    for(const [count,move,pressed,held] of runs[level.name])
      for(let i=0;i<count;i++)w.update(1/60,move,Boolean(pressed)&&i===0,Boolean(held));
    assert.equal(w.status,'complete',level.name);
    assert(w.score>score); score=w.score;lives=w.lives;
  }
  assert(lives>0);
});

test('HTML and module asset references resolve locally', () => {
  const html=readFileSync('docs/index.html','utf8');
  for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) assert(existsSync(`docs/${match[1]}`),match[1]);
  for(const file of ['game','world','levels','input','progress']) {
    const js=readFileSync(`docs/js/${file}.js`,'utf8');
    for(const match of js.matchAll(/from '\.\/([^']+)'/g))assert(existsSync(`docs/js/${match[1]}`));
  }
});
