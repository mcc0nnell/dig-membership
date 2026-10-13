import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const demo=pathToFileURL(resolve('demo/offline.html')).href;
test('offline demo has no outbound requests and meets automated accessibility baseline',async({page})=>{
 const outbound=[];
 page.on('request',req=>{if(!req.url().startsWith('file:'))outbound.push(req.url());});
 const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await page.goto(demo);
 const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
 expect(scan.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
 expect(outbound).toEqual([]);
 expect(errors).toEqual([]);
 await expect(page.getByText('OFFLINE DEMO · SYNTHETIC DATA')).toBeVisible();
});
test('NTC paid intent does not reserve a place, requires simulated verified payment, and blocks repeated check-in',async({page})=>{
 await page.goto(demo);
 await expect(page.locator('#ntc-verify')).toBeDisabled();
 await expect(page.locator('#ntc-checkin')).toBeDisabled();
 await page.locator('#ntc-request').click();
 await expect(page.locator('#ntc-status')).toContainText('no Zeffy stock held and no admission');
 await expect(page.locator('#ntc-checkin')).toBeDisabled();
 await page.locator('#ntc-verify').click();
 await expect(page.locator('#ntc-status')).toContainText('example seat confirmed');
 await page.locator('#ntc-checkin').click();
 await expect(page.locator('#ntc-status')).toContainText('staff check-in recorded');
 await expect(page.locator('#ntc-checkin')).toBeDisabled();
 await page.locator('#ntc-refund').click();
 await expect(page.locator('#ntc-status')).toContainText('admission suspended');
 await page.locator('#ntc-reset').click();
 await expect(page.locator('#ntc-status')).toContainText('no ticket or entitlement');
});
test('constituent demo records fictional follow-up without executing embedded HTML',async({page})=>{
 await page.goto(demo);
 await expect(page.locator('#staff-record')).toBeHidden();
 await page.locator('#staff-load').click();
 await expect(page.locator('#staff-record')).toBeVisible();
 const note='<img src=x onerror=alert(1)> synthetic';
 await page.locator('#staff-note').fill(note);
 await page.getByRole('button',{name:'Record simulated follow-up'}).click();
 await expect(page.locator('#staff-activity')).toContainText(note);
 await expect(page.locator('#staff-activity img')).toHaveCount(0);
 await expect(page.locator('#staff-status')).toContainText('browser memory');
});
test('newsletter separates opt-in from pending, requires confirmation and suppresses queued example on opt-out',async({page})=>{
 await page.goto(demo);
 await expect(page.locator('#news-queue')).toBeDisabled();
 await page.locator('#news-preview').click();
 await expect(page.locator('#news-status')).toContainText('1 pending excluded');
 await expect(page.locator('#news-queue')).toBeDisabled();
 await page.locator('#news-confirm').check();
 await page.locator('#news-queue').click();
 await expect(page.locator('#news-status')).toContainText('no email sent');
 await page.locator('#news-optout').click();
 await expect(page.locator('#news-status')).toContainText('queued sample delivery suppressed');
 await expect(page.locator('#news-eligible')).toHaveText('0');
 await page.reload();
 await expect(page.locator('#news-eligible')).toHaveText('1');
});
test('sample membership join and email verification stay local and never automatically opt into communications',async({page})=>{
 await page.goto(demo);
 await page.locator('#join-form button').click();
 await expect(page.locator('#status')).toContainText('no email sent');
 await page.locator('#activate').click();
 await expect(page.locator('#welcome')).toContainText('Alex Example');
 await page.locator('[data-tab="preferences"]').click();
 await expect(page.locator('input[name="news"]')).not.toBeChecked();
 await expect(page.locator('input[name="events"]')).not.toBeChecked();
});

test('mobile viewport keeps all feature actions within the page',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(demo);
 const viewport=await page.evaluate(()=>({
  screen:document.documentElement.clientWidth,
  content:document.documentElement.scrollWidth
 }));
 expect(viewport.content).toBeLessThanOrEqual(viewport.screen+1);
 for(const id of ['ntc-request','staff-load','news-preview'])
  await expect(page.locator('#'+id)).toBeVisible();
});
