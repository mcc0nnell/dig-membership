export const COORDINATION_CLIENT=String.raw`
const slug=document.body.dataset.event;
const status=document.getElementById('status');
const list=document.getElementById('requests');
const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=String(text);return el;};
async function load(){
 status.textContent='Checking restricted access…';list.replaceChildren();
 try{
  const r=await fetch('/api/conference/'+encodeURIComponent(slug)+'/coordination',{credentials:'same-origin'});
  if(!r.ok)throw Error(r.status===401?'Sign in before accessing this page.':r.status===403?'You are not assigned to coordinate this event.':'Access unavailable ('+r.status+').');
  const records=(await r.json()).coordination.requests;
  for(const item of records){
   const li=node('li',item.attendeeName+' · '+item.email);
   li.append(node('p','Registration: '+item.registrationStatus),node('p',item.request));list.append(li);
  }
  status.textContent=records.length+' restricted request(s). Access has been audited.';
 }catch(e){status.textContent=e.message;}
}
document.getElementById('refresh').addEventListener('click',load);
load();
`;
