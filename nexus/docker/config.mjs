import {readFileSync} from 'node:fs';

const fileVars=['DATABASE_URL','GOOGLE_CLIENT_SECRET','GOOGLE_SESSION_SECRET','ZEFFY_API_KEY','ZEFFY_WEBHOOK_SECRET','MAILERSEND_API_TOKEN'];
export function loadDockerConfig(env=process.env,readFile=readFileSync){
 const config={...env};
 for(const name of fileVars){
  const path=env[name+'_FILE'];
  if(path){
   if(env[name])throw Error('Do not set both '+name+' and '+name+'_FILE');
   config[name]=readFile(path,'utf8').trim();
  }
 }
 const proxyPath=env.NEXUS_PROXY_TOKEN_FILE;
 if(!proxyPath)throw Error('NEXUS_PROXY_TOKEN_FILE required for Docker deployment');
 const proxyToken=readFile(proxyPath,'utf8').trim();
 if(!/^[a-f0-9]{64}$/.test(proxyToken))throw Error('Invalid reverse proxy token');
 return {config,proxyToken};
}
