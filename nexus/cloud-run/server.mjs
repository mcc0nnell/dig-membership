import {cloudRunEnvironment,createCloudRunHandler,startServer} from './adapter.mjs';
const origin=process.env.PUBLIC_ORIGIN;
if(!origin||!origin.startsWith('https://'))throw Error('HTTPS PUBLIC_ORIGIN required');
if(!process.env.PORT||!/^\d+$/.test(process.env.PORT))throw Error('PORT required');
const env=await cloudRunEnvironment();
startServer({handler:createCloudRunHandler({env,publicOrigin:origin}),port:Number(process.env.PORT)});
