const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const atlas = readFileSync(path.join(__dirname, 'atlas.html'), 'utf8');
const docs = readFileSync(path.join(__dirname, '..', 'docs', 'architecture', 'system-maps.md'), 'utf8');

test('systems atlas contains valid browser-side JavaScript', () => {
  const scripts = [...atlas.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]).filter(Boolean);
  assert.equal(scripts.length, 2);
  const vm = require('node:vm');
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
  assert.match(scripts[1], /import mermaid from/);
  assert.match(scripts[1], /securityLevel:'strict'/);
});

test('gallery explicitly isolates fictional fixtures from real member information', () => {
  assert.match(atlas, /Development preview · synthetic examples only/);
  assert.match(atlas, /not DIG statistics/);
  assert.match(atlas, /not the DC27 schedule/);
  assert.match(atlas, /not DIG records, Neon queries/);
  assert.doesNotMatch(atlas, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(atlas, /Salesforce\s+connection/i);
});

test('gallery uses pinned ECharts and Mermaid with accessible alternatives', () => {
  assert.match(atlas, /echarts@5\.6\.0\/dist\/echarts\.min\.js/);
  assert.match(atlas, /mermaid@11\.4\.1\/dist\/mermaid\.esm\.min\.mjs/);
  assert.match(atlas, /prefers-reduced-motion/);
  assert.match(atlas, /Skip to content/);
  assert.match(atlas, /<table>/);
  assert.match(atlas, /class="mermaid"/);
  assert.match(atlas, /aria-label="Illustrative sample/);
  assert.match(atlas, /Charts require the ECharts CDN/);
});

test('Mermaid docs map runtime, membership, admission, staff and consent boundaries', () => {
  assert.equal((docs.match(/\x60{3}mermaid/g) || []).length, 5);
  assert.match(docs, /flowchart LR/);
  assert.match(docs, /sequenceDiagram/);
  assert.match(docs, /live sales and expiry jobs disabled/i);
  assert.match(docs, /does not approve membership/i);
  assert.match(docs, /Staff constituent access boundary/);
  assert.match(docs, /Newsletter consent and suppression/);
});

test('systems atlas reflects new offline NTC, constituent and newsletter journeys', () => {
  for (const name of ['ntc-flow-title','cases-flow-title','newsletter-flow-title','consent-chart'])
    assert.match(atlas, new RegExp(name));
  assert.equal((atlas.match(/class="mermaid"/g) || []).length, 5);
  assert.match(atlas, /non-holding payment request/i);
  assert.match(atlas, /Verified allocated/);
  assert.match(atlas, /one opted-in identity and one pending identity/);
  assert.match(atlas, /Actual emails sent/);
  assert.match(atlas, /Restricted activity records/);
  assert.match(atlas, /default-off provider/);
});
