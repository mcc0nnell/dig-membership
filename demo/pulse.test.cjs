const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'pulse.html'),'utf8');
const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test('Pulse keeps pinned ECharts optional and its inline logic parseable',()=>{
  assert.ok(script);
  assert.doesNotThrow(()=>new vm.Script(script));
  assert.match(page,/echarts@5\.6\.0\/dist\/echarts\.min\.js/);
  assert.equal((page.match(/<script[^>]+src=/g)||[]).length,1);
  assert.doesNotMatch(script,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
  assert.match(script,/prefers-reduced-motion/);
});
test('Eight ECharts exhibits have stable IDs, labels and meaningful table alternatives',()=>{
  for(const id of ['mix','funnel','capacity','heat','requests','consent','sankey','network']){
    assert.match(page,new RegExp('id="'+id+'-chart"'));
    assert.match(page,new RegExp("charts\\."+id));
  }
  assert.equal((page.match(/<table>/g)||[]).length,8);
  assert.equal((page.match(/class="data"/g)||[]).length,8);
  assert.match(page,/Skip to the scenario controls/);
});
test('Synthetic invariants prevent non-holding request counts from mutating paid seats',()=>{
  assert.match(page,/verified:24,open:16/);
  assert.match(page,/verified:42,open:8/);
  assert.match(page,/verified:18,open:22/);
  assert.match(page,/Verified seats remain 84; open seats remain 46/);
  assert.match(page,/No seats allocated/);
  assert.match(page,/messages sent remain zero|No message sent/i);
  assert.doesNotMatch(script,/https?:\/\//);
});
