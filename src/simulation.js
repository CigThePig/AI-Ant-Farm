import { World } from './world.js';
import { OPEN, SOIL } from './navigation.js';
import { DAY, parameters, developmentRate } from './species.js';
import { pool, transfer, total } from './nutrition.js';
import { createAnt, rememberStep, spatialIndex } from './agents.js';
export const TASKS=['explore','forage','return','share','nurse','transport','dig','soil','clean','rest'];
export class Simulation {
 constructor(options={}) {
  this.options={workers:12,scenario:'established',resources:true,laying:true,...options};
  if(!Number.isInteger(this.options.workers)||this.options.workers<0||this.options.workers>10000)throw new RangeError('Invalid workers');
  if(!['established','founding'].includes(this.options.scenario))throw new RangeError('Invalid scenario');
  this.p=parameters(options.parameters);this.world=new World(this.options);this.time=0;this.tick=0;this.nextId=1;
  this.ants=[];this.brood=[];this.corpses=[];this.events=[];this.history=[];this.interactions=[];this.interventions=[];
  this.metrics={births:0,laid:0,fed:0,deaths:0,broodDeaths:0,dug:0,gathered:0,delivered:0,cleaned:0,discovered:0,contacts:0,depositions:0,transported:0};
  this.outputs=pool();this.outputCorrection=pool();this.inputs=pool();this.layTimer=0;this.environmentTimer=0;this.historyTimer=0;
  this.queen=this.spawnAnt('queen',this.world.chamber);
  if(this.options.scenario!=='founding')for(let i=0;i<this.options.workers;i++)this.spawnAnt('worker',this.world.chamber);
  this.inputs=this.inventory();
  this.note(this.options.scenario==='founding'?'Single mated queen in a sealed cavity; reserve-funded founding.':'Young established colony; 12 workers is not the founding moment.');
 }
 spawnAnt(type,cell,initial=true){const a=createAnt(this.nextId++,type,cell,this.world,this.p,initial);this.ants.push(a);return a;}
 livingWorkers(){return this.ants.filter(a=>a.alive&&a.type==='worker');}
 cell(a){return this.world.cell(a.x,a.y);}
 note(message){this.events.push({time:this.time,message});if(this.events.length>60)this.events.shift();}
 metabolize(amount){
  // Compensated summation prevents millions of tiny maintenance debits from
  // accumulating a false mass-conservation failure in long-duration runs.
  const corrected=amount-this.outputCorrection.c,next=this.outputs.c+corrected;
  this.outputCorrection.c=(next-this.outputs.c)-corrected;this.outputs.c=next;
 }
 disposalPath(a){
  if(!a.exitMemory.length)return [];
  let common=a.walk.length-1;while(common>=0&&!a.exitMemory.includes(a.walk[common]))common--;
  if(common<0)return [];
  return [...a.walk.slice(common,-1).reverse(),...a.exitMemory.slice(a.exitMemory.indexOf(a.walk[common])+1)];
 }
 inventory(){
  const w=this.world,items=[pool(w.food.reduce((a,b)=>a+b,0),w.protein.reduce((a,b)=>a+b,0))];
  for(const a of this.ants)if(a.alive)items.push(a.crop,a.reserve,a.body);
  for(const b of this.brood)items.push(b.body);
  for(const c of this.corpses)items.push(c.nutrients);
  return total(items);
 }
 addFood(cell,c,p=0,quality=1){
  if(this.world.grid[cell]!==OPEN||![c,p,quality].every(Number.isFinite)||c<0||p<0||quality<=0)throw new RangeError('Invalid resource');
  this.world.food[cell]+=c;this.world.protein[cell]+=p;this.world.quality[cell]=quality;this.world.sources.add(cell);
  this.inputs.c+=c;this.inputs.p+=p;this.interventions.push({time:this.time,kind:'addFood',cell,c,p,quality});
 }
 eraseTrails(){this.world.trail.fill(0);this.interventions.push({time:this.time,kind:'eraseTrails'});}
 setParameter(key,value){this.p=parameters({...this.p,[key]:value});if(key==='memoryEnabled'&&!value)for(const a of this.ants){a.memory=[];a.outbound=[];}this.interventions.push({time:this.time,kind:'parameter',key,value});}
 cancelTask(a){
  if(a.carryingBrood!==null){const b=this.brood.find(b=>b.id===a.carryingBrood);if(b){b.carrier=null;b.cell=this.cell(a);}a.carryingBrood=null;}
  if(a.corpse!==null){const c=this.corpses.find(c=>c.id===a.corpse);if(c){c.carrier=null;c.cell=this.cell(a);}a.corpse=null;}
  if(a.soil){this.world.depositedSoil[this.cell(a)]+=a.soil;a.soil=0;}
  a.task=null;a.contact=null;
 }
 kill(a){
  if(!a.alive)return;this.cancelTask(a);a.alive=false;
  this.corpses.push({id:a.id,cell:this.cell(a),died:this.time,carrier:null,nutrients:total([a.crop,a.reserve,a.body])});
  this.ants=this.ants.filter(b=>b!==a);this.metrics.deaths++;if(a===this.queen)this.note('Queen died; surviving brood retains its own development state.');
 }
 // The decision boundary sees only current/adjacent cells and physical encounters.
 sense(a){
  const w=this.world,cell=this.cell(a),cells=[cell,...w.adjacent(cell)];
  return {cell,cells,open:w.adjacent(cell).filter(i=>w.grid[i]===OPEN),
   food:cells.filter(i=>w.grid[i]===OPEN&&(w.food[i]>0||w.protein[i]>0)),
   trail:w.adjacent(cell).filter(i=>w.grid[i]===OPEN).map(i=>({cell:i,value:this.p.trailsEnabled?w.trail[i]:0})),
   peers:(this.spatial.get(cell)||[]).filter(b=>b!==a&&b.alive),
   brood:this.brood.filter(b=>b.carrier===null&&b.cell===cell),
   corpses:this.corpses.filter(c=>c.carrier===null&&c.cell===cell&&this.time-c.died>=this.p.corpseCueSeconds),
   soil:w.adjacent(cell).filter(i=>w.grid[i]===SOIL&&Math.floor(i/w.width)>=w.surface),
   temperatureC:this.temperature(cell),moisture:this.p.soilMoisture};
 }
 temperature(cell){const depth=Math.max(0,Math.floor(cell/this.world.width)-this.world.surface);return 23+(this.p.temperatureC-23)*Math.exp(-depth/12);}
 behaviour(a,kind){a.behaviour=kind;a.task={kind,path:[],cursor:0};}
 moveTo(a,next){
  const w=this.world,from=this.cell(a);
  if(!w.adjacent(from).includes(next)||w.grid[next]!==OPEN)return false;
  const peers=this.spatial.get(next)||[];
  // Soft congestion rather than exclusive cells (several real ants fit a 2D patch).
  if(peers.length>2&&w.random()<1-2/peers.length)return false;
  const pos=w.center(next);a.angle=Math.atan2(pos.y-a.y,pos.x-a.x);Object.assign(a,pos);a.distance++;
  const old=this.spatial.get(from);if(old)old.splice(old.indexOf(a),1);
  if(!this.spatial.has(next))this.spatial.set(next,[]);this.spatial.get(next).push(a);
  rememberStep(a,next);a.heading=next-from;
  if(Math.floor(from/w.width)>=w.surface&&Math.floor(next/w.width)<w.surface)a.exitMemory=[...a.walk];
  if(a.carryingBrood!==null){const b=this.brood.find(b=>b.id===a.carryingBrood);if(b)b.cell=next;}
  if(a.corpse!==null){const c=this.corpses.find(c=>c.id===a.corpse);if(c)c.cell=next;}
  return true;
 }
 startReturn(a){a.returnPath=a.walk.slice(0,-1).reverse();this.behaviour(a,'return');}
 transferFood(donor,receiver,amount){
  if(!donor.alive||!receiver.alive||donor===receiver||this.cell(donor)!==this.cell(receiver))return 0;
  let moved=0;for(const k of ['c','p'])moved+=transfer(donor.crop,receiver.crop,k,Math.min(amount,Math.max(0,(donor.crop[k]-receiver.crop[k])/2)),k==='c'?this.p.cropC:this.p.cropP);
  return moved;
 }
 share(a,s,dt){
  const b=s.peers.find(b=>a.crop.c-b.crop.c>15||a.crop.p-b.crop.p>5);
  if(!b){a.contact=null;return false;}
  this.behaviour(a,'share');
  if(a.contact?.id!==b.id)a.contact={id:b.id,seconds:0};a.contact.seconds+=dt;
  if(a.contact.seconds>=this.p.contactSeconds){
   const before={...b.crop};const moved=this.transferFood(a,b,this.p.transferPerSecond*dt);
   if(moved){this.metrics.delivered+=moved;if(!a.contact.recorded){this.metrics.contacts++;a.contact.recorded=true;}this.interactions.push({time:this.time,donor:a.id,receiver:b.id,cell:s.cell,amount:moved,c:b.crop.c-before.c,p:b.crop.p-before.p});if(this.interactions.length>1000)this.interactions.shift();}
  }
  return true;
 }
 feedBrood(a,b,dt,founding=false){
  if(b.stage!=='larva'||b.carrier!==null||b.cell!==this.cell(a))return false;
  const from=founding?a.reserve:a.crop;let amount=0;
  for(const k of ['c','p']) amount+=transfer(from,b.body,k,this.p.transferPerSecond*dt,k==='c'?this.p.larvalTargetC:this.p.larvalTargetP);
  if(amount){this.metrics.fed++;b.lastFed=this.time;this.behaviour(a,'nurse');return true;}return false;
 }
 chooseMove(a,s){
  const w=this.world;
  const known=a.outbound[0];
  if(known!==undefined){
   if(s.open.includes(known)){a.outbound.shift();return known;}
   a.outbound=[];a.memory=[];
  }
  const food=s.food.filter(i=>s.open.includes(i));if(food.length)return food[0];
  const weights=s.open.map(i=>{
   const forward=i-s.cell===a.heading?2.5:1;
   const back=a.walk.length>1&&i===a.walk.at(-2)? .15:1;
   const trail=this.p.trailsEnabled?w.trail[i]:0;
   // Saturating local response. Concentration is not a distance-to-food oracle.
   return forward*back*(1+this.p.trailGain*trail/(1+trail));
  });
  let draw=w.random()*weights.reduce((a,b)=>a+b,0);
  for(let j=0;j<s.open.length;j++){draw-=weights[j];if(draw<=0)return s.open[j];}
  return s.open.at(-1);
 }
 updateWorker(a,dt){
  const s=this.sense(a),w=this.world;
  if(s.cell===w.chamber)a.awaySeconds=0;else a.awaySeconds+=dt;
  if(a.contact&&!s.peers.some(b=>b.id===a.contact.id))a.contact=null;
  a.stimuli={cell:s.cell,food:s.food,trail:s.trail,encounters:s.peers.map(b=>b.id),brood:s.brood.map(b=>b.id),
   localCrowding:s.peers.length,soil:s.soil,temperatureC:s.temperatureC,moisture:s.moisture};
  // Cargo transports use the ant's own recorded trajectory; interrupted cargo stays physical.
  if(a.corpse!==null||a.soil){
   this.behaviour(a,a.soil?'soil':'clean');
   if(Math.floor(s.cell/w.width)<w.surface){
    if(a.soil){w.depositedSoil[s.cell]+=a.soil;a.soil=0;}
    if(a.corpse!==null){const c=this.corpses.find(c=>c.id===a.corpse);if(c){c.cell=s.cell;c.carrier=null;}a.corpse=null;this.metrics.cleaned++;}
   }else if(a.moveBudget>=1){
    const next=a.disposalRoute[0]??this.chooseMove(a,{...s,food:[]});
    if(next!==undefined&&this.moveTo(a,next)){a.moveBudget--;if(a.disposalRoute[0]===next)a.disposalRoute.shift();}
   }
   return;
  }
  if(a.carryingBrood!==null){this.cancelTask(a);this.metrics.transported++;return;}
  if(a.returnPath.length){
   this.behaviour(a,'return');
   if(a.moveBudget>=1){
    const next=a.returnPath[0];if(this.moveTo(a,next)){
     a.returnPath.shift();a.moveBudget--;
     if(this.p.trailsEnabled&&a.successQuality>0){w.trail[this.cell(a)]+=this.p.trailDeposit*a.successQuality;this.metrics.depositions++;}
    }else if(w.grid[next]!==OPEN)a.returnPath=[];
   }
   return;
  }
  if(a.behaviour==='return'){a.outbound=[];a.successQuality=0;this.behaviour(a,'rest');}
  if(s.corpses.length&&Math.floor(s.cell/w.width)>=w.surface){const c=s.corpses[0];a.corpse=c.id;c.carrier=a.id;a.disposalRoute=this.disposalPath(a);this.behaviour(a,'clean');return;}
  if(a.walk.length>1&&a.awaySeconds>300+600*a.thresholds.forage){a.successQuality=0;this.startReturn(a);return;}
  const hungry=s.brood.find(b=>b.stage==='larva'&&(b.body.c<this.p.larvalTargetC||b.body.p<this.p.larvalTargetP));
  if(hungry&&w.random()<Math.max(1-hungry.body.c/this.p.larvalTargetC,1-hungry.body.p/this.p.larvalTargetP)/(a.thresholds.nurse+.01)&&this.feedBrood(a,hungry,dt))return;
  const badBrood=s.brood.find(b=>Math.abs(s.temperatureC-23)>2);
  if(badBrood){const better=s.open.find(i=>Math.abs(this.temperature(i)-23)+.01<Math.abs(s.temperatureC-23));
   if(better!==undefined&&a.moveBudget>=1){badBrood.carrier=a.id;a.carryingBrood=badBrood.id;this.behaviour(a,'transport');if(this.moveTo(a,better))a.moveBudget--;return;}}
  if(Math.floor(s.cell/w.width)>=w.surface&&this.share(a,s,dt))return;
  if(w.food[s.cell]>0||w.protein[s.cell]>0){
   this.behaviour(a,'forage');const crowd=1+s.peers.length,rate=this.p.uptakePerSecond*dt/crowd;
   const c=Math.min(w.food[s.cell],rate,Math.max(0,this.p.cropC-a.crop.c));
   const p=Math.min(w.protein[s.cell],rate/2,Math.max(0,this.p.cropP-a.crop.p));
   w.food[s.cell]-=c;w.protein[s.cell]-=p;a.crop.c+=c;a.crop.p+=p;this.metrics.gathered+=c+p;
   if(!a.atSource){a.atSource=true;this.metrics.discovered++;a.experience++;if(this.p.memoryEnabled)a.memory=[...a.walk];}
   a.timer+=dt;
   if(a.crop.c>=this.p.cropC*.9||a.crop.p>=this.p.cropP*.9||a.timer>60||c+p===0){
    a.successQuality=(c+p>0?w.quality[s.cell]:0)/crowd;a.timer=0;a.atSource=false;this.startReturn(a);
   }
   return;
  }
  // Abandon stale route memory only after personally finding its source depleted.
  if(a.memory.at(-1)===s.cell&&!w.food[s.cell]&&!w.protein[s.cell]){a.memory=[];a.outbound=[];}
  if(a.crop.c>this.p.cropC*.7&&Math.floor(s.cell/w.width)<w.surface){this.startReturn(a);return;}
  if(s.cell===w.chamber&&this.p.memoryEnabled&&a.memory.length>1&&a.crop.c<this.p.cropC*.65)a.outbound=a.memory.slice(1);
  const ageTendency=.35+.3*Math.min(1,a.age/(60*DAY)); // provisional, reversible bias
  const foraging=(1-a.crop.c/this.p.cropC)*ageTendency;
  if(s.soil.length&&s.peers.length>1&&s.cell!==w.entrance&&a.thresholds.dig<.65&&foraging<a.thresholds.forage&&Math.floor(s.cell/w.width)>=w.surface){
   this.behaviour(a,'dig');const target=s.soil[Math.floor(w.random()*s.soil.length)];
   const moisture=4*s.moisture*(1-s.moisture);
   w.soilWork[target]+=dt*moisture/this.p.soilHardness;
   if(w.soilWork[target]>=this.p.diggingSeconds&&w.dig(target)){a.soil=1;a.disposalRoute=this.disposalPath(a);this.metrics.dug++;}
   return;
  }
  if(a.restUntil>this.time){this.behaviour(a,'rest');return;}
  if(s.cell===w.chamber&&!a.outbound.length&&w.random()<.01&&foraging<a.thresholds.forage){a.restUntil=this.time+30+w.random()*90;this.behaviour(a,'rest');return;}
  this.behaviour(a,a.outbound.length?'forage':'explore');
  if(a.moveBudget>=1){const next=this.chooseMove(a,s);if(next!==undefined&&this.moveTo(a,next))a.moveBudget--;}
 }
 layEgg(){
  const q=this.queen,p=this.p;if(!q.alive)return null;
  const available=total([q.crop,q.reserve]);if(available.c<p.eggC||available.p<p.eggP)return null;
  const b={id:this.nextId++,cell:this.cell(q),stage:'egg',age:0,stageAge:0,body:pool(),carrier:null,lastFed:this.time,stress:0};
  for(const [k,need] of [['c',p.eggC],['p',p.eggP]]){const n=transfer(q.crop,b.body,k,need);transfer(q.reserve,b.body,k,need-n);}
  this.brood.push(b);this.metrics.laid++;return b;
 }
 updateBrood(dt){
  const p=this.p,remove=new Set();
  for(const b of this.brood){
   b.age+=dt;const temperature=this.temperature(b.cell),rate=developmentRate(temperature);
   const fed=b.stage!=='larva'||(b.body.c>=p.larvalTargetC&&b.body.p>=p.larvalTargetP);
   if(fed)b.stageAge+=dt*rate;
   b.stress=rate===0||(!fed&&this.time-b.lastFed>3*DAY)?b.stress+dt:Math.max(0,b.stress-dt);
   if(b.stress>7*DAY){remove.add(b.id);this.corpses.push({id:b.id,cell:b.cell,died:this.time,carrier:null,nutrients:b.body});this.metrics.broodDeaths++;continue;}
   const days=b.stage==='egg'?p.eggDays:b.stage==='larva'?p.larvaDays:p.pupaDays;
   if(b.stageAge>=days*DAY){
    b.stageAge=0;
    if(b.stage==='egg')b.stage='larva';else if(b.stage==='larva')b.stage='pupa';else{
     const a=this.spawnAnt('worker',b.cell,false);a.body=b.body;this.metrics.births++;remove.add(b.id);
     // Opening the existing entrance is an explicit scenario transition, not a worker assignment.
     if(this.options.scenario==='founding'&&this.world.grid[this.world.entrance]!==OPEN){this.world.grid[this.world.entrance]=OPEN;this.world.version++;this.note('First worker emerged; founding seal opened (scenario boundary).');}
    }
   }
  }
  for(const a of this.ants)if(remove.has(a.carryingBrood))this.cancelTask(a);
  this.brood=this.brood.filter(b=>!remove.has(b.id));
 }
 physiology(dt){
  const p=this.p;
  for(const a of this.ants){
   if(!a.alive)continue;a.age+=dt;
   let need=(a.type==='queen'?p.queenMetabolismCPerDay:p.metabolismCPerDay)*dt/DAY;
   const eaten=Math.min(a.crop.c,need);a.crop.c-=eaten;need-=eaten;this.metabolize(eaten);
   const reserve=Math.min(a.reserve.c,need);a.reserve.c-=reserve;need-=reserve;this.metabolize(reserve);
   const rate=(a.type==='queen'?p.queenMetabolismCPerDay:p.metabolismCPerDay)/DAY;
   a.starved=need>1e-12?(eaten+reserve>0?0:a.starved)+need/rate:0;
   if(a.starved>2*DAY||a.age>=a.lifespan)this.kill(a);
  }
  const q=this.queen;
  if(q.alive){
   // Queen personally nurses her first larvae using physiological reserves.
   if(this.options.scenario==='founding'&&!this.livingWorkers().length)for(const b of this.brood)this.feedBrood(q,b,dt,true);
   this.layTimer+=dt;
   if(this.options.laying&&this.time>=p.foundingDelayDays*DAY&&this.layTimer>=p.eggIntervalDays*DAY){
    if(this.layEgg())this.layTimer=0;
   }
  }
  this.updateBrood(dt);
 }
 step(dt=1){
  if(!Number.isFinite(dt)||dt<=0||dt>1)throw new RangeError('Steps must be in (0,1] biological seconds.');
  this.time+=dt;this.tick++;this.physiology(dt);
  this.spatial=spatialIndex(this.ants,a=>this.cell(a));
  // Rotate iteration priority to avoid permanent low-ID access advantages.
  const workers=this.livingWorkers(),offset=workers.length?this.tick%workers.length:0;
  for(let j=0;j<workers.length;j++){
   const a=workers[(j+offset)%workers.length];
   const familiar=a.outbound.length&&this.p.trailsEnabled&&this.world.trail[this.cell(a)]>.05;
   a.moveBudget=Math.min(2,a.moveBudget+dt*this.p.walkMMPerSecond/this.p.cellMM*(familiar?this.p.memorySynergy:1));
   this.updateWorker(a,dt);
  }
  this.ants=this.ants.filter(a=>a.alive);
  this.environmentTimer+=dt;if(this.environmentTimer>=10){this.world.decay(this.environmentTimer,this.p);this.environmentTimer=0;}
  this.historyTimer+=dt;if(this.historyTimer>=60){this.history.push(this.snapshot());if(this.history.length>1440)this.history.shift();this.historyTimer=0;}
 }
 snapshot(){
  const workers=this.livingWorkers();
  return {seed:this.world.seed,time:this.time,days:this.time/DAY,workers:workers.length,queenAlive:this.queen.alive,
   scenario:this.options.scenario,food:this.ants.reduce((n,a)=>n+a.crop.c,0),brood:this.brood.length,corpses:this.corpses.length,
   jobs:workers.reduce((r,a)=>{r[a.behaviour]=(r[a.behaviour]||0)+1;return r;},{}),
   metrics:{...this.metrics},ledger:{inputs:{...this.inputs},outputs:{...this.outputs},inventory:this.inventory()},
   architecture:{excavatedCells:this.world.excavated,maxDepthMM:this.world.grid.reduce((d,v,i)=>v===OPEN?Math.max(d,(Math.floor(i/this.world.width)-this.world.surface)*this.p.cellMM):d,0)}};
 }
 inspect(){
  const errors=[],w=this.world,ids=new Set();
  for(const a of this.ants){
   if(ids.has(a.id))errors.push(`Duplicate ${a.id}`);ids.add(a.id);
   if(!a.alive||![a.x,a.y,a.age,a.moveBudget].every(Number.isFinite)||w.grid[this.cell(a)]!==OPEN)errors.push(`Invalid ant ${a.id}`);
   for(const v of [a.crop,a.reserve,a.body])if(![v.c,v.p].every(x=>Number.isFinite(x)&&x>=-1e-8))errors.push(`Invalid physiology ${a.id}`);
   if(a.crop.c>this.p.cropC+1e-8||a.crop.p>this.p.cropP+1e-8)errors.push(`Crop capacity ${a.id}`);
   for(const [key,list] of [['carryingBrood',this.brood],['corpse',this.corpses]])if(a[key]!==null&&!list.some(b=>b.id===a[key]&&b.carrier===a.id&&b.cell===this.cell(a)))errors.push(`Dangling cargo ${a.id}`);
  }
  for(const b of [...this.brood,...this.corpses]){
   if(w.grid[b.cell]!==OPEN)errors.push(`Invalid item ${b.id}`);
   if(b.carrier!==null&&!this.ants.some(a=>a.id===b.carrier&&(a.carryingBrood===b.id||a.corpse===b.id)))errors.push(`Orphan carrier ${b.id}`);
   const v=b.body||b.nutrients;if(![v.c,v.p].every(x=>Number.isFinite(x)&&x>=-1e-8))errors.push(`Invalid biomass ${b.id}`);
  }
  for(const f of [w.food,w.protein,w.trail,w.depositedSoil])for(const v of f)if(!Number.isFinite(v)||v< -1e-8){errors.push('Invalid field');break;}
  const inventory=this.inventory();for(const k of ['c','p'])if(Math.abs(this.inputs[k]-this.outputs[k]-inventory[k])>1e-5)errors.push(`Nutrient ledger ${k}: ${this.inputs[k]-this.outputs[k]-inventory[k]}`);
  const soil=w.depositedSoil.reduce((a,b)=>a+b,0)+this.ants.reduce((a,b)=>a+b.soil,0);
  if(Math.abs(soil-w.excavated)>1e-8)errors.push('Soil ledger');
  return errors;
 }
 report(){return {version:3,species:this.p.id,initialOptions:this.options,parameters:this.p,snapshot:this.snapshot(),checks:this.inspect(),interventions:this.interventions,history:this.history,interactions:this.interactions,events:this.events};}
}
