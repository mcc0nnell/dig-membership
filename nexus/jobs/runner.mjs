import {readFileSync} from 'node:fs';
import {createNeonClient} from '../api/database.mjs';
import {createJobQueue,executeNext} from './queue.mjs';

// Separate opt-in process, not part of the web request handler.
// It cannot send mail, run payments, touch accessibility requests or execute arbitrary jobs.
if(process.env.NEXUS_JOB_WORKER_ENABLED!=='true'){
 console.error('Nexus jobs disabled: NEXUS_JOB_WORKER_ENABLED must be true');
 process.exitCode=2;
}else{
 const urlFile=process.env.DATABASE_URL_FILE;
 if(!urlFile||process.env.DATABASE_URL)throw Error('Use only DATABASE_URL_FILE for the worker');
 const url=readFileSync(urlFile,'utf8').trim();
 const client=await createNeonClient({DATABASE_URL:url});
 const queue=createJobQueue(client);
 const once=process.argv.includes('--once');
 let running=true;
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{running=false;});
 do{
  const outcome=await executeNext(queue,{onResult:({task,counts})=>
   console.log(JSON.stringify({task,outcome:'completed',counts}))});
  if(outcome.kind==='dead')console.error('Job attempts exhausted');
  if(outcome.kind==='lease_lost')console.error('Job lease lost; not acknowledging success');
  if(!once&&running)await new Promise(resolve=>setTimeout(resolve,10000));
 }while(running&&!once);
}
