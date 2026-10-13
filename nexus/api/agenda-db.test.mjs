import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAgendaDb} from './agenda-db.mjs';
const event={id:'event-1',slug:'ntc-2027',title:'NTC test event',startsAt:'2027-04-28T13:00:00Z',endsAt:'2027-04-30T22:00:00Z',timezone:'America/New_York',venueName:null,venueAddress:null};
test('public agenda selects published event, published sessions and public speakers only',async()=>{
 const calls=[];
 const data=[{rows:[event]},{rows:[{id:'session-1',slug:'session-one',title:'Sample',startsAt:event.startsAt,endsAt:event.endsAt,kind:'panel'}]},{rows:[{sessionId:'session-1',displayName:'Synthetic Presenter',role:'presenter',bio:''}]}];
 const db=createAgendaDb({query:async(sql,args)=>{calls.push({sql,args});return data.shift();}});
 const result=await db.getPublishedAgenda('ntc-2027');
 assert.equal(result.slug,'ntc-2027');
 assert.equal(result.id,undefined);
 assert.equal(result.sessions[0].id,undefined);
 assert.deepEqual(result.sessions[0].speakers,[{displayName:'Synthetic Presenter',role:'presenter',bio:''}]);
 assert.equal(calls.length,3);
 assert.deepEqual(calls[0].args,['ntc-2027']);
 assert.match(calls[0].sql,/publication_status='published'/);
 assert.match(calls[1].sql,/published=true/);
 assert.match(calls[2].sql,/public_profile=true/);
 for(const {sql} of calls){assert.doesNotMatch(sql,/accessibility_request|nexus_registrations|email_key/);}
});
test('unpublished or missing event is not enumerated',async()=>{
 let count=0;
 const db=createAgendaDb({query:async()=>{count++;return {rows:[]};}});
 assert.equal(await db.getPublishedAgenda('unpublished'),null);
 assert.equal(count,1);
});
test('no published sessions skips speaker lookup',async()=>{
 let count=0;
 const db=createAgendaDb({query:async()=>{count++;return count===1?{rows:[event]}:{rows:[]};}});
 assert.deepEqual((await db.getPublishedAgenda('ntc-2027')).sessions,[]);
 assert.equal(count,2);
});
