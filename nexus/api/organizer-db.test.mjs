import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOrganizerDb} from './organizer-db.mjs';
const identity={issuer:'https://accounts.google.com',subject:'synthetic'};
test('organizer snapshots always resolve session identity inside SQL',async()=>{
 const calls=[];
 const db=createOrganizerDb({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{snapshot:{event:{slug:'ntc-2027'}}}]};}});
 const v=await db.snapshot('ntc-2027',identity);
 assert.equal(v.event.slug,'ntc-2027');assert.deepEqual(calls[0].args,['ntc-2027',identity.issuer,identity.subject]);
 assert.match(calls[0].sql,/nexus_organizer_snapshot/);
});
test('writes use an identity-scoped atomic SQL function',async()=>{
 let received;
 const db=createOrganizerDb({query:async(sql,args)=>{received={sql,args};return {rows:[{result:{ok:true}}]};}});
 assert.equal((await db.apply('ntc-2027',identity,'set_event_publication',{publicationStatus:'draft'})).ok,true);
 assert.match(received.sql,/nexus_organizer_apply/);
 assert.deepEqual(received.args,['ntc-2027',identity.issuer,identity.subject,'set_event_publication','{"publicationStatus":"draft"}']);
});
test('empty or malformed database response fails closed',async()=>{
 const db=createOrganizerDb({query:async()=>({rows:[]})});
 assert.equal(await db.snapshot('ntc-2027',identity),null);
 await assert.rejects(db.apply('ntc-2027',identity,'x',{}));
});
