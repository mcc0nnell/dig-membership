import {request} from 'node:http';
import {readFileSync} from 'node:fs';
const origin=new URL(process.env.PUBLIC_ORIGIN);
const token=readFileSync(process.env.NEXUS_PROXY_TOKEN_FILE,'utf8').trim();
const req=request({
 hostname:'127.0.0.1',port:Number(process.env.PORT)||8080,path:'/api/health',
 headers:{host:origin.host,'x-dig-nexus-client-ip':'127.0.0.1','x-dig-nexus-proxy-token':token},
 timeout:4000
},r=>{r.resume();r.on('end',()=>process.exit(r.statusCode===200?0:1));});
req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1);});req.end();
