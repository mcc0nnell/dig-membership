import {neon} from '@neondatabase/serverless';

// Neon HTTP driver: each registration is a single atomic SQL function call.
// Never expose DATABASE_URL to the browser or WordPress.
export function createNeonClient(env) {
 const connectionString=env?.DATABASE_URL;
 if(typeof connectionString!=='string')throw Error('DATABASE_URL missing');
 const url=new URL(connectionString);
 if(url.protocol!=='postgresql:'&&url.protocol!=='postgres:')throw Error('invalid database protocol');
 if(!url.hostname.endsWith('.neon.tech')&&!url.hostname.endsWith('.neon.build'))throw Error('unexpected database host');
 const sql=neon(connectionString,{fullResults:true});
 return {query:(query,params=[])=>sql.query(query,params)};
}
