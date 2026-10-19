// Look ahead using the real browser World, including platforms, ice and timed traps.
import { World } from '../docs/js/world.js';
import { LEVELS } from '../docs/js/levels.js';
import { readFileSync, writeFileSync } from 'node:fs';
const plans=[];
for(const run of [75,40,28,20,12]) for(const hold of [0,5,10,16,24,40])
  plans.push(Array.from({length:75},(_,i)=>[Number(i<run),hold>0&&i===0,i<hold]));
plans.push(Array.from({length:75},()=>[0,false,false]));
for(const retreat of [8,16,24]) for(const hold of [16,24,40])
  plans.push(Array.from({length:75},(_,i)=>[i<retreat?-1:1,i===retreat,i>=retreat&&i<retreat+hold]));
for(const delay of [6,12,18,24,32,40,48,60]) for(const hold of [10,24,40])
  plans.push(Array.from({length:75},(_,i)=>[1,i===delay,i>=delay&&i<delay+hold]));
function clone(w) {
  return Object.assign(Object.create(World.prototype),w,{
    player:{...w.player}, enemies:w.enemies.map(e=>({...e})),coins:w.coins.map(c=>({...c})),
    movers:w.movers.map(m=>({...m})),hazards:w.hazards.map(h=>({...h})),
  });
}
function grade(start,plan){
  const w=clone(start);
  for(const action of plan){w.update(1/60,...action);if(w.status!=='playing')break;}
  if(w.status==='complete')return 1e6-w.time;
  if(w.lives<start.lives||w.status==='game_over')return -1e5+w.player.x;
  return w.player.x+3*(w.coinsCollected-start.coinsCollected)+(w.player.onGround?20:0);
}
const result=process.argv.includes('--resume')?JSON.parse(readFileSync(new URL('../tests/browser-replays.json',import.meta.url))):{};
for(const level of LEVELS){
  if(result[level.name])continue;
  const w=new World(level);let active=[],frame=0;const packed=[];
  while(w.status==='playing'&&w.time<150){
    if(!active.length||(w.player.onGround&&frame%6===0&&active.length<73)){
      let best=-Infinity;
      for(const plan of plans){const value=grade(w,plan);if(value>best){best=value;active=plan.slice();}}
    }
    const action=active.shift();w.update(1/60,...action);frame++;
    const last=packed.at(-1);
    if(last&&last.slice(1).every((v,i)=>v===action[i]))last[0]++;
    else packed.push([1,...action]);
  }
  console.log(`${level.name}: ${w.status}, ${w.time.toFixed(1)}s, ${w.lives} lives`);
  if(w.status!=='complete'){console.log(w.player);process.exit(1);}
  result[level.name]=packed;
  writeFileSync(new URL('../tests/browser-replays.json',import.meta.url),JSON.stringify(result));
}
writeFileSync(new URL('../tests/browser-replays.json',import.meta.url),JSON.stringify(result));
