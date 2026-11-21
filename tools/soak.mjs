import { Simulation } from '../src/simulation.js';
import { performance } from 'node:perf_hooks';
const args=process.argv.slice(2),seconds=Number(args.find(x=>x.startsWith('--seconds='))?.split('=')[1]||86400);
const seeds=(args.find(x=>x.startsWith('--seeds='))?.split('=')[1]||'1,42,1337').split(',').map(Number);
for(const seed of seeds){
 const s=new Simulation({seed}),start=performance.now();let checks=0;
 for(let i=0;i<seconds;i++){s.step();if(i%300===0){const errors=s.inspect();if(errors.length)throw Error(`${seed} at ${s.time}: ${errors}`);checks++;}}
 const errors=s.inspect();if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({...s.snapshot(),invariantChecks:checks,wallMs:Math.round(performance.now()-start)}));
 // Colony extinction is a measured biological outcome, never hidden or rejected as a software failure.
}
