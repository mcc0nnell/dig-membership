import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const pulse=pathToFileURL(resolve('demo/pulse.html')).href;
const CDN='https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js';

test('Pulse remains an accessible interactive explainer with CDN blocked',async({page})=>{
  const requests=[],errors=[];
  await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());
  page.on('request',request=>{if(request.url().startsWith('http')&&!request.url().startsWith('https://cdn.jsdelivr.net/'))requests.push(request.url())});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pulse);
  await expect(page.getByRole('heading',{name:'See the whole picture.'})).toBeVisible();
  await expect(page.locator('.chart-fallback')).toHaveCount(8);
  await expect(page.getByRole('table')).toHaveCount(8);
  await expect(page.locator('details.data[open]')).toHaveCount(8);
  await page.getByRole('button',{name:'Request surge'}).click();
  await expect(page.locator('#surge-value')).toHaveText('48');
  await expect(page.locator('#verified-count')).toHaveText('84');
  await expect(page.locator('#open-count')).toHaveText('46');
  const sum=await page.locator('#request-rows tr td:last-child').allTextContents();
  expect(sum.reduce((a,b)=>a+Number(b),0)).toBe(48);
  await page.getByRole('button',{name:'Consent revoked'}).click();
  await expect(page.locator('#eligible-count')).toHaveText('0');
  await expect(page.locator('#consent-revoked')).toHaveText('1');
  await expect(page.locator('#consent-eligible')).toHaveText('0');
  await expect(page.locator('#scenario-narrative')).toContainText('No message sent');
  await page.getByRole('button',{name:'Workshop B'}).click();
  await expect(page.locator('#workshop-selection')).toContainText('42 verified admissions, 8 unallocated');
  await page.getByRole('button',{name:'Newsletter',exact:true}).click();
  await expect(page.locator('#boundary-story')).toContainText('Sending is disabled');
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(audit.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('Pulse is navigable on mobile without horizontal overflow',async({page})=>{
  await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());
  await page.setViewportSize({width:390,height:844});
  await page.goto(pulse);
  await expect(page.getByRole('slider',{name:/Unverified, non-holding/})).toBeVisible();
  await page.getByRole('slider').fill('60');
  await expect(page.locator('#request-output')).toHaveText('60');
  const width=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth}));
  expect(width.content).toBeLessThanOrEqual(width.viewport+1);
});

test('Pulse connects all eight charts and refreshes options without network-dependent CI',async({page})=>{
  // An ECharts contract double proves local state and rendering wiring without relying on CDN availability.
  await page.route(CDN,route=>route.fulfill({contentType:'application/javascript',body:`
  window.__chartInstances=[];
  window.echarts={
    graphic:{LinearGradient:class {constructor(...args){this.args=args}}},
    init(el){
      const obj={el,options:null,handlers:{},actions:[],resize(){},
        setOption(o){this.options=o},on(name,fn){this.handlers[name]=fn},
        dispatchAction(action){this.actions.push(action)}};
      window.__chartInstances.push(obj);return obj;
    }
  };
  `}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pulse);
  await expect(page.locator('[data-rendered="true"]')).toHaveCount(8);
  await expect(page.locator('.chart-fallback')).toHaveCount(0);
  await page.getByRole('button',{name:'Request surge'}).click();
  await expect(page.locator('#surge-value')).toHaveText('48');
  const counts=await page.evaluate(()=>{
    const instances=window.__chartInstances;
    const find=name=>instances.find(i=>i.el.id===name+'-chart');
    return {
      length:instances.length,requests:find('requests').options.series[0].data,
      capacity:find('capacity').options.series[0].data.map(x=>x.value),
      consent:find('consent').options.series[0].data.map(x=>x.value)
    };
  });
  expect(counts.length).toBe(8);
  expect(counts.requests.reduce((a,b)=>a+b,0)).toBe(48);
  expect(counts.capacity).toEqual([24,42,18]);
  expect(counts.consent).toEqual([1,1,0,0]);
  await page.getByRole('button',{name:'Consent revoked'}).click();
  const after=await page.evaluate(()=>window.__chartInstances.find(i=>i.el.id==='consent-chart').options.series[0].data.map(x=>x.value));
  expect(after).toEqual([0,1,1,0]);
  await page.evaluate(()=>window.__chartInstances.find(i=>i.el.id==='capacity-chart').handlers.click({componentType:'series',dataIndex:2}));
  await expect(page.locator('#workshop-selection')).toContainText('Workshop C: 18 verified admissions');
  expect(errors).toEqual([]);
});
