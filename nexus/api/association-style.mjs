export const ASSOCIATION_STYLE=String.raw`
:root{color-scheme:light;--ink:#183348;--muted:#526574;--border:#ccd8e0;--blue:#164b70}
*{box-sizing:border-box}body{font:1rem/1.55 system-ui,-apple-system,sans-serif;background:#f4f8fa;color:var(--ink);margin:0}
header{background:#122f45;color:white}.head-inner{max-width:76rem;margin:auto;padding:1.15rem 1.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
header strong{display:block;font-size:1.25rem}.eyebrow{letter-spacing:.1em;font-weight:750;font-size:.75rem}nav{display:flex;gap:1.5rem;flex-wrap:wrap}nav a{color:white}
main{max-width:76rem;margin:auto;padding:clamp(1rem,4vw,3rem) 1.4rem}.intro{max-width:55rem}h1{font-size:clamp(2rem,4vw,2.8rem);line-height:1.18;margin:.5rem 0}h2{margin:0;font-size:1.5rem}h3{font-size:1.06rem;margin:1.4rem 0 .5rem}.section-head{margin-bottom:1.1rem}.section-head .eyebrow{color:var(--blue)}
.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,27rem),1fr));gap:1.25rem}
section{background:white;border:1px solid var(--border);padding:1.4rem;border-radius:.8rem;min-width:0;box-shadow:0 3px 14px #173b5009}
label{display:block;font-weight:650;margin:.9rem 0 .4rem}
input:not([type=checkbox]),select,textarea{width:100%;border:2px solid #698093;border-radius:.35rem;padding:.65rem;background:white;color:var(--ink);font:inherit}
button{background:var(--blue);border:2px solid var(--blue);border-radius:.45rem;color:white;font:inherit;font-weight:750;padding:.7rem 1rem;cursor:pointer;margin:1rem 0 .3rem;min-height:2.75rem}
button:disabled{opacity:.52;cursor:wait}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #c78515;outline-offset:3px}
.status{padding:.8rem 1rem;border-left:4px solid var(--blue);background:white;margin:1.6rem 0;font-weight:650}
.hint{color:var(--muted);font-size:.92rem}dl{display:grid;grid-template-columns:max-content 1fr;gap:.45rem 1rem;overflow-wrap:anywhere}dt{font-weight:700}dd{margin:0}
ul{padding-left:1.3rem}.divider{border-top:1px solid var(--border);margin-top:1.4rem}
.consent{display:flex;gap:.75rem;align-items:flex-start;font-weight:520}.consent input{width:1.2rem;height:1.2rem;flex:none;margin:.2rem 0}
footer{max-width:76rem;margin:auto;padding:2rem 1.4rem;color:var(--muted);font-size:.94rem}
.skip{position:absolute;left:-9999px;top:0;background:white;color:var(--ink);padding:.65rem}.skip:focus{left:1rem;z-index:2}
[hidden]{display:none!important}
`;
