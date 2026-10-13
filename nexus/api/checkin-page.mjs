export const checkinPage=slug=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NTC check-in</title><style>body{font:1.1rem/1.6 system-ui;margin:auto;padding:1.5rem;max-width:45rem;color:#17354b}label{display:block;margin:1em 0}input{font:inherit;padding:.7rem;width:100%}button{font:inherit;padding:.8rem 1rem;background:#143b59;color:white;border:0;border-radius:.35rem;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #c98c00;outline-offset:2px}</style><main data-event="${slug}"><h1>NTC staff check-in</h1><p>Restricted event check-in. Scan an attendee credential using a supported camera scanner, or enter the token manually. Every successful check-in is audited.</p><form id="form"><label for="credential">QR credential</label><input name="credential" id="credential" autocomplete="off" required pattern="[A-Za-z0-9_-]{43}"><button type="submit">Check in attendee</button></form><p><button id="scan-camera" type="button">Scan QR with camera</button> <button id="stop-camera" type="button" hidden>Stop camera</button></p><video id="scanner-video" playsinline muted hidden style="width:100%;max-width:26rem" aria-label="QR camera preview"></video><p role="status" id="result" aria-live="polite">Ready</p></main><script type="module" src="/checkin-client.mjs"></script></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none';script-src 'self';connect-src 'self';style-src 'unsafe-inline';base-uri 'none';frame-ancestors 'none'",'x-frame-options':'DENY','x-content-type-options':'nosniff'}});
export const checkinClient=()=>new Response(`
const slug=document.querySelector('main').dataset.event;
const form=document.querySelector('#form');const output=document.querySelector('#result');
const cameraButton=document.querySelector('#scan-camera');const stopButton=document.querySelector('#stop-camera');
const video=document.querySelector('#scanner-video');let stream=null,active=false;
async function stop(){active=false;if(stream)for(const track of stream.getTracks())track.stop();stream=null;video.srcObject=null;video.hidden=true;stopButton.hidden=true;cameraButton.hidden=false;}
async function submitToken(token){
 output.textContent='Checking…';
 try{const r=await fetch('/api/ticketing/'+encodeURIComponent(slug)+'/checkin',{
  method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
  const j=await r.json();output.textContent=r.ok?(j.checkin.status==='checked_in'?'Checked in: '+j.checkin.attendeeName:'Already checked in'):
   'Check-in denied: '+(j.error||r.status);
  if(r.ok)form.reset();
 }catch{output.textContent='Network unavailable. Do not assume check-in succeeded.';}
}
form.addEventListener('submit',e=>{e.preventDefault();submitToken(form.elements.credential.value.trim());});
cameraButton.addEventListener('click',async()=>{
 if(typeof BarcodeDetector==='undefined'||!navigator.mediaDevices?.getUserMedia){output.textContent='Camera scanning is unsupported here. Use manual entry.';return;}
 try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'environment'}});
  video.srcObject=stream;video.hidden=false;await video.play();active=true;cameraButton.hidden=true;stopButton.hidden=false;
  const detector=new BarcodeDetector({formats:['qr_code']});
  async function frame(){
   if(!active)return;
   try{const codes=await detector.detect(video);for(const code of codes){
    if(/^[A-Za-z0-9_-]{43}$/.test(code.rawValue||'')){
     const token=code.rawValue;await stop();await submitToken(token);return;
    }
   }}catch{}
   if(active)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
 }catch{await stop();output.textContent='Camera unavailable. Use manual entry.';}
});
stopButton.addEventListener('click',stop);
window.addEventListener('pagehide',stop);
`,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
