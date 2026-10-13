import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadDockerConfig} from './config.mjs';
const token='a'.repeat(64);
test('Docker reads secrets from files without requiring credentials in Compose YAML',()=>{
 const files=new Map([['/private/db','postgresql://example.invalid/db'],['/private/google','synthetic'],['/private/session','synthetic-session'],['/private/proxy',token]]);
 const env={
  DATABASE_URL_FILE:'/private/db',GOOGLE_CLIENT_SECRET_FILE:'/private/google',
  GOOGLE_SESSION_SECRET_FILE:'/private/session',NEXUS_PROXY_TOKEN_FILE:'/private/proxy'
 };
 const actual=loadDockerConfig(env,path=>files.get(path));
 assert.equal(actual.config.DATABASE_URL,'postgresql://example.invalid/db');
 assert.equal(actual.config.GOOGLE_CLIENT_SECRET,'synthetic');
 assert.equal(actual.config.GOOGLE_SESSION_SECRET,'synthetic-session');
 assert.equal(actual.proxyToken,token);
});
test('Docker fails closed without proxy token and on conflicting secret sources',()=>{
 assert.throws(()=>loadDockerConfig({},()=>token),/PROXY_TOKEN_FILE/);
 assert.throws(()=>loadDockerConfig({NEXUS_PROXY_TOKEN_FILE:'/proxy'},()=>''),/Invalid reverse proxy token/);
 assert.throws(()=>loadDockerConfig({NEXUS_PROXY_TOKEN_FILE:'/proxy',DATABASE_URL:'raw',DATABASE_URL_FILE:'/db'},()=>token),/Do not set both/);
});
