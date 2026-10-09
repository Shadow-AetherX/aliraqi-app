// قاعدة البيانات المحلية (IndexedDB) — مصدر الحقيقة للمخزون هو دفتر الحركات movements مش رقم رصيد ثابت
const DB_NAME='aliraqi', DB_VER=1;
const STORES={
  products:{keyPath:'ProductID'}, customers:{keyPath:'CustomerID'}, warehouses:{keyPath:'WarehouseID'},
  invoices:{keyPath:'InvoiceID'}, invoice_lines:{keyPath:'LineID',indexes:['InvoiceID','ProductID']},
  movements:{keyPath:'MovementID',indexes:['ProductID','WarehouseID','ReferenceID']},
  users:{keyPath:'UserID'}, roles:{keyPath:'RoleID'}, audit:{keyPath:'AuditID'},
  syncq:{keyPath:'OpID',indexes:['Status']}, settings:{keyPath:'key'}
};
let _db;
export function openDB(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const rq=indexedDB.open(DB_NAME,DB_VER);
    rq.onupgradeneeded=()=>{const db=rq.result;
      for(const [n,c] of Object.entries(STORES)){
        if(db.objectStoreNames.contains(n)) continue;
        const s=db.createObjectStore(n,{keyPath:c.keyPath});
        (c.indexes||[]).forEach(i=>s.createIndex(i,i));
      }};
    rq.onsuccess=()=>{_db=rq.result;res(_db)}; rq.onerror=()=>rej(rq.error);
  });
}
const tx=async(store,mode,fn)=>{const db=await openDB();return new Promise((res,rej)=>{
  const t=db.transaction(store,mode);const out=fn(t);t.oncomplete=()=>res(out.result??out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})};
export const get=(s,k)=>tx(s,'readonly',t=>t.objectStore(s).get(k));
export const all=(s)=>tx(s,'readonly',t=>t.objectStore(s).getAll());
export const byIndex=(s,i,v)=>tx(s,'readonly',t=>t.objectStore(s).index(i).getAll(v));
export const put=(s,o)=>tx(s,'readwrite',t=>t.objectStore(s).put(o));
export const uuid=()=>crypto.randomUUID();
export const nowISO=()=>new Date().toISOString();

// ---- دفتر الحركات ----
// QuantityPieces موجب = دخول، سالب = خروج. التحويل = حركتين بنفس TransferID.
export async function addMovement({productId,warehouseId,type,qtyPieces,ref,userId,deviceId,notes=''}){
  if(!Number.isInteger(qtyPieces)||qtyPieces===0) throw new Error('كمية غير صالحة');
  const m={MovementID:uuid(),DateTime:nowISO(),ProductID:productId,WarehouseID:warehouseId,MovementType:type,
    QuantityPieces:qtyPieces,ReferenceID:ref||null,UserID:userId,DeviceID:deviceId,SyncStatus:'PENDING',Notes:notes};
  await put('movements',m);
  await put('syncq',{OpID:uuid(),Entity:'movements',EntityID:m.MovementID,Status:'PENDING',CreatedAt:m.DateTime,Tries:0});
  return m;
}
export async function stockOf(productId,warehouseId){
  const ms=await byIndex('movements','ProductID',productId);
  return ms.filter(m=>!warehouseId||m.WarehouseID===warehouseId).reduce((s,m)=>s+m.QuantityPieces,0);
}
export const toPieces=(cartons,pieces,pcsPerCarton)=>cartons*pcsPerCarton+pieces;
export async function audit(user,action,entity,id,oldV,newV,deviceId){
  await put('audit',{AuditID:uuid(),UserID:user.UserID,UserName:user.Name,Action:action,EntityType:entity,EntityID:id,
    DateTime:nowISO(),DeviceID:deviceId,OldValue:oldV??null,NewValue:newV??null,SyncStatus:'PENDING'});
}
export async function pendingCount(){const q=await byIndex('syncq','Status','PENDING');return q.length}
export function deviceId(){let d=localStorage.getItem('alr_device');if(!d){d='D-'+uuid().slice(0,6).toUpperCase();localStorage.setItem('alr_device',d)}return d}
