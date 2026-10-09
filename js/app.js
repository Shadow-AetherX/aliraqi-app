import {openDB,pendingCount,deviceId} from './db.js';
import {seedIfEmpty,login,changePin,can,all} from './auth.js';
const $=s=>document.querySelector(s);
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v)}kids.flat().forEach(k=>e.append(k));return e};
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}
async function renderStatus(){
  const n=await pendingCount().catch(()=>0);const on=navigator.onLine;
  $('#statusBar').replaceChildren(
    el('span',{},el('i',{class:'dot'+(on?'':' off')}),on?'متصل':'أوفلاين — بياناتك محفوظة على الجهاز'),
    el('span',{},n?`في انتظار المزامنة: ${n}`:'كل شيء متزامن'));
}
async function showLogin(){
  const users=(await all('users')).filter(u=>u.Active);
  const sel=el('select',{id:'uSel'},users.map(u=>el('option',{value:u.UserID},u.Name)));
  const pin=el('input',{type:'password',inputmode:'numeric',autocomplete:'current-password',placeholder:'الرقم السري (PIN)'});
  const err=el('p',{class:'err'});
  const go=async()=>{const r=await login(sel.value,pin.value);if(!r.ok){err.textContent=r.msg;return}
    r.user.MustChangePin?showChangePin(r.user):showDashboard(r.user)};
  pin.addEventListener('keydown',e=>{if(e.key==='Enter')go()});
  $('#app').replaceChildren(el('div',{class:'login'},el('h1',{},'العراقي'),el('p',{},'تسجيل الدخول'),
    el('label',{class:'field'},el('span',{},'المستخدم'),sel),el('label',{class:'field'},el('span',{},'الرقم السري'),pin),
    el('button',{class:'btn',onclick:go},'دخول'),err));
}
function showChangePin(user){
  const p=el('input',{type:'password',inputmode:'numeric',placeholder:'رقم سري جديد (4 إلى 8 أرقام)'});const err=el('p',{class:'err'});
  $('#app').replaceChildren(el('div',{class:'login'},el('h1',{},'غيّر الرقم السري'),el('p',{},'ده أول دخول — اختار رقم سري خاص بيك.'),
    el('label',{class:'field'},el('span',{},'الرقم الجديد'),p),
    el('button',{class:'btn',onclick:async()=>{(await changePin(user,p.value))?showDashboard(user):err.textContent='لازم 4 لـ 8 أرقام ومش 0000'}},'حفظ'),err));
}
const PRIMARY=[['StockOut','📦','صرف من المخزن','STOCK OUT','green'],['CreateInvoice','🧾','عمل فاتورة','CREATE INVOICE',''],['StockIn','📥','استلام مخزون','STOCK IN','']];
const MODULES=[['ViewProducts','المنتجات'],['ViewCustomers','العملاء'],['ViewStock','المخزون'],['StockTransfer','نقل بين المخازن'],['ViewStock','المخازن'],['CreateInvoice','الفواتير'],['ViewReports','التقارير'],['ManageUsers','المستخدمين'],['ManageRoles','الأدوار والصلاحيات'],['ViewAudit','سجل العمليات'],['ManageSync','مركز المزامنة'],['ManageSettings','الإعدادات']];
async function showDashboard(user){
  const soon=()=>toast('الشاشة دي لسه تحت التطوير');
  const prim=[];for(const[p,ic,ar,en,cls]of PRIMARY) if(await can(user,p)) prim.push(el('button',{class:'big '+cls,onclick:soon},el('span',{class:'ic'},ic),ar,el('small',{},en)));
  const tiles=[];for(const[p,ar]of MODULES) if(await can(user,p)) tiles.push(el('button',{class:'tile',onclick:soon},ar));
  $('#app').replaceChildren(el('div',{class:'wrap'},
    el('div',{class:'hello'},el('h2',{},'أهلاً '+user.Name),el('button',{class:'btn ghost',onclick:showLogin},'خروج')),
    el('div',{class:'primary'},prim),el('div',{class:'grid'},tiles)));
}
async function boot(){
  await openDB();await seedIfEmpty();deviceId();await renderStatus();
  addEventListener('online',renderStatus);addEventListener('offline',renderStatus);setInterval(renderStatus,15000);
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  showLogin();
}
boot();
