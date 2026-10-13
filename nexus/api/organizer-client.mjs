// Native browser DOM module, distributed as plain JavaScript by the worker.
export const ORGANIZER_CLIENT=String.raw`
const eventSlug=document.body.dataset.event;
const byId=id=>document.getElementById(id);
const feedback=byId('feedback');
const message=(text)=>{feedback.textContent=text;};
let snapshot;
const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);return el;};
const field=(form,name)=>form.elements.namedItem(name);
const action=async(action,data)=>{
 const r=await fetch('/api/organizer/'+encodeURIComponent(eventSlug)+'/actions',{
  method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action,data})
 });
 if(!r.ok)throw Error('Save unsuccessful ('+r.status+'). Check your permissions and input.');
 await load();message('Saved and audited: '+action.replaceAll('_',' '));
};
const date=v=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:snapshot.event.timezone}).format(new Date(v));
const iso=v=>new Date(v).toISOString();
const formatLocal=v=>v??'';
function appendOption(select,value,title){const option=make('option',title);option.value=value;select.append(option);}
function render(){
 const {event,sessions,speakers,links,staffRole}=snapshot;
 byId('event-summary').replaceChildren(make('p',event.title+' · '+date(event.startsAt)+' – '+date(event.endsAt)+' · '+(event.venueName||'Venue not set')),
  make('p','Role: '+staffRole+' · Publication: '+event.publicationStatus));
 const controls=byId('publication-controls');controls.replaceChildren();
 if(staffRole==='manager'){
  const button=make('button',event.publicationStatus==='published'?'Take conference offline':'Publish conference');
  button.type='button';button.addEventListener('click',()=>action('set_event_publication',{publicationStatus:event.publicationStatus==='published'?'draft':'published'}).catch(e=>message(e.message)));
  controls.append(button);
 }
 const sessionsUl=byId('session-list');sessionsUl.replaceChildren();
 for(const session of sessions){
  const li=make('li');const title=make('strong',session.title);li.append(title,make('span',' · '+date(session.startsAt)+' · '+(session.room||'Room pending')+' · '+(session.published?'approved':'draft')));
  const row=make('div');row.className='toolbar';
  const edit=make('button','Edit');edit.type='button';edit.disabled=session.published&&staffRole!=='manager';edit.addEventListener('click',()=>{
   const form=byId('session-form');for(const key of ['slug','title','kind','track','room','summary'])field(form,key).value=session[key]??'';
   field(form,'startsAt').value=iso(session.startsAt);field(form,'endsAt').value=iso(session.endsAt);
   field(form,'capacity').value=session.capacity??'';field(form,'title').focus();
  });row.append(edit);
  if(staffRole==='manager'){
   const pub=make('button',session.published?'Hide session':'Approve session');pub.type='button';
   pub.addEventListener('click',()=>action('set_session_publication',{slug:session.slug,published:!session.published}).catch(e=>message(e.message)));row.append(pub);
  }
  li.append(row);sessionsUl.append(li);
 }
 if(!sessions.length)sessionsUl.append(make('li','No sessions yet. Add a draft session to start.'));
 const speakersUl=byId('speaker-list');speakersUl.replaceChildren();
 for(const speaker of speakers){
  const li=make('li',speaker.displayName+' · '+(speaker.publicProfile?'public':'private'));
  const edit=make('button','Edit speaker');edit.type='button';edit.disabled=speaker.publicProfile&&staffRole!=='manager';edit.addEventListener('click',()=>{
   const form=byId('speaker-form');field(form,'id').value=speaker.id;field(form,'displayName').value=speaker.displayName;
   field(form,'bio').value=speaker.bio||'';field(form,'publicProfile').checked=speaker.publicProfile;field(form,'displayName').focus();
  });li.append(edit);speakersUl.append(li);
 }
 const sessionSelect=byId('link-session');const speakerSelect=byId('link-speaker');sessionSelect.replaceChildren();speakerSelect.replaceChildren();
 for(const s of sessions.filter(s=>staffRole==='manager'||!s.published))appendOption(sessionSelect,s.slug,s.title);
 for(const sp of speakers)appendOption(speakerSelect,sp.id,sp.displayName);
 byId('speaker-link-form').querySelector('button').disabled=!sessionSelect.options.length||!speakers.length;
 byId('speaker-public').disabled=staffRole!=='manager';
}
async function load(){
 const r=await fetch('/api/organizer/'+encodeURIComponent(eventSlug),{credentials:'same-origin'});
 if(!r.ok)throw Error(r.status===401?'Sign in through the member portal first.':r.status===404?'You do not have event staff access.':'Organizer console unavailable ('+r.status+').');
 snapshot=(await r.json()).organizer;render();
 message('Ready: private draft preview loaded.');
}
byId('session-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget;
 const data={slug:field(f,'slug').value,title:field(f,'title').value,summary:field(f,'summary').value,kind:field(f,'kind').value,
  track:field(f,'track').value,room:field(f,'room').value,startsAt:field(f,'startsAt').value,endsAt:field(f,'endsAt').value,
  capacity:field(f,'capacity').value?Number(field(f,'capacity').value):null};
 try{await action('save_session',data);}catch(err){message(err.message);}
});
byId('speaker-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget;const id=field(f,'id').value||crypto.randomUUID();
 field(f,'id').value=id;
 try{await action('save_speaker',{id,displayName:field(f,'displayName').value,bio:field(f,'bio').value,
  publicProfile:field(f,'publicProfile').checked});}catch(err){message(err.message);}
});
byId('speaker-link-form').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget;
 try{await action('set_session_speaker',{sessionSlug:field(f,'sessionSlug').value,speakerId:field(f,'speakerId').value,
  role:field(f,'role').value,linked:true});}catch(err){message(err.message);}
});
load().catch(e=>message(e.message));
`;
