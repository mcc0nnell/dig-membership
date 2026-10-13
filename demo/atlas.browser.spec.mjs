import {test, expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const atlas=pathToFileURL(resolve('demo/atlas.html')).href;

// Deliberately block only optional visualization CDNs. The atlas must
// still communicate every boundary in text and retain its data tables.
test('systems atlas stays readable without chart libraries or app APIs', async ({page}) => {
  const appRequests=[];
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  page.on('request', request => {
    if (request.url().startsWith('http') && !request.url().startsWith('https://cdn.jsdelivr.net/'))
      appRequests.push(request.url());
  });
  await page.goto(atlas);
  await expect(page.getByRole('heading',{name:'One platform. Clear boundaries.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Four journeys. Different permissions.'})).toBeVisible();
  for (const heading of ['Purchase is not admission','Role-scoped staff follow-ups','Consent before campaign queue'])
    await expect(page.getByRole('heading',{name:heading})).toBeVisible();
  for (const id of ['members-chart','capacity-chart','consent-chart'])
    await expect(page.locator('#'+id+' .chart-fallback')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(3);
  await expect(page.getByText('Actual emails sent',{exact:true})).toBeVisible();
  await expect(page.locator('pre.mermaid')).toHaveCount(5);
  expect(appRequests).toEqual([]);
});

test('atlas fits mobile viewport with keyboard-available source and tables',async({page})=>{
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.setViewportSize({width:390,height:844});
  await page.goto(atlas);
  await expect(page.getByRole('link',{name:'Operational journeys'})).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(3);
  const view=await page.evaluate(()=>({
    page:document.documentElement.clientWidth,
    content:document.documentElement.scrollWidth
  }));
  expect(view.content).toBeLessThanOrEqual(view.page+1);
});
