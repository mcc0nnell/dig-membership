import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEmailLimits, normalizedInstance} from './check-email-limits.mjs';

const stub = (single, mass) => async (url, opts) => {
  assert.match(url, /^https:\/\/example\.my\.salesforce\.com\/services\/data\/v65\.0\/limits$/);
  assert.equal(opts.headers.authorization,'Bearer fake');
  return {ok:true,json:async()=>({SingleEmail:single, MassEmail:mass})};
};
test('inspects native Salesforce SingleEmail and MassEmail without assuming 5k',async()=>{
  const actual=await checkEmailLimits({instance:'https://example.my.salesforce.com/',token:'fake',reserve:500,
    fetcher:stub({Max:2000,Remaining:620},{Max:5000,Remaining:4000})});
  assert.equal(actual.healthy,true);
  assert.equal(actual.allocations.SingleEmail.max,2000);
  assert.equal(actual.allocations.MassEmail.remaining,4000);
});
test('warns and exits unhealthy when remaining drops below reserve',async()=>{
  const actual=await checkEmailLimits({instance:'https://example.my.salesforce.com',token:'fake',reserve:800,
    fetcher:stub({Max:5000,Remaining:799},null)});
  assert.equal(actual.healthy,false);
});
test('fails closed on missing SingleEmail resource',async()=>{
  const actual=await checkEmailLimits({instance:'https://example.my.salesforce.com',token:'fake',
    fetcher:stub(null,{Max:5000,Remaining:5000})});
  assert.equal(actual.healthy,false);
  assert.equal(actual.allocations.SingleEmail,null);
});
test('refuses arbitrary internet endpoints and embedded credentials',()=>{
  for (const url of ['http://example.my.salesforce.com','https://evil.test',
    'https://example.my.salesforce.com.evil.test','https://someone@example.my.salesforce.com',
    'https://example.my.salesforce.com/steal','https://example.my.salesforce.com/?bad']) {
    assert.throws(()=>normalizedInstance(url));
  }
});
