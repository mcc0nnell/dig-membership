import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderAgendaPage} from './agenda-page.mjs';
test('safe accessible agenda escapes database text and renders presenters and timezones',()=>{
 const html=renderAgendaPage({title:'NTC <img src=x onerror=alert(1)>',startsAt:'2027-04-28T13:00:00Z',endsAt:'2027-04-30T22:00:00Z',timezone:'America/New_York',venueName:'Hall & Room',sessions:[{slug:'test',title:'Accessible <session>',summary:'ASL & CART <script>alert(1)</script>',kind:'workshop',track:'Tech & policy',room:'A < B',startsAt:'2027-04-28T14:00:00Z',endsAt:'2027-04-28T15:00:00Z',speakers:[{displayName:'A < B'}]}]});
 assert.match(html,/Skip to agenda/);
 assert.match(html,/datetime="2027-04-28T14:00:00.000Z"/);
 assert.match(html,/America\/New_York/);
 assert.match(html,/Hall &amp; Room/);
 assert.match(html,/A &lt; B/);
 assert.match(html,/&lt;script&gt;alert/);
 assert.doesNotMatch(html,/<script>|<img/);
 assert.match(html,/Presenters:/);
});
test('empty agenda offers explicit unpublished-sessions state',()=>{
 const html=renderAgendaPage({title:'Upcoming event',startsAt:'2027-04-28T12:00:00Z',endsAt:'2027-04-29T12:00:00Z',timezone:'America/New_York',sessions:[]});
 assert.match(html,/No sessions have been published yet/);
});
test('multi-day NTC agenda provides day headings and keyboard-operable day links',()=>{
 const html=renderAgendaPage({title:'Synthetic NTC',startsAt:'2027-04-28T13:00:00Z',endsAt:'2027-04-30T22:00:00Z',timezone:'America/New_York',sessions:[
  {slug:'opening',title:'Opening',startsAt:'2027-04-28T13:00:00Z',endsAt:'2027-04-28T14:00:00Z',kind:'plenary'},
  {slug:'second',title:'Second day',startsAt:'2027-04-29T13:00:00Z',endsAt:'2027-04-29T14:00:00Z',kind:'breakout'}]});
 assert.match(html,/aria-label="Conference days"/);
 assert.match(html,/href="#day-1"/);
 assert.match(html,/href="#day-2"/);
 assert.match(html,/Wednesday, April 28/);
 assert.match(html,/Thursday, April 29/);
});
