// Full spatial lifecycle, one-second updates. No accelerated physiology shortcut.
import { Simulation } from '../src/simulation.js';
import { writeFile, mkdir } from 'node:fs/promises';
const args=process.argv.slice(2),days=Number(args.find(x=>x.startsWith('--days='))?.split('=')[1]||70),seed=Number(args.find(x=>x.startsWith('--seed='))?.split('=')[1]||42);
if(!Number.isInteger(days)||days<=0||!Number.isInteger(seed)||seed<0)throw Error('Use positive integer days and a nonnegative integer seed.');
const s=new Simulation({seed}),daily=[];let checks=0;const start=performance.now();
for(let day=1;day<=days;day++){
 for(let t=0;t<86400;t++){s.step();if(t%3600===0){const errors=s.inspect();if(errors.length)throw Error(errors);checks++;}}
 daily.push(s.snapshot());if(day%10===0)console.log(JSON.stringify({day,workers:s.livingWorkers().length,brood:s.brood.length,queen:s.queen.alive,births:s.metrics.births}));
}
await mkdir('docs/validation',{recursive:true});
await writeFile(`docs/validation/spatial-${days}-days.json`,JSON.stringify({seed,days,invariantChecks:checks,wallMs:performance.now()-start,daily},null,2)+'\n');
