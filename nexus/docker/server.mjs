import {loadDockerConfig} from './config.mjs';
import {cloudRunEnvironment,createCloudRunHandler,startServer} from '../cloud-run/adapter.mjs';
const {config,proxyToken}=loadDockerConfig();
const origin=config.PUBLIC_ORIGIN;
if(!origin?.startsWith('https://'))throw Error('HTTPS PUBLIC_ORIGIN required');
const port=Number(config.PORT);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('valid PORT required');
const env=await cloudRunEnvironment(config);
startServer({handler:createCloudRunHandler({env,publicOrigin:origin,proxyToken}),port});
