// مسح الباركود/QR بالكاميرا. بيستخدم BarcodeDetector لو موجود (كروم أندرويد)، وإلا مكتبة jsQR المحلية js/vendor/jsQR.js
// (لو الملف مش موجود، الزرار ما بيظهرش — والكتابة اليدوية وقارئ الباركود الخارجي شغالين زي ما هما).
import {el,toast} from './ui.js';
let _support;
function loadJsQR(){
  return new Promise(res=>{
    if(window.jsQR) return res(true);
    const s=document.createElement('script');s.src='js/vendor/jsQR.js';
    s.onload=()=>res(typeof window.jsQR==='function');s.onerror=()=>res(false);document.head.append(s);
  });
}
export async function scannerSupport(){
  if(_support!==undefined) return _support;
  if(!navigator.mediaDevices?.getUserMedia) return (_support=null);
  if('BarcodeDetector' in window) return (_support='native');
  return (_support=(await loadJsQR())?'jsqr':null);
}
const beep=()=>{try{const a=new (window.AudioContext||window.webkitAudioContext)(),o=a.createOscillator();o.frequency.value=880;o.connect(a.destination);o.start();setTimeout(()=>{o.stop();a.close()},90)}catch{}navigator.vibrate?.(40)};

// onCode(text) لازم يرجّع {status:'ok'|'unknown'|'multi', label?}  — 'multi' بيقفل الكاميرا (المستخدم يختار بعدها)
export async function openScanner(onCode){
  const mode=await scannerSupport(); if(!mode){toast('المسح بالكاميرا غير متاح على الجهاز ده');return}
  let stream,stop=false,last='',lastAt=0;
  const video=el('video',{playsinline:'',muted:'',autoplay:''}),status=el('div',{class:'scanstatus'},'وجّه الكاميرا ناحية الباركود');
  const close=()=>{stop=true;stream?.getTracks().forEach(t=>t.stop());ov.remove()};
  const ov=el('div',{class:'overlay scan'},el('div',{class:'scanbox'},video,el('div',{class:'scanframe'}),status,
    el('div',{class:'scanbar'},el('button',{class:'btn ghost',type:'button',onclick:close},'إنهاء المسح'))));
  document.body.append(ov);
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    video.srcObject=stream;await video.play();
    const det=mode==='native'?new BarcodeDetector({formats:['qr_code','code_128','code_39','ean_13','ean_8','upc_a']}):null;
    const cv=document.createElement('canvas'),cx=cv.getContext('2d',{willReadFrequently:true});
    const read=async()=>{
      if(det){const c=await det.detect(video);return c.length?c[0].rawValue:null}
      const vw=video.videoWidth,vh=video.videoHeight;if(!vw)return null;const k=Math.min(1,640/vw);
      cv.width=Math.round(vw*k);cv.height=Math.round(vh*k);cx.drawImage(video,0,0,cv.width,cv.height);
      const img=cx.getImageData(0,0,cv.width,cv.height);const r=window.jsQR(img.data,cv.width,cv.height,{inversionAttempts:'dontInvert'});
      return r?r.data:null;
    };
    const loop=async()=>{
      if(stop)return;
      try{const v=await read();const now=Date.now();
        if(v&&(v!==last||now-lastAt>1800)){last=v;lastAt=now;const r=onCode(v)||{};
          if(r.status==='ok'){beep();status.textContent='✔ '+(r.label||v)}
          else if(r.status==='multi'){status.textContent='أكتر من صنف بنفس الكود — اختار بعد الإنهاء';close();return}
          else status.textContent='✖ كود غير معروف: '+v}
      }catch{}
      setTimeout(loop,mode==='native'?220:300);
    };loop();
  }catch{close();toast('تعذر تشغيل الكاميرا — اسمح بالوصول أو اكتب الكود يدوي')}
}
