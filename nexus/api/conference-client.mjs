export const CONFERENCE_CLIENT=String.raw`
const slug=document.body.dataset.event;
const base='/api/conference/'+encodeURIComponent(slug);
const byId=id=>document.getElementById(id);
const say=msg=>{byId('feedback').textContent=msg;};
let self=null,agenda=null;
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;};
async function api(path,method='GET',data){
 const options={method,credentials:'same-origin'};
 if(method!=='GET'){options.headers={'content-type':'application/json'};options.body=JSON.stringify(data);}
 const r=await fetch(base+path,options);
 if(!r.ok){const code=(await r.json().catch(()=>({}))).error;
  if(r.status===401)throw Error('Sign in using Google or an email magic link above, then return here.');
  if(r.status===409)throw Error('Identity conflict: ask the conference organizer for account help.');
  throw Error('Request not completed ('+(code||r.status)+').');}
 return r.json();
}
const run=async(task)=>{try{await task();}catch(e){say(e.message);}};
function render(){
 const status=byId('enrollment-status');status.replaceChildren();
 const active=self&&['registered','waitlisted'].includes(self.status);
 if(self){status.append(el('p','Status: '+self.status),el('p','Confirmation reference: '+self.confirmationReference),el('p','Verified email: '+self.email));}
 else status.append(el('p','No conference registration is associated with this signed-in identity.'));
 byId('register-form').hidden=!!active;
 byId('cancel-event').hidden=!active;
 byId('access-form').hidden=!active;
 byId('create-qr').hidden=self?.status!=='registered';
 byId('payment-recovery').hidden=self?.status!=='registered';
 const note=byId('access-note');note.value=self?.accessibilityRequest??'';
 const workshops=byId('workshops');workshops.replaceChildren();
 const booked=new Map((self?.workshops||[]).map(w=>[w.slug,w.status]));
 const choices=(agenda?.sessions||[]).filter(s=>s.kind==='workshop');
 for(const session of choices){
  const item=el('li');item.append(el('strong',session.title));
  const state=booked.get(session.slug);item.append(el('p',state?'Your selection: '+state:(session.room||'Room pending')));
  if(active&&self.status==='registered'){
   const button=el('button',state?'Cancel workshop':'Reserve workshop');button.type='button';
   button.addEventListener('click',()=>run(async()=>{
    const result=await api('/workshops','POST',{sessionSlug:session.slug,action:state?'cancel':'reserve'});
    await reload();say('Workshop '+result.result.status+'.');
   }));item.append(button);
  }
  workshops.append(item);
 }
 if(!choices.length)workshops.append(el('li','No bookable workshops are published yet.'));
}
async function reload(){
 const r=await api('/me');self=r.enrollment;render();await ticketingStatus();
}
async function ticketingStatus(){
 const link=byId('zeffy-payment');link.hidden=true;
 if(self?.status!=='registered')return;
 try{
  const r=await fetch('/api/ticketing/'+encodeURIComponent(slug)+'/payment-link',{credentials:'same-origin'});
  if(!r.ok)return;
  const data=(await r.json()).payment;
  if(data?.provider==='zeffy'&&data.status==='paid'){
   byId('ticket-message').textContent='Payment verified by Zeffy. You can generate your QR credential.';
   return;
  }
  if(data?.provider==='zeffy'&&['refunded','disputed'].includes(data.status)){
   byId('ticket-message').textContent='Payment needs organizer review. QR credentials are unavailable.';
   return;
  }
  if(data?.provider==='zeffy'&&typeof data.url==='string'){
   const url=new URL(data.url);
   if(url.protocol==='https:'&&(/(^|\.)zeffy\.com$/).test(url.hostname)){
    link.href=url.href;link.hidden=false;
    byId('ticket-message').textContent='Zeffy collects payment securely. Return here after payment is verified.';
   }
  }
 }catch{}
}
byId('payment-recovery').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 const paymentId=byId('zeffy-payment-id').value.trim();
 const r=await fetch('/api/ticketing/'+encodeURIComponent(slug)+'/recover',{
  method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
  body:JSON.stringify({paymentId})});
 const data=await r.json();
 if(!r.ok){say(data.error==='buyer_email_mismatch'?'The purchase email does not match this signed-in email. Contact an NTC organizer for manual review.':'Payment could not be verified ('+(data.error||r.status)+').');return;}
 await ticketingStatus();say('Zeffy payment verification: '+data.payment.status+'.');
});});
byId('create-qr').addEventListener('click',()=>run(async()=>{
 if(!confirm('Generate a QR credential? This replaces any previous unused credential.'))return;
 const r=await fetch('/api/ticketing/'+encodeURIComponent(slug)+'/issue',{
  method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'
 });
 const payload=await r.json();
 if(!r.ok)throw Error('QR unavailable ('+(payload.error||r.status)+'). An approved paid registration may be required.');
 const place=byId('qr-display');place.replaceChildren();
 const image=el('img');image.src=payload.qrDataUrl;image.alt='Your private QR check-in credential';image.width=250;image.height=250;
 place.append(el('p','Present this QR at check-in. Keep it private.'));
 place.append(image,el('p','Manual check-in token: '+payload.token));
 byId('ticket-message').textContent='QR issued. Generating a replacement invalidates this one.';
}));
byId('register-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 const displayName=byId('display-name').value.trim();
 const {result}=await api('/register','POST',{displayName});await reload();
 say('Conference registration '+result.status+'. Your confirmation reference is displayed below.');
});});
byId('cancel-event').addEventListener('click',()=>run(async()=>{
 if(!confirm('Cancel your conference place and all workshop reservations?'))return;
 await api('/cancel','POST',{});await reload();say('Conference registration cancelled.');
}));
byId('access-form').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 if(!byId('access-consent').checked)throw Error('Consent is required to store an accessibility request.');
 await api('/accommodations','PUT',{request:byId('access-note').value,consent:true});await reload();
 say('Private request saved for designated accessibility coordinators.');
});});
byId('remove-access').addEventListener('click',()=>run(async()=>{
 await api('/accommodations','PUT',{request:null});await reload();say('Private request deleted.');
}));
(async()=>{
 try{const r=await fetch('/api/events/'+encodeURIComponent(slug)+'/agenda');if(r.ok)agenda=(await r.json()).event;}
 catch{}
 try{await reload();say('Your registration status is up to date.');}
 catch(e){say(e.message);byId('register-form').hidden=true;byId('access-form').hidden=true;}
})();
`;
