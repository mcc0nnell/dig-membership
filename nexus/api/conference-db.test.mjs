import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConferenceDb} from './conference-db.mjs';
const identity={issuer:'https://accounts.google.com',subject:'sub-fixture',email:'verified@example.invalid'};
test('all attendee queries bind the verified identity and use narrowly named SQL functions',async()=>{
 const calls=[];const db=createConferenceDb({query:async(sql,params)=>{
  calls.push({sql,params});return {rows:[{value:{status:'registered'}}]};
 }});
 await db.self('ntc-2027',identity);await db.register('ntc-2027',identity,'Synthetic');
 await db.workshop('ntc-2027',identity,'asl-track','reserve');await db.cancel('ntc-2027',identity);
 await db.accommodation('ntc-2027',identity,'CART',true);await db.coordination('ntc-2027',identity);
 assert.deepEqual(calls.map(x=>x.sql.match(/nexus_conference_\w+/)[0]),[
  'nexus_conference_self','nexus_conference_register','nexus_conference_workshop',
  'nexus_conference_cancel','nexus_conference_accommodation','nexus_conference_coordination'
 ]);
 for(const {params} of calls)assert.deepEqual(params.slice(0,3),['ntc-2027',identity.issuer,identity.subject]);
 assert.equal(calls[1].params[3],identity.email);
 assert.equal(calls[4].params[3],'CART');
});
test('database adapter rejects missing SQL results',async()=>{
 const db=createConferenceDb({query:async()=>({rows:[]})});
 await assert.rejects(db.register('event',identity,'Test'));
});
