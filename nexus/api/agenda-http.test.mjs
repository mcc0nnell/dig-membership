import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const url='https://example.invalid';
const event={slug:'ntc-2027',title:'Synthetic NTC',startsAt:'2027-04-28T13:00:00Z',endsAt:'2027-04-30T22:00:00Z',timezone:'America/New_York',venueName:null,venueAddress:null,sessions:[]};
const env={agendaDb:{getPublishedAgenda:async slug=>slug==='ntc-2027'?event:null}};
test('anonymous published agenda serves JSON without a member identity',async()=>{
 const r=await worker.fetch(new Request(url+'/api/events/ntc-2027/agenda',{headers:{'x-member-id':'admin','x-role':'admin'}}),env);
 assert.equal(r.status,200);
 assert.equal((await r.json()).event.slug,'ntc-2027');
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('published event serves accessible HTML but no personal data',async()=>{
 const r=await worker.fetch(new Request(url+'/events/ntc-2027'),env);
 assert.equal(r.status,200);
 assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
 assert.match(await r.text(),/Skip to agenda/);
});
test('unpublished, malformed and missing conference slugs return 404',async()=>{
 for(const path of ['/api/events/private/agenda','/api/events/NTC-2027/agenda','/events/%3Cscript%3E']){
  assert.equal((await worker.fetch(new Request(url+path),env)).status,404,path);
 }
});
test('public agenda fails closed if database is missing or errors',async()=>{
 assert.equal((await worker.fetch(new Request(url+'/api/events/ntc-2027/agenda'))).status,503);
 const failing={agendaDb:{getPublishedAgenda:async()=>{throw Error('private DB detail');}}};
 const r=await worker.fetch(new Request(url+'/api/events/ntc-2027/agenda'),failing);
 assert.equal(r.status,503);
 assert.doesNotMatch(await r.text(),/private DB detail/);
});
test('agenda is read-only',async()=>{
 const r=await worker.fetch(new Request(url+'/api/events/ntc-2027/agenda',{method:'POST'}),env);
 assert.equal(r.status,405);
});
