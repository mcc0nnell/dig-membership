import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNeonClient} from './database.mjs';
test('database adapter requires a configured Neon connection',()=>{
 assert.throws(()=>createNeonClient({}),/DATABASE_URL/);
 assert.throws(()=>createNeonClient({DATABASE_URL:'postgresql://u:p@evil.example/db'}),/unexpected database host/);
 assert.equal(typeof createNeonClient({DATABASE_URL:'postgresql://u:p@ep-example.us-east-1.aws.neon.tech/db?sslmode=require'}).query,'function');
});
