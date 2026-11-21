import { DAY } from './species.js';
import { pool } from './nutrition.js';
export function createAnt(id,type,cell,world,p,initial=true) {
 const q=type==='queen',r=world.random;
 return {id,type,alive:true,...world.center(cell),angle:0,distance:0,age:initial&&!q?r()*60*DAY:0,
  lifespan:(q?5000:p.workerLifeDays)*DAY*(.7+.6*r()),crop:pool(initial?(q?60:35):0,initial?(q?12:2):0),
  reserve:pool(initial?(q?1800:18):0,initial?(q?450:0):0),body:pool(initial?12:0,initial?12:0),
  thresholds:{forage:.2+.6*r(),nurse:.2+.6*r(),dig:.2+.6*r()},
  task:null,behaviour:'rest',timer:0,moveBudget:0,walk:[cell],returnPath:[],memory:[],outbound:[],
  heading:null,awaySeconds:0,exitMemory:[],disposalRoute:[],carryingBrood:null,soil:0,corpse:null,contact:null,stimuli:{},experience:0,starved:0};
}
// Loop-erased personal odometry. No map or food locations supplied by the colony.
export function rememberStep(ant,cell){const n=ant.walk.indexOf(cell);if(n>=0)ant.walk.length=n+1;else ant.walk.push(cell);}
export function spatialIndex(ants,cell){const map=new Map();for(const a of ants)if(a.alive){const i=cell(a);if(!map.has(i))map.set(i,[]);map.get(i).push(a);}return map;}
