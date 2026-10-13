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
   const headers=new Headers(req.headers);
   // Simulate TLS termination for test-only POST Origin comparisons.
   if(headers.get('origin')===origin)headers.set('origin','https://nexus.example.invalid');
   const body=['POST','PUT','PATCH'].includes(req.method)?await new Promise((resolve,reject)=>{
     const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>resolve(Buffer.concat(chunks)));
     req.on('error',reject);
   }):undefined;
   const response=await worker.fetch(new Request(url,{method:req.method,headers,body}),{
     ORGANIZER_ENABLED:true,
     CONSTITUENTS_ENABLED:true,
     CAMPAIGNS_ENABLED:true,
     verifyAssociationIdentity:async()=>({verified:true,emailVerified:true,issuer:'https://accounts.google.com',subject:'synthetic-staff'}),
     associationOpsDb:{
       member:async()=>({displayName:'Synthetic <script>alert(1)</script>',agency:'Synthetic Agency',memberStatus:'active',
         openCases:1,activities:0,membershipTerms:[{kind:'annual',startsOn:'2026-01-01',endsOn:'2026-12-31'}],
         committees:[{name:'Research',position:'Chair'}],affiliations:[]}),
       activity:async()=>({recorded:true}),
       campaign:async()=>({status:'draft',eligibleRecipients:1,readyToQueue:true}),
       queue:async()=>({status:'queued',recipients:1})
     },
     organizerRateLimiter:{limit:async()=>({success:true})},
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
for(const [route,label] of [['/portal','member portal'],['/conference/ntc-2027','attendee conference portal'],['/organizer/ntc-2027','organizer entry'],['/checkin/ntc-2027','NTC QR check-in shell'],['/association','association workspace']]){
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

test('association workspace loads private synthetic records without interpreting member HTML',async({page})=>{
 await page.goto(origin+'/association');
 await page.locator('#member-id').fill('11111111-1111-4111-8111-111111111111');
 await page.getByRole('button',{name:'Look up member'}).click();
 await expect(page.getByText('Synthetic <script>alert(1)</script>')).toBeVisible();
 await expect(page.locator('script:not([src])')).toHaveCount(0);
 await expect(page.getByText('Research · Chair',{exact:false})).toBeVisible();
 await page.locator('#activity-summary').fill('Synthetic staff follow-up');
 await page.getByRole('button',{name:'Record activity'}).click();
 await expect(page.getByRole('status')).toContainText('Activity recorded');
});
test('association campaign requires explicit review, only queues and never claims to send',async({page})=>{
 await page.goto(origin+'/association');
 await page.locator('#campaign-id').fill('22222222-2222-4222-8222-222222222222');
 await page.getByRole('button',{name:'Preview campaign'}).click();
 await expect(page.getByText('Currently eligible subscribers')).toBeVisible();
 await page.getByLabel('I have reviewed this campaign').check();
 await page.getByRole('button',{name:'Queue approved campaign'}).click();
 await expect(page.getByRole('status')).toContainText('No email was sent');
 await expect(page.getByRole('button',{name:'Queue approved campaign'})).toBeDisabled();
});
