export function magicPage(){
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIG Nexus email sign-in</title><style>body{font:1.1rem/1.6 system-ui;max-width:38rem;margin:2rem auto;padding:1rem;color:#17384b}label{display:block;margin:1rem 0}input{display:block;padding:.6rem;width:100%;font:inherit}button{padding:.65rem 1rem;font:inherit;background:#16486a;color:white;border:0;border-radius:.3rem}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #af7500}</style></head><body><main><h1>Sign in by email</h1><p>Enter the email you want to use for your conference registration. You do not need a Google account or DIG membership.</p><form id="request"><label for="email">Email address</label><input type="email" name="email" id="email" autocomplete="email" maxlength="254" required><button>Send sign-in link</button></form><section id="redeem" hidden><h2>Complete your sign-in</h2><p>This one-time sign-in will open your conference registration on this device.</p><button id="complete" type="button">Complete sign-in</button></section><p id="status" role="status" aria-live="polite"></p></main><script src="/magic-client.mjs" type="module"></script></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none';script-src 'self';connect-src 'self';style-src 'unsafe-inline';form-action 'self';base-uri 'none';frame-ancestors 'none'",'x-content-type-options':'nosniff','x-frame-options':'DENY'}});
}
export function magicClient(){return new Response(`
const status=document.getElementById('status');
const params=new URLSearchParams(location.search),event=params.get('event');
const token=new URLSearchParams(location.hash.slice(1)).get('token');
const valid=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const destination=valid.test(event||'')?'/conference/'+event:'/portal';
history.replaceState(null,'',location.pathname+location.search);
if(token){document.getElementById('request').hidden=true;document.getElementById('redeem').hidden=false;}
const post=(data,path)=>fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
document.getElementById('request').addEventListener('submit',async e=>{
 e.preventDefault();status.textContent='Submitting…';
 try{const r=await post({email:e.target.elements.email.value,event},'/api/auth/magic/request');
  status.textContent=r.ok?'If email delivery is available, a private sign-in link is on its way.':'Email sign-in unavailable.';
 }catch{status.textContent='Email sign-in unavailable.';}
});
document.getElementById('complete').addEventListener('click',async()=>{
 status.textContent='Verifying…';
 try{const r=await post({token},'/api/auth/magic/redeem');if(!r.ok)throw Error();location.replace(destination);}
 catch{status.textContent='This sign-in link has expired or was already used. Request another link.';}
});`,{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'}});}
