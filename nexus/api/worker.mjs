export default {
 async fetch(request) {
  const url = new URL(request.url);
  const headers = {"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"};
  if (request.method === "GET" && url.pathname === "/api/health") {
   return new Response(JSON.stringify({service:"dig-nexus",status:"ok"}),{status:200,headers});
  }
  if (url.pathname === "/api/me") {
   return new Response(JSON.stringify({error:"authentication_not_configured"}),{status:501,headers});
  }
  return new Response(JSON.stringify({error:"not_found"}),{status:404,headers});
 }
};
