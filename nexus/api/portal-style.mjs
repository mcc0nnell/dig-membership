export const PORTAL_STYLE = `
:root{color-scheme:light;--ink:#142c39;--muted:#526677;--line:#cbdae2;--accent:#154c73;--surface:#fff}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:#f3f7f9;font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55}
header{display:flex;justify-content:space-between;align-items:center;background:var(--ink);color:white;padding:1.1rem max(1rem,calc((100vw - 58rem)/2));gap:1rem}
header strong{font-size:1.2rem}.eyebrow{font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
main{max-width:58rem;padding:clamp(1rem,4vw,3rem);margin:auto}.intro{margin:1rem 0 2rem}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.15;margin:.35rem 0}h2{margin:0 0 .75rem;font-size:1.3rem}p{max-width:65ch}
.panel{border:1px solid var(--line);border-radius:1rem;background:var(--surface);padding:clamp(1rem,3vw,2rem);margin:1rem 0;box-shadow:0 8px 28px #15374e0b}
label{display:block;margin:1.2rem 0 .4rem;font-weight:650}input[type=text],input:not([type]){width:100%;max-width:32rem;border:2px solid #667f91;border-radius:.5rem;padding:.7rem;font:inherit;min-height:3rem}
.checkbox{display:flex;align-items:start;gap:.7rem;font-weight:450;max-width:57ch}.checkbox input{flex:none;width:1.25rem;height:1.25rem;margin:.16rem 0}
button,.action{display:inline-block;background:var(--accent);color:white;border:2px solid var(--accent);border-radius:.55rem;padding:.7rem 1rem;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;min-height:2.8rem}
.secondary{background:transparent;color:var(--accent)}button:disabled{opacity:.6;cursor:wait}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #dc8c1f;outline-offset:3px}.fine-print{font-size:.94rem;color:var(--muted)}.skip-link{position:absolute;left:-9999px;top:0;background:white;color:#142c39;padding:.5rem}.skip-link:focus{left:1rem;z-index:10}
[hidden]{display:none!important}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;
