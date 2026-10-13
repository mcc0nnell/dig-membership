# DIG Nexus — visual language and source tokens

The demo and Systems Atlas share a civic member operating system visual language: assertive institutional typography, deep DIG navy, disciplined DIG brand-red, blue for actions/focus, explicit labels, and visible trust boundaries. Identity, membership, paid admission, and consent remain distinct.

## Origin and provenance

Tokens were extracted from the supplied **dig-salesforce-main 4(1).zip**, specifically `portal/public/css/house.css` (DIG's former portal). Its `portal/resources/css/app.css` defines Instrument Sans, and `portal/docs/frontend-design-audit.md` calls out inconsistent typography, white-card monotony, minimal motion, and insufficient brand expression. These source files are used **only as design references**: the app stays an independent DIG Nexus implementation, not a Salesforce or Laravel dependency.

The machine-readable source palette is `demo/dig-brand-tokens.json`. The basic color values in the ZIP are:

| Role | Hex |
| --- | --- |
| Navy 900 / identity | `#0a1628` |
| Navy 700 / surfaces and buttons | `#1a2d4d` |
| Slate 600 / supporting text | `#475569` |
| Electric blue / secondary interface | `#3b82f6` |
| DIG brand red / identity and calls to action | `#e63312` |
| Danger red / destructive status | `#dc2626` |
| Success | `#16a34a` |
| Warning | `#d97706` |
| White | `#ffffff` |

UI variants like `#ff8d79` are contrast-adjusted derived accents against dark surfaces, **not** replacement brand tokens.

## Offline and accessibility contract

- `demo/offline.html` is a **single-file offline** presentation: no remote CSS, font, chart, image, analytics, API, cookie, or storage requests. Instrument Sans is the requested family, with a local system-font fallback when unavailable.
- The top chrome includes a short persistent disclosure; the full boundary explanation is available via native `details`/`summary`. Sample data must not be presented as production data.
- Every simulated interaction uses real buttons and semantic HTML; visual language never changes the test fixtures or entitlement logic. No synthetic button creates real membership, admission, ticket, payment, or newsletter send.
- Semantic status text, meaningful accessible labels, visible keyboard focus, no horizontal mobile overflow, and `prefers-reduced-motion` remain required.
- `demo/atlas.html` can use pinned Mermaid and ECharts CDN libraries, but exposes readable source diagrams and HTML data tables when external scripts fail.

## Visual primitives

1. **Brand mark:** compact red DIG square on navy chrome, high contrast and text-based; no fabricated official seal.
2. **Hero:** full-bleed navy, expressive typography and CSS geometry, purposeful CTA links anchored to actual demos.
3. **Surfaces:** neutral warm-gray canvas; useful grouped content with one strong dark contrast panel instead of repetitive identical white cards.
4. **Navigation:** visible destination links, dark active tab, links underlined on focus/hover, no icon-only navigation.
5. **Trust:** a persistent synthetic-data label and disclosure; native status, disabled action labels, and text-based workflows.
6. **Motion:** restrained transition for real state/hover, with reduced-motion override; no autoplay/essential animations.

## Verification

Run `node --test demo/*.test.cjs` and `npx playwright test -c demo/playwright.config.mjs`. Verify offline resource isolation, desktop/mobile overflow, no JavaScript errors, all demo journeys, disabled controls, accessible automated axe baseline, and five Mermaid diagrams plus three ECharts SVGs when network is available.
