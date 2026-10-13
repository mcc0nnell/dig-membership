import {loadDockerConfig} from './config.mjs';
import {createNeonClient} from '../api/database.mjs';
import {createTicketingDb} from '../api/ticketing-db.mjs';
import {sendTransactionEmail} from '../api/ntc-providers.mjs';
// Optional Compose sidecar. One worker claims one notice atomically per pass.
// Never blindly retry ambiguous provider sends: leave them in manual-review state.
const {config}=loadDockerConfig();
if(config.DIG_TRANSACTIONAL_EMAIL_ENABLED!=='true'){
 process.stderr.write('Transactional email is disabled\n');process.exitCode=2;
}else{
 const mode=config.MAILER_MODE==='loop'?'loop':'once';
 const seconds=Number(config.MAILER_INTERVAL_SECONDS||60);
 if(!Number.isSafeInteger(seconds)||seconds<30||seconds>3600)throw Error('Invalid mail interval');
 const db=createTicketingDb(await createNeonClient(config));
 const deliver=async()=>{
  const job=await db.claimMail();
  if(!job)return false;
  let accepted=false,messageId=null;
  try{const r=await sendTransactionEmail(config,job);accepted=r.accepted;messageId=r.messageId??null;}
  catch{process.stderr.write('Provider send uncertain; mail needs manual review\n');}
  await db.completeMail(job.notificationId,accepted,messageId);
  process.stdout.write(accepted?'Provider accepted a transactional email\n':'A mail notice requires manual review\n');
  return true;
 };
 if(mode==='once')await deliver();
 else{
  for(;;){
   try{await deliver();}catch{process.stderr.write('Mail database unavailable; retrying later\n');}
   await new Promise(resolve=>setTimeout(resolve,seconds*1000));
  }
 }
}
