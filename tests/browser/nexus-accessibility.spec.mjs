import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import worker from '../../nexus/api/worker.mjs';

let server,origin;
test.beforeAll(async()=>{
 server=createServer(async(req,res)=>{
  try{
   const path=req.url||'/';
   const url='https://nexus.example.invalid'+path;
   const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers}),{
     ORGANIZER_ENABLED:true,
     verifyOrganizerIdentity:async()=>({verified:true,emailVerified:true,issuer:'https://accounts.google.com',subject:'synthetic-staff'}),
     organizerDb:{snapshot:async()=>({event:{slug:'ntc-2027',title:'Synthetic Event'},staffRole:'manager',sessions:[],speakers:[],links:[]})},
     GOOGLE_CLIENT_ID:'test-client',
     GOOGLE_CLIENT_SECRET:'synthetic-secret',
     GOOGLE_REDIRECT_URI:'https://nexus.example.invalid/auth/google/callback',
     GOOGLE_SESSION_SECRET:'synthetic-long-session-key-that-is-longer-than-forty-three-characters'
   });
   res.statusCode=response.status;
   for(const [key,value] of response.headers){
    if(!['set-cookie','transfer-encoding'].includes(key))res.setHeader(key,value);
   }
   res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin='http://127.0.0.1:'+server.address().port;
});
test.afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));});
for(const [route,label] of [['/portal','member portal'],['/conference/ntc-2027','attendee conference portal'],['/organizer/ntc-2027','organizer entry'],['/checkin/ntc-2027','NTC QR check-in shell']]){
 test(label+' meets automated WCAG 2 A/AA checks',async({page})=>{
  await page.goto(origin+route);
  await expect(page.locator('main')).toBeVisible();
  const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(scan.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 });
}
test('portal supports keyboard access, status announcements and explicit enrollment opt-in',async({page})=>{
 await page.goto(origin+'/portal');
 await expect(page.locator('[role="status"]')).toHaveCount(2);
 await expect(page.getByRole('heading',{name:'Your DIG membership'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Continue with Google'})).toBeVisible();
 await page.keyboard.press('Tab');
 await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/#main$/);
 await expect(page.locator('#join-section')).toBeHidden();
});

test('unconfigured staff QR check-in cannot report a successful scan',async({page})=>{
 await page.goto(origin+'/checkin/ntc-2027');
 await page.locator('#credential').fill('A'.repeat(43));
 await page.getByRole('button',{name:'Check in attendee'}).click();
 await expect(page.getByRole('status')).toContainText('Check-in denied');
 await expect(page.getByRole('status')).not.toContainText('Checked in:');
});
