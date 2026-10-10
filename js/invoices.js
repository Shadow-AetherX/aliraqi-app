// شاشة الفواتير: إنشاء فاتورة (عميل + أصناف بالمسح/البحث + كراتين/قطع + سعر)، قائمة الفواتير، عرض الفاتورة + PDF/صور للمشاركة.
// الفاتورة بعد الحفظ ما بتتعدلش (المرتجع/التعديل لاحقاً بمستندات مرتبطة). الحفظ = فاتورة + بنودها + حركات الصرف + طابور المزامنة + سجل العمليات في معاملة واحدة.
import {all,get,byIndex,txRun,uuid,nowISO,deviceId,ymd,stockMap,toPieces} from './db.js';
import {can} from './auth.js';
import {norm,compact} from './products.js';
import {$,el,toast,fmt} from './ui.js';
import {pickCustomer} from './customers.js';
import {openScanner,scannerSupport} from './scanner.js';
import {buildInvoiceFiles} from './invoice-pdf.js';

const money=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});
const r2=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const parseScan=s=>String(s).trim().replace(/^ALIRAQI-PRODUCT-/i,'');
const fdt=iso=>{const d=new Date(iso),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`};

// ---------- حفظ الفاتورة (معاملة واحدة) ----------
// items: [{p:المنتج, cartons, pieces, unitPrice}] — سعر القطعة الافتراضي = PricePiece (carton_unit_price) والسعر الأصلي بيتخزن جنب السعر المستخدم.
export function postInvoice({customer,warehouseId,items,user,notes='',allowNegative=false}){
  if(!customer) throw new Error('اختار العميل');
  if(!items.length) throw new Error('مفيش أصناف في الفاتورة');
  const now=nowISO(),dev=deviceId(),invId=uuid();
  const lines=items.map((it,i)=>{
    const pcs=it.p.PcsPerCarton||0,tp=toPieces(it.cartons,it.pieces,pcs),price=Number(it.unitPrice);
    if(!Number.isInteger(tp)||tp<=0) throw new Error('كمية غير صالحة');
    if(!(price>0)) throw new Error('سعر غير صالح');
    const orig=it.p.PricePiece||null;
    return {LineID:uuid(),InvoiceID:invId,LineNo:i+1,ProductID:it.p.ProductID,Code:it.p.Code,Name:it.p.Name||'',Cartons:it.cartons,Pieces:it.pieces,
      PcsPerCarton:pcs,TotalPieces:tp,OriginalUnitPrice:orig,UnitPrice:price,PriceChanged:orig!==null&&orig!==price,LineTotal:r2(tp*price)};
  });
  const total=r2(lines.reduce((s,l)=>s+l.LineTotal,0)),pcsAll=lines.reduce((s,l)=>s+l.TotalPieces,0);
  return txRun(['invoices','invoice_lines','movements','syncq','audit','settings'],(t,fail,setOut)=>{
    const mv=t.objectStore('movements'),sq=t.objectStore('syncq'),au=t.objectStore('audit'),st=t.objectStore('settings');
    const q=(entity,id)=>sq.put({OpID:uuid(),Entity:entity,EntityID:id,Status:'PENDING',CreatedAt:now,Tries:0});
    const writeAll=n=>{
      const number=`ALR-${ymd(new Date(now))}-${dev.replace(/^D-/,'')}-${String(n).padStart(4,'0')}`;   // لا يتعارض بين الأجهزة
      const inv={InvoiceID:invId,Number:number,DateTime:now,CustomerID:customer.CustomerID,CustomerName:customer.Name,CustomerPhone:customer.Phone||'',
        CustomerAddress:customer.Address||'',WarehouseID:warehouseId,Status:'POSTED',Version:1,Total:total,ItemsCount:lines.length,TotalPieces:pcsAll,
        Notes:notes,UserID:user.UserID,UserName:user.Name,DeviceID:dev,UpdatedAt:now,SyncStatus:'PENDING'};
      t.objectStore('invoices').put(inv);q('invoices',invId);
      for(const l of lines){
        t.objectStore('invoice_lines').put(l);q('invoice_lines',l.LineID);
        const m={MovementID:uuid(),DateTime:now,ProductID:l.ProductID,WarehouseID:warehouseId,MovementType:'STOCK_OUT',QuantityPieces:-l.TotalPieces,
          ReferenceID:invId,UserID:user.UserID,DeviceID:dev,SyncStatus:'PENDING',Notes:'فاتورة '+number};
        mv.put(m);q('movements',m.MovementID);
      }
      au.put({AuditID:uuid(),UserID:user.UserID,UserName:user.Name,Action:'INVOICE_CREATE',EntityType:'Invoice',EntityID:invId,DateTime:now,DeviceID:dev,OldValue:null,
        NewValue:JSON.stringify({number,customer:customer.CustomerID,warehouseId,total,lines:lines.map(l=>({p:l.ProductID,q:l.TotalPieces,price:l.UnitPrice,orig:l.OriginalUnitPrice}))}),Notes:notes,SyncStatus:'PENDING'});
      setOut({inv,lines});
    };
    const seqStep=()=>{const key=`invseq:${dev}:${ymd(new Date(now))}`;
      st.get(key).onsuccess=e=>{const n=(e.target.result?.value||0)+1;st.put({key,value:n});writeAll(n)}};
    if(allowNegative){seqStep();return}
    let left=lines.length;
    for(const l of lines){
      mv.index('ProductID').getAll(l.ProductID).onsuccess=e=>{
        const avail=e.target.result.filter(m=>m.WarehouseID===warehouseId).reduce((s,m)=>s+m.QuantityPieces,0);
        if(avail<l.TotalPieces){fail(Object.assign(new Error('الرصيد مش كفاية'),{code:'INSUFFICIENT',productId:l.ProductID,available:avail,requested:l.TotalPieces}));return}
        if(--left===0) seqStep();
      };
    }
  });
}

// ---------- شاشة إنشاء فاتورة ----------
export async function showInvoiceNew(user,onBack,opts={}){
  const prods=(await all('products')).filter(p=>p.Active!==false).sort((a,b)=>a.SourceRow-b.SourceRow);
  prods.forEach(p=>{p._hay=norm(p.Name+' '+p.Category+' '+p.Code);p._code=compact(p.Code)});
  const byId=new Map(prods.map(p=>[p.ProductID,p]));
  const whs=(await all('warehouses')).filter(w=>w.Active);
  const canOverride=await can(user,'OverrideStock'),canPrice=await can(user,'OverridePrice');
  let stock=await stockMap(),customer=opts.customer||null,scanUnit='carton',busy=false;
  const lines=new Map();                                   // productId -> {cartons,pieces,price}

  const lastWh=localStorage.getItem('alr_last_wh'),hasLast=whs.some(w=>w.WarehouseID===lastWh);
  const whSel=el('select',{'aria-label':'المخزن',onchange:()=>{if(whSel.value)localStorage.setItem('alr_last_wh',whSel.value);updateTotals()}},
    !hasLast&&el('option',{value:''},'اختر المخزن…'),whs.map(w=>el('option',{value:w.WarehouseID},w.Name)));
  if(hasLast)whSel.value=lastWh;
  const note=el('input',{type:'text',maxlength:'160',placeholder:'ملاحظة داخلية (مش بتظهر في الفاتورة)','aria-label':'ملاحظة'});
  const q=el('input',{type:'search',class:'psearch',placeholder:'اكتب الكود أو الاسم… أو امسح الباركود',autocomplete:'off',enterkeyhint:'done','aria-label':'إضافة صنف'});
  const results=el('div',{class:'results'}),linesBox=el('div',{class:'slines'}),summary=el('div',{class:'ssum'}),msg=el('p',{class:'err'}),hint=el('p',{class:'note'});
  const grand=el('b',{class:'inv-grand'},'0 ج.م');
  const override=el('input',{type:'checkbox'});const ovWrap=canOverride?el('label',{class:'chk warnbox'},override,'تجاوز الرصيد (صلاحية خاصة)'):null;
  const confirmBtn=el('button',{class:'btn',type:'button',onclick:confirm},'حفظ الفاتورة');
  const custBox=el('div',{class:'inv-cust'});
  const avail=p=>((stock.get(p.ProductID)||{})[whSel.value])||0;

  function drawCustomer(){
    custBox.replaceChildren(el('div',{},el('span',{class:'inv-lbl'},'العميل'),customer?el('b',{},customer.Name):el('b',{class:'warn'},'لسه ما اخترتش عميل'),
      customer&&customer.Phone&&el('span',{class:'code',dir:'ltr'},' '+customer.Phone)),
      el('button',{class:'btn ghost',type:'button',onclick:()=>pickCustomer({user,onPick:c=>{customer=c;drawCustomer();updateTotals()}})},customer?'تغيير':'اختيار عميل'));
  }
  function add(p,dc=0,dp=0){
    if(!p.PricePiece&&!canPrice){toast('الصنف ده من غير سعر — محتاج صلاحية تعديل السعر');return false}
    const l=lines.get(p.ProductID)||{cartons:0,pieces:0,price:p.PricePiece||''};
    l.cartons+=dc;l.pieces+=dp;lines.set(p.ProductID,l);q.value='';results.replaceChildren();renderLines();return true;
  }
  const addUnit=p=>scanUnit==='carton'&&p.PcsPerCarton?add(p,1,0):add(p,0,1);
  function addFromScanText(text){
    const c=compact(parseScan(text));if(!c)return null;
    const hits=prods.filter(p=>p._code===c);
    if(hits.length===1){const p=hits[0];return addUnit(p)?p:null}
    if(hits.length>1){showPicker(hits);return hits}
    return null;
  }
  function showPicker(list){
    results.replaceChildren(...list.slice(0,8).map(p=>el('button',{class:'rbtn',type:'button',onclick:()=>addUnit(p)},
      el('b',{},p.Name||'(بدون اسم)'),el('span',{dir:'ltr',class:'code'},p.Code),el('small',{},p.Category),
      el('small',{},p.PricePiece?`${money(p.PricePiece)} ج.م للقطعة · الرصيد ${fmt(avail(p))}`:`من غير سعر · الرصيد ${fmt(avail(p))}`))));
  }
  function onType(){
    const toks=norm(q.value).split(' ').filter(Boolean);if(!toks.length){results.replaceChildren();return}
    const r=prods.filter(p=>toks.every(k=>p._hay.includes(k)||p._code.includes(compact(k))));
    const exact=compact(q.value);r.sort((a,b)=>(b._code===exact)-(a._code===exact));
    if(!r.length){results.replaceChildren(el('p',{class:'empty'},'مفيش صنف بالاسم/الكود ده'));return}
    showPicker(r);
  }
  let tm;q.addEventListener('input',()=>{clearTimeout(tm);tm=setTimeout(onType,100)});
  q.addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();
    const c=compact(q.value),hits=prods.filter(p=>p._code===c);
    if(hits.length===1)addFromScanText(q.value);else if(!hits.length&&results.children.length===1&&results.firstChild.classList?.contains('rbtn'))results.firstChild.click()});

  const refs=new Map();
  function buildLines(){
    refs.clear();const rows=[];
    for(const [id,l] of lines){
      const p=byId.get(id);
      const num=(key,dis)=>{const i=el('input',{type:'number',min:'0',step:'1',inputmode:'numeric',value:String(l[key]),disabled:dis,'aria-label':key==='cartons'?'كراتين':'قطع'});
        i.addEventListener('input',()=>{l[key]=Math.max(0,Math.floor(Number(i.value)||0));updateTotals()});i.addEventListener('focus',()=>i.select());return i};
      const price=el('input',{type:'number',min:'0',step:'0.01',inputmode:'decimal',value:l.price===''?'':String(l.price),readonly:!canPrice,placeholder:'السعر','aria-label':'سعر القطعة'});
      price.addEventListener('input',()=>{l.price=price.value===''?'':Number(price.value);updateTotals()});price.addEventListener('focus',()=>price.select());
      const tot=el('b',{}),stk=el('small',{}),cp=el('small',{class:'inv-sub'}),chg=el('small',{class:'warn'});
      const root=el('div',{class:'sline'},
        el('div',{class:'slhead'},el('div',{},el('b',{},p.Name||'(بدون اسم)'),el('span',{class:'code',dir:'ltr'},' '+p.Code)),
          el('button',{class:'x',type:'button','aria-label':'حذف الصنف',onclick:()=>{lines.delete(id);renderLines()}},'✕')),
        el('div',{class:'slqty'},el('label',{},'كراتين',num('cartons',!p.PcsPerCarton)),el('label',{},'قطع',num('pieces',false)),
          el('label',{},'سعر القطعة',price)),
        el('div',{class:'inv-lt'},tot),cp,chg,stk,
        !p.PcsPerCarton&&el('small',{class:'warn'},'عدد القطع في الكرتونة غير محدد — الإدخال بالقطعة فقط'));
      refs.set(id,{p,l,tot,stk,cp,chg,root});rows.push(root);
    }
    linesBox.replaceChildren(...(rows.length?rows:[el('p',{class:'empty'},'لسه ما ضفتش أصناف')]));
  }
  function updateTotals(){
    msg.textContent='';let tp=0,sum=0,bad=0,invalid=0;
    for(const {p,l,tot,stk,cp,chg,root} of refs.values()){
      const t=toPieces(l.cartons,l.pieces,p.PcsPerCarton||0),pr=Number(l.price),okP=l.price!==''&&pr>0,lt=okP?r2(t*pr):0;
      tp+=t;sum+=lt;tot.textContent=`${fmt(t)} قطعة · ${money(lt)} ج.م`;
      cp.textContent=okP&&p.PcsPerCarton?`سعر الكرتونة: ${money(r2(pr*p.PcsPerCarton))} ج.م`:'';
      chg.textContent=okP&&p.PricePiece&&pr!==p.PricePiece?`السعر معدّل (الأصلي ${money(p.PricePiece)}) — هيتسجل في السجل`:'';
      const over=t>avail(p);if(over)bad++;if(t===0||!okP)invalid++;
      root.classList.toggle('over',over);stk.textContent=`الرصيد في المخزن: ${fmt(avail(p))} قطعة`+(over?' — الكمية أكبر من الرصيد':'');stk.className=over?'warn':'';
    }
    grand.textContent=money(r2(sum))+' ج.م';summary.textContent=lines.size?`${fmt(lines.size)} صنف · ${fmt(tp)} قطعة`:'';
    const why=!customer?'اختار العميل':!whSel.value?'اختار المخزن':!lines.size?'ضيف أصناف':invalid?'في صنف من غير كمية أو سعر':'';
    hint.textContent=why;
    confirmBtn.disabled=!!why||busy||!!(bad&&!(canOverride&&override.checked));
    if(ovWrap)ovWrap.hidden=!bad;
  }
  const renderLines=()=>{buildLines();updateTotals()};
  if(ovWrap)override.addEventListener('change',updateTotals);

  async function confirm(){
    if(busy)return;busy=true;confirmBtn.disabled=true;msg.textContent='';
    try{
      const items=[...lines].map(([id,l])=>({p:byId.get(id),cartons:l.cartons,pieces:l.pieces,unitPrice:Number(l.price)}));
      const r=await postInvoice({customer,warehouseId:whSel.value,items,user,notes:note.value.trim(),allowNegative:canOverride&&override.checked});
      showInvoiceView(user,r.inv.InvoiceID,onBack,{fresh:true});
    }catch(e){
      busy=false;
      if(e.code==='INSUFFICIENT'){const p=byId.get(e.productId);msg.textContent=`الرصيد مش كفاية للصنف «${p?.Name}» — المتاح ${fmt(e.available)} والمطلوب ${fmt(e.requested)}. ما اتسجلتش فاتورة.`;stock=await stockMap()}
      else msg.textContent='تعذر الحفظ على الجهاز. حاول مرة تانية. ('+(e.message||'')+')';
      updateTotals();
    }
  }
  const scanOnCode=text=>{const r=addFromScanText(text);
    if(r&&!Array.isArray(r))return{status:'ok',label:r.Name+' — '+r.Code};return Array.isArray(r)?{status:'multi'}:{status:'unknown'}};
  const sup=await scannerSupport();
  const scanBtn=sup?el('button',{class:'btn scanb',type:'button',onclick:()=>openScanner(scanOnCode)},'📷 مسح بالكاميرا'):null;
  const unitSw=el('div',{class:'unit-switch2',role:'group','aria-label':'المسح يضيف'},
    ['carton','piece'].map(u=>el('button',{type:'button',class:u===scanUnit?'on':'','data-u':u,onclick:e=>{scanUnit=u;[...e.currentTarget.parentNode.children].forEach(b=>b.classList.toggle('on',b.dataset.u===u))}},u==='carton'?'المسح = كرتونة':'المسح = قطعة')));
  $('#app').replaceChildren(el('div',{class:'wrap'},
    el('div',{class:'hello'},el('h2',{},'فاتورة جديدة'),el('button',{class:'btn ghost',type:'button',onclick:onBack},'رجوع')),
    custBox,el('label',{class:'field'},el('span',{},'المخزن'),whSel),el('label',{class:'field'},el('span',{},'ملاحظة'),note),
    q,scanBtn,unitSw,!scanBtn&&el('p',{class:'note'},'المسح بالكاميرا مش مدعوم هنا — اكتب الكود أو استخدم قارئ باركود.'),
    results,linesBox,summary,el('div',{class:'inv-bar'},el('span',{},'الإجمالي'),grand),ovWrap,msg,hint,confirmBtn));
  drawCustomer();renderLines();
}

// ---------- قائمة الفواتير ----------
export async function showInvoices(user,onBack){
  const canNew=await can(user,'CreateInvoice');
  const rows=(await all('invoices')).sort((a,b)=>b.DateTime.localeCompare(a.DateTime));
  const q=el('input',{type:'search',class:'psearch',placeholder:'ابحث برقم الفاتورة أو اسم العميل…',autocomplete:'off','aria-label':'بحث في الفواتير'});
  const list=el('div',{class:'plist cust'}),count=el('div',{class:'pcount'});
  const back=()=>showInvoices(user,onBack);
  function draw(){
    const toks=norm(q.value).split(' ').filter(Boolean);
    const r=rows.filter(i=>toks.every(k=>norm(i.CustomerName||'').includes(k)||i.Number.toLowerCase().includes(k)));
    count.textContent=`${fmt(r.length)} فاتورة`;
    list.replaceChildren(...(r.length?r.slice(0,100).map(i=>el('article',{class:'pcard ccard',tabindex:'0',role:'button',onclick:()=>showInvoiceView(user,i.InvoiceID,back),onkeydown:e=>{if(e.key==='Enter')showInvoiceView(user,i.InvoiceID,back)}},
      el('div',{class:'pbody'},el('h3',{},i.CustomerName||'—'),el('div',{class:'pmeta'},el('span',{class:'code',dir:'ltr'},i.Number),el('b',{},money(i.Total)+' ج.م')),
        el('div',{class:'pstock'},fdt(i.DateTime))))):[el('p',{class:'empty'},rows.length?'مفيش فاتورة مطابقة':'لسه ما فيش فواتير'+(canNew?' — دوس «فاتورة جديدة»':''))]));
  }
  q.addEventListener('input',draw);
  $('#app').replaceChildren(el('div',{class:'wrap'},el('div',{class:'hello'},el('h2',{},'الفواتير'),el('button',{class:'btn ghost',type:'button',onclick:onBack},'رجوع')),
    q,el('div',{class:'filters'},canNew&&el('button',{class:'btn',type:'button',onclick:()=>showInvoiceNew(user,back)},'+ فاتورة جديدة')),count,list));
  draw();
}

// ---------- عرض فاتورة + ملفاتها ----------
export async function showInvoiceView(user,invoiceId,onBack,{fresh=false}={}){
  const inv=await get('invoices',invoiceId);
  if(!inv){toast('الفاتورة مش موجودة');onBack();return}
  const lines=(await byIndex('invoice_lines','InvoiceID',invoiceId)).sort((a,b)=>a.LineNo-b.LineNo);
  const wh=(await all('warehouses')).find(w=>w.WarehouseID===inv.WarehouseID);
  const row=(k,v)=>el('div',{class:'drow'},el('span',{},k),el('b',{dir:'auto'},v||'—'));
  const qty=l=>[l.Cartons?`${l.Cartons} كرتونة`:'',l.Pieces?`${l.Pieces} قطعة`:''].filter(Boolean).join(' + ');
  const files=el('div',{class:'inv-files'}),status=el('p',{class:'note'});
  let urls=[];
  const dl=(blob,name)=>{const u=URL.createObjectURL(blob),a=el('a',{href:u,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)};
  const share=async(blobs,names,type)=>{
    const fs=blobs.map((b,i)=>new File([b],names[i],{type}));
    if(navigator.canShare?.({files:fs})){try{await navigator.share({files:fs,title:'فاتورة '+inv.Number,text:'فاتورة '+inv.Number+' — العراقي'});return}catch(e){if(e.name==='AbortError')return}}
    blobs.forEach((b,i)=>dl(b,names[i]));toast('المشاركة المباشرة مش مدعومة هنا — اتحمّل الملف على الجهاز');
  };
  async function generate(){
    status.textContent='بنجهّز ملف الفاتورة…';files.replaceChildren();urls.forEach(URL.revokeObjectURL);urls=[];
    try{
      const f=await buildInvoiceFiles(inv,lines),pn=inv.Number+'.pdf',inames=f.images.map((_,i)=>`${inv.Number}-${i+1}.jpg`);
      urls=f.images.map(b=>URL.createObjectURL(b));const pdfUrl=URL.createObjectURL(f.pdf);urls.push(pdfUrl);
      status.textContent=`الفاتورة جاهزة — ${f.pages} صفحة`;
      files.replaceChildren(el('div',{class:'btnrow'},
        el('button',{class:'btn',type:'button',onclick:()=>dl(f.pdf,pn)},'⬇ تحميل PDF'),
        el('button',{class:'btn',type:'button',onclick:()=>share([f.pdf],[pn],'application/pdf')},'📤 مشاركة PDF'),
        el('button',{class:'btn ghost',type:'button',onclick:()=>share(f.images,inames,'image/jpeg')},'🖼 مشاركة كصور'),
        el('button',{class:'btn ghost',type:'button',onclick:()=>window.open(pdfUrl,'_blank')},'🖨 فتح للطباعة')),
        el('div',{class:'inv-pages'},...urls.slice(0,f.images.length).map((u,i)=>el('img',{src:u,alt:`صفحة ${i+1}`}))));
    }catch(e){status.textContent='تعذر تجهيز الملف: '+(e.message||'');files.replaceChildren(el('button',{class:'btn ghost',type:'button',onclick:generate},'إعادة المحاولة'))}
  }
  $('#app').replaceChildren(el('div',{class:'wrap'},
    el('div',{class:'hello'},el('h2',{},fresh?'✅ تم حفظ الفاتورة':'فاتورة'),el('button',{class:'btn ghost',type:'button',onclick:onBack},'رجوع')),
    row('رقم الفاتورة',inv.Number),row('التاريخ',fdt(inv.DateTime)),row('العميل',inv.CustomerName),row('الهاتف',inv.CustomerPhone),
    row('المخزن',wh?.Name),row('الموظف',inv.UserName),row('الإجمالي',money(inv.Total)+' ج.م'),inv.Notes&&row('ملاحظة',inv.Notes),
    el('h3',{class:'sec'},'الأصناف'),
    ...lines.map(l=>el('div',{class:'drow'},el('span',{},`${l.Name} · ${l.Code} — ${qty(l)}`),
      el('b',{},`${money(l.UnitPrice)} × ${fmt(l.TotalPieces)} = ${money(l.LineTotal)}`+(l.PriceChanged?` (السعر الأصلي ${money(l.OriginalUnitPrice)})`:'')))),
    el('h3',{class:'sec'},'ملف الفاتورة (A4)'),status,files,
    fresh&&el('button',{class:'btn ghost wide',type:'button',onclick:()=>showInvoiceNew(user,onBack)},'+ فاتورة جديدة')));
  generate();
}
