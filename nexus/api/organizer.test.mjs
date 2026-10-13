import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validOrganizerAction} from './organizer.mjs';
const session={slug:'first-workshop',title:'Accessible government services',kind:'workshop',startsAt:'2027-04-28T09:00:00-04:00',endsAt:'2027-04-28T10:00:00-04:00',room:'101',capacity:40};
const speaker={id:'a3000000-0000-4000-8000-000000000001',displayName:'Synthetic Speaker',publicProfile:false};
test('only declared conference editor fields are accepted',()=>{
 for(const [action,data] of [['save_session',session],['save_speaker',speaker],['set_event_publication',{publicationStatus:'published'}],['set_session_publication',{slug:session.slug,published:true}],['set_session_speaker',{sessionSlug:session.slug,speakerId:speaker.id,linked:true,role:'presenter'}]])
  assert.equal(validOrganizerAction({action,data}),true,action);
 for(const data of [{...session,memberId:'not-allowed'},{...session,accessibilityRequest:'private'}, {...session,startsAt:'2027-04-28T09:00:00'},{...session,capacity:-1},{...session,title:' '},{...session,kind:'arbitrary'}])
  assert.equal(validOrganizerAction({action:'save_session',data}),false);
 assert.equal(validOrganizerAction({action:'save_speaker',data:{...speaker,role:'admin'}}),false);
 assert.equal(validOrganizerAction({action:'delete_all',data:{}}),false);
 assert.equal(validOrganizerAction({action:'save_session',data:session,role:'admin'}),false);
});
