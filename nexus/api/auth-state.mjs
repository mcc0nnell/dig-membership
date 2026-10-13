// Durable Object: transactional one-time OAuth state and revocable sessions.
export class AuthState {
 constructor(state){this.storage=state.storage;}
 async fetch(request){
  const {action,id,ttl}=await request.json();
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(id))return Response.json({ok:false},{status:400});
  const key=(action==='consumeFlow'?'flow:':'session:')+id;
  const now=Date.now();
  if(action==='createFlow'||action==='createSession'){
   if(!Number.isInteger(ttl)||ttl<1||ttl>3600000)return Response.json({ok:false},{status:400});
   await this.storage.put(key,now+ttl,{expirationTtl:Math.ceil(ttl/1000)+60});
   return Response.json({ok:true});
  }
  if(action==='consumeFlow'){
   const valid=await this.storage.transaction(async tx=>{
    const expiry=await tx.get(key);
    if(typeof expiry!=='number'||expiry<=now)return false;
    await tx.delete(key);
    return true;
   });
   return Response.json({ok:valid});
  }
  if(action==='checkSession')return Response.json({ok:(await this.storage.get(key))>now});
  if(action==='revokeSession'){await this.storage.delete(key);return Response.json({ok:true});}
  return Response.json({ok:false},{status:400});
 }
}
export async function authState(env,action,id,ttl){
 if(!env.AUTH_STATE||typeof env.AUTH_STATE.idFromName!=='function')throw Error('auth state unavailable');
 const stub=env.AUTH_STATE.get(env.AUTH_STATE.idFromName('dig-nexus-auth'));
 const response=await stub.fetch('https://auth-state.internal/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,id,ttl})});
 if(!response.ok)throw Error('auth state unavailable');
 const result=await response.json();
 return result.ok===true;
}
