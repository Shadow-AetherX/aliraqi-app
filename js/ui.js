export const $=s=>document.querySelector(s);
export const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs)){if(v==null||v===false)continue;if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v===true?'':v)}
  kids.flat().forEach(k=>{if(k!=null&&k!==false)e.append(k)});return e};
export function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2800)}
export const fmt=n=>n==null?'—':Number(n).toLocaleString('en-US');
