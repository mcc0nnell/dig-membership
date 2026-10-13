// Accessible server-rendered public agenda; plain text is always escaped.
const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const longDate=(value,timeZone)=>new Intl.DateTimeFormat('en-US',{
 timeZone,dateStyle:'full',timeStyle:'short'
}).format(new Date(value));
const dayTitle=(value,timeZone)=>new Intl.DateTimeFormat('en-US',{
 timeZone,weekday:'long',month:'long',day:'numeric'
}).format(new Date(value));
const dayKey=(value,timeZone)=>new Intl.DateTimeFormat('en-CA',{
 timeZone,year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(value));
export function renderAgendaPage(agenda) {
 const tz=agenda.timezone||'America/New_York';
 const heading=escapeHtml(agenda.title);
 const days=new Map();
 for(const session of agenda.sessions||[]){
  const key=dayKey(session.startsAt,tz);
  if(!days.has(key))days.set(key,{heading:dayTitle(session.startsAt,tz),sessions:[]});
  days.get(key).sessions.push(session);
 }
 const dayEntries=[...days.values()];
 const nav=dayEntries.length>1?`<nav aria-label="Conference days"><p>Jump to a day:</p><ul>${dayEntries.map((d,i)=>`<li><a href="#day-${i+1}">${escapeHtml(d.heading)}</a></li>`).join('')}</ul></nav>`:'';
 const sessionHtml=s=>`<article class="session" aria-labelledby="s-${escapeHtml(s.slug)}">
  <p class="type">${escapeHtml(s.kind)}${s.track?` · ${escapeHtml(s.track)}`:''}</p>
  <h4 id="s-${escapeHtml(s.slug)}">${escapeHtml(s.title)}</h4>
  <p><time datetime="${escapeHtml(new Date(s.startsAt).toISOString())}">${escapeHtml(longDate(s.startsAt,tz))}</time> – <time datetime="${escapeHtml(new Date(s.endsAt).toISOString())}">${escapeHtml(longDate(s.endsAt,tz))}</time>${s.room?` · ${escapeHtml(s.room)}`:''}</p>
  ${s.summary?`<p>${escapeHtml(s.summary)}</p>`:''}
  ${s.speakers?.length?`<p><strong>Presenters:</strong> ${s.speakers.map(sp=>escapeHtml(sp.displayName)).join(', ')}</p>`:''}
 </article>`;
 const schedule=dayEntries.map((day,i)=>`<section aria-labelledby="day-${i+1}"><h3 id="day-${i+1}">${escapeHtml(day.heading)}</h3>${day.sessions.map(sessionHtml).join('\n')}</section>`).join('\n');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading} · DIG Nexus</title>
 <style>*,*:before,*:after{box-sizing:border-box}body{font:1.05rem/1.6 system-ui,sans-serif;margin:0;background:#f7f8fa;color:#142333}header,main,footer{padding:1.2rem max(1rem,calc((100vw - 56rem)/2))}header{background:#12344d;color:white}h1{font-size:clamp(1.7rem,4vw,2.6rem);line-height:1.2}h2{margin-top:2rem}h3{margin-top:1.7rem}.session{padding:1.2rem;background:white;border:1px solid #cbd5e1;border-radius:.6rem;margin:1rem 0}.session h4{margin:.2rem 0;font-size:1.3rem}.type{text-transform:capitalize;color:#294f70;font-weight:700}a{color:#0a4b82}a:focus-visible{outline:3px solid #ffc107;outline-offset:3px}.skip{position:absolute;top:-5rem;background:white;padding:.8rem}.skip:focus{top:.2rem}nav ul{display:flex;flex-wrap:wrap;gap:1.4rem;list-style:none;padding:0}nav a{padding:.4rem}</style></head>
 <body><a class="skip" href="#agenda">Skip to agenda</a><header><p>Deaf in Government · DIG Nexus</p><h1>${heading}</h1><p>${escapeHtml(longDate(agenda.startsAt,tz))} – ${escapeHtml(longDate(agenda.endsAt,tz))}</p>${agenda.venueName?`<p>${escapeHtml(agenda.venueName)}${agenda.venueAddress?` · ${escapeHtml(agenda.venueAddress)}`:''}</p>`:''}</header>
 <main id="agenda"><h2>Conference agenda</h2><p>Times shown in ${escapeHtml(tz)}. Schedule subject to change.</p>${nav}${schedule||'<p>No sessions have been published yet.</p>'}</main><footer>Accessibility information and registration are provided by conference organizers. This agenda does not collect personal information.</footer></body></html>`;
}
