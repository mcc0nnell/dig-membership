// No HTML interpolation of member or campaign values. All private data is
// populated with textContent and is fetched only on explicit staff lookup.
export const ASSOCIATION_CLIENT=String.raw`
const el=id=>document.getElementById(id);
const feedback=el('workspace-status');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=String(value??'');return e;};
let memberId=null,campaignId=null,eligible=0;
const message=value=>{feedback.textContent=value;};
function showPairs(target,pairs){
 const elements=[];
 for(const [label,value] of pairs){
  elements.push(text('dt',label),text('dd',value??'Unavailable'));
 }
 target.replaceChildren(...elements);
}
function list(target,items){
 target.replaceChildren(...(items.length?items.map(item=>text('li',item)):[text('li','Nothing recorded')]));
}
async function request(path,init){
 const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...init});
 if(!r.ok)throw Error(r.status===401?'Sign in to DIG Nexus first.':
  r.status===403?'Only authorized DIG officers and administrators may use this workspace.':
  r.status===404?'Record unavailable.':
  r.status===503?'This staff feature is not enabled or is temporarily unavailable.':
  'Request was not accepted ('+r.status+').');
 return (await r.json()).result;
}
const setBusy=(form,busy)=>{for(const button of form.querySelectorAll('button'))button.disabled=busy;};
el('member-search').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;const value=el('member-id').value.trim();
 memberId=null;el('member-detail').hidden=true;
 if(!uuid.test(value)){message('Enter a valid member reference.');return;}
 setBusy(form,true);message('Checking staff access and loading member record…');
 try{
  const data=await request('/api/association/members/'+encodeURIComponent(value));
  if(!data)throw Error('Record unavailable.');
  memberId=value;
  showPairs(el('member-fields'),[['Name',data.displayName],['Agency',data.agency],
   ['Member status',data.memberStatus],['Open cases',data.openCases],['Recorded activities',data.activities]]);
  list(el('member-terms'),(data.membershipTerms??[]).map(t=>t.kind+' · '+t.startsOn+' to '+t.endsOn));
  list(el('member-relations'),[
   ...(data.committees??[]).map(c=>'Committee: '+c.name+(c.position?' · '+c.position:'')),
   ...(data.affiliations??[]).map(a=>'Affiliation: '+a.name+' · '+a.kind)
  ]);
  el('member-detail').hidden=false;message('Private member record loaded.');
 }catch(error){message(error.message);}
 finally{setBusy(form,false);}
});
el('activity-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;
 if(!memberId){message('Look up a member before recording activity.');return;}
 if(!form.reportValidity())return;
 setBusy(form,true);message('Recording activity…');
 try{
  await request('/api/association/members/'+encodeURIComponent(memberId)+'/activities',{
   method:'POST',headers:{'content-type':'application/json','x-dig-nexus-action':'record-activity'},
   body:JSON.stringify({action:el('activity-kind').value,summary:el('activity-summary').value})
  });
  el('activity-summary').value='';message('Activity recorded with staff attribution.');
 }catch(error){message(error.message);}
 finally{setBusy(form,false);}
});
el('campaign-search').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;const value=el('campaign-id').value.trim();
 campaignId=null;eligible=0;el('campaign-detail').hidden=true;el('campaign-confirm').checked=false;
 if(!uuid.test(value)){message('Enter a valid campaign reference.');return;}
 setBusy(form,true);message('Previewing consented audience…');
 try{
  const data=await request('/api/association/campaigns/'+encodeURIComponent(value));
  campaignId=value;eligible=Number(data.eligibleRecipients)||0;
  showPairs(el('campaign-fields'),[['Campaign status',data.status],['Currently eligible subscribers',eligible]]);
  el('queue-submit').disabled=!data.readyToQueue||eligible<1;
  el('campaign-detail').hidden=false;
  message(data.readyToQueue?'Audience preview ready. Queuing does not send email.':'Campaign is not eligible for queueing.');
 }catch(error){message(error.message);}
 finally{setBusy(form,false);}
});
el('campaign-queue').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;
 if(!campaignId||eligible<1||!el('campaign-confirm').checked){message('Explicit review confirmation is required.');return;}
 setBusy(form,true);message('Queueing consented delivery records…');
 try{
  const result=await request('/api/association/campaigns/'+encodeURIComponent(campaignId)+'/queue',{
   method:'POST',headers:{'x-dig-nexus-action':'queue-campaign'}
  });
  message('Campaign queued for '+result.recipients+' consented recipients. No email was sent.');
  el('queue-submit').disabled=true;el('campaign-confirm').checked=false;
 }catch(error){message(error.message);setBusy(form,false);}
});
`;
