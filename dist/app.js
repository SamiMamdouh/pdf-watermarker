import * as pdfjs from './vendor/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
let sourceBytes, sourceDoc, sourceName = '', pageNumber = 1, names = [], busy = false, loading = false;
let renderSerial = 0, loadSerial = 0, resultUrl, statusTimer;
const fontReady = document.fonts.load('48px Arabic');
const controls = ['size','opacity','angle','color','position'];
function notify(message, persistent = false) { clearTimeout(statusTimer); $('status').textContent = message; $('status').classList.add('show'); if (!persistent) statusTimer = setTimeout(() => $('status').classList.remove('show'), 6500); }
function settings() { return {size: +$('size').value, opacity: +$('opacity').value / 100, angle: +$('angle').value, color: $('color').value, position: $('position').value}; }
function updateNames() {
  const previous = $('recipient').selectedIndex;
  names = $('names').value.split(/\r?\n/).map(n => n.trim()).filter(Boolean);
  $('nameCount').textContent = `${names.length} name${names.length === 1 ? '' : 's'}`;
  $('recipient').replaceChildren(...(names.length ? names.map((name,i) => new Option(`${i+1}. ${name}`, String(i))) : [new Option('Add names to preview','')]));
  $('recipient').selectedIndex = Math.max(0, Math.min(previous, names.length-1));
  $('recipient').disabled = !names.length;
  updateSummary(); renderOverlay();
}
function updateSummary() {
  const count = (sourceDoc?.numPages || 0) * names.length;
  $('summary').textContent = sourceDoc && names.length ? `${names.length} personalized copies × ${sourceDoc.numPages} pages = ${count} pages` : 'Add a PDF and names to get started.';
  $('generate').disabled = busy || loading || !sourceDoc || !names.length;
}
function updateNavigation() {
  $('pageInfo').textContent = sourceDoc ? `${pageNumber} / ${sourceDoc.numPages}` : '— / —';
  $('prev').disabled = !sourceDoc || pageNumber <= 1;
  $('next').disabled = !sourceDoc || pageNumber >= sourceDoc.numPages;
  $('copyInfo').textContent = names.length && sourceDoc ? `Copy ${$('recipient').selectedIndex + 1} of ${names.length} · Watermarked on every page` : sourceDoc ? 'Add names to personalize this document.' : 'A little personalization goes a long way.';
}
function makeOverlay(width, height, name, options, scale = 2) {
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  if (!name) return canvas;
  ctx.font = `600 ${options.size}px Arabic`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = /[\u0600-\u06ff]/.test(name) ? 'rtl' : 'ltr';
  const maxWidth = options.position === 'repeat' ? width * .42 : width * .78;
  const measured = ctx.measureText(name).width;
  const fitSize = options.size * Math.min(1, maxWidth / Math.max(measured, 1));
  ctx.font = `600 ${fitSize}px Arabic`; ctx.fillStyle = options.color; ctx.globalAlpha = options.opacity;
  const stamp = (x,y) => {ctx.save();ctx.translate(x,y);ctx.rotate(options.angle * Math.PI / 180);ctx.fillText(name,0,0);ctx.restore();};
  if (options.position === 'repeat') { for(let y = height*.17; y < height; y += height / 3) {stamp(width*.25,y);stamp(width*.75,y);} }
  else stamp(width/2, options.position === 'top' ? height*.18 : options.position === 'bottom' ? height*.82 : height/2);
  return canvas;
}
let currentViewport;
async function renderOverlay() {
  await fontReady;
  updateNavigation(); if (!currentViewport || !sourceDoc) return;
  const stamp = makeOverlay(currentViewport.width, currentViewport.height, names[+$('recipient').value] || '', settings());
  const overlay = $('overlay'); overlay.width = stamp.width; overlay.height = stamp.height; overlay.getContext('2d').drawImage(stamp,0,0);
}
async function renderPage() {
  const serial = ++renderSerial; if (!sourceDoc) return;
  $('loading').hidden = false; updateNavigation();
  try {
    const page = await sourceDoc.getPage(pageNumber); if (serial !== renderSerial) return;
    const viewport = page.getViewport({scale:1});
    const canvas = document.createElement('canvas'); const zoom = Math.min(2, 1600 / viewport.width);
    const renderedViewport = page.getViewport({scale:zoom}); canvas.width = Math.ceil(renderedViewport.width); canvas.height = Math.ceil(renderedViewport.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport:renderedViewport}).promise;
    if(serial !== renderSerial) return;
    currentViewport = viewport;
    const target = $('pageCanvas'); target.width = canvas.width; target.height = canvas.height; target.getContext('2d').drawImage(canvas,0,0);
    $('paper').style.width = `${Math.min(viewport.width, 610)}px`; $('paper').hidden = false; $('empty').hidden = true;
    await renderOverlay();
  } catch(e) {console.error(e); if(serial === renderSerial) notify('This page could not be previewed. Try another PDF.');}
  finally {if(serial === renderSerial) $('loading').hidden = true;}
}
async function loadPdf(bytes, name) {
  const serial = ++loadSerial; loading = true; updateSummary(); $('loading').hidden = false;
  try {
    const test = await PDFLib.PDFDocument.load(bytes.slice());
    if (test.isEncrypted) throw new Error('encrypted');
    const doc = await pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false}).promise;
    if (serial !== loadSerial) {doc.destroy();return;}
    if (!doc.numPages) throw new Error('empty');
    const previous = sourceDoc; ++renderSerial; sourceBytes = bytes; sourceDoc = doc; sourceName = name; pageNumber = 1; currentViewport = null;
    if(previous) previous.destroy();
    $('fileLabel').textContent = name; $('fileDetail').textContent = `${doc.numPages} page${doc.numPages === 1 ? '' : 's'} · ${(bytes.length / 1024 / 1024).toFixed(2)} MB · Click to replace`;
    $('previewType').textContent = name === 'Sample document.pdf' ? 'SAMPLE DOCUMENT' : 'YOUR DOCUMENT';
    await renderPage();
  } catch(e) {console.error(e);if(serial === loadSerial) notify('Unable to open this PDF. Use a valid, password-free PDF document.');}
  finally {if(serial === loadSerial) {loading = false;$('loading').hidden = true;updateSummary();}}
}
async function acceptFile(file) {
  if(!file || busy || loading) return;
  if(!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return notify('Please choose a PDF file.');
  if(file.size > 40*1024*1024) return notify('Please choose a PDF smaller than 40 MB.');
  await loadPdf(new Uint8Array(await file.arrayBuffer()), file.name);
  $('file').value = '';
}
$('file').addEventListener('change', e=>acceptFile(e.target.files[0]));
$('drop').addEventListener('keydown',e=>{if(e.key === 'Enter' || e.key === ' ') {e.preventDefault();$('file').click();}});
for(const type of ['dragover','dragenter']) $('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.add('drag');});
for(const type of ['dragleave','drop']) $('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.remove('drag');if(type === 'drop') acceptFile(e.dataTransfer.files[0]);});
window.addEventListener('dragover',e=>e.preventDefault()); window.addEventListener('drop',e=>e.preventDefault());
$('names').addEventListener('input',updateNames); $('recipient').addEventListener('change',renderOverlay);
for(const id of controls) $(id).addEventListener('input',()=>{updateOutputs();renderOverlay();});
function updateOutputs() {$('sizeOut').textContent = `${$('size').value} pt`;$('opacityOut').textContent = `${$('opacity').value}%`;$('angleOut').textContent = `${$('angle').value}°`;}
function defaults() {$('size').value=48;$('opacity').value=20;$('angle').value=-35;$('color').value='#52607a';$('position').value='center';updateOutputs();renderOverlay();}
$('defaults').addEventListener('click',defaults);
$('prev').addEventListener('click',()=>{if(pageNumber>1) {pageNumber--;renderPage();}});
$('next').addEventListener('click',()=>{if(sourceDoc && pageNumber<sourceDoc.numPages) {pageNumber++;renderPage();}});
$('reset').addEventListener('click',()=>{
  if(busy) return; ++loadSerial;++renderSerial; loading=false;sourceDoc?.destroy();sourceDoc=null;sourceBytes=null;currentViewport=null;sourceName='';$('names').value='';$('file').value='';$('fileLabel').textContent='Choose a PDF or drop it here';$('fileDetail').textContent='Up to 40 MB · processed on your device';$('paper').hidden=true;$('empty').hidden=false;$('loading').hidden=true;$('previewType').textContent='YOUR DOCUMENT';updateNames();defaults();clearResult();
});
$('sample').addEventListener('click',async()=>{
  if(busy || loading) return;
  const {PDFDocument,StandardFonts,rgb}=PDFLib; const doc=await PDFDocument.create(); const font=await doc.embedFont(StandardFonts.Helvetica); const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  for(let i=0;i<2;i++) {const p=doc.addPage([595.28,841.89]);p.drawRectangle({x:46,y:748,width:38,height:38,color:rgb(.39,.39,.76)});p.drawText('ism',{x:54,y:761,size:16,font:bold,color:rgb(1,1,1)});p.drawText('THE LEARNING COLLECTIVE',{x:99,y:764,size:10,font:bold,color:rgb(.4,.44,.53)});p.drawText(i?'Space to think.':'A fresh perspective.',{x:48,y:664,size:30,font:bold,color:rgb(.13,.18,.25)});p.drawText(i?'NOTES & REFLECTIONS':'WORKSHOP HANDBOOK  /  SAMPLE DOCUMENT',{x:49,y:631,size:10,font,color:rgb(.47,.51,.59)});p.drawLine({start:{x:49,y:608},end:{x:547,y:608},thickness:1,color:rgb(.85,.87,.91)});if(!i){p.drawText('Good ideas begin with a little curiosity.',{x:49,y:565,size:16,font:bold,color:rgb(.25,.3,.39)});['This is a sample document for your first personalized print run.','Add your names on the left, then adjust the watermark to suit','your document. Every recipient receives a complete copy.'].forEach((t,j)=>p.drawText(t,{x:49,y:528-j*23,size:12,font,color:rgb(.44,.48,.56)}));}for(let y=i?560:400;y>140;y-=35)p.drawLine({start:{x:49,y},end:{x:547,y},thickness:.6,color:rgb(.9,.91,.94)});p.drawText('Prepared with care. Made for you.',{x:49,y:64,size:10,font,color:rgb(.55,.59,.66)});p.drawText(`0${i+1}`,{x:529,y:64,size:10,font,color:rgb(.55,.59,.66)});}
  if(!$('names').value.trim()) {$('names').value='أحمد محمد\nسارة علي\nعمر حسن';updateNames();}
  await loadPdf(await doc.save(),'Sample document.pdf');
});
function clearResult() {if(resultUrl) {URL.revokeObjectURL(resultUrl);resultUrl=null;}$('resultFrame').removeAttribute('src');}
function setBusy(value) {busy=value;for(const id of [...controls,'names','file','recipient','reset','sample','defaults']) $(id).disabled = value;$('generate').textContent=value?'Preparing copies…':'Preview all copies';updateSummary();if(!value)$('recipient').disabled=!names.length;}
async function generate() {
  if(busy || loading || !sourceDoc || !names.length) return;
  if(names.length>150) return notify('Please use up to 150 names per print run.');
  if(names.some(n=>n.length>160)) return notify('One name is very long. Please keep each name under 160 characters.');
  if(names.length*sourceDoc.numPages>1500) return notify('This print run exceeds 1,500 pages. Please split the names into smaller groups.');
  setBusy(true); notify('Preparing personalized copies…',true);
  try {
    await fontReady; const opts=settings(); const recipients=[...names];
    const {PDFDocument,pushGraphicsState,popGraphicsState,concatTransformationMatrix}=PDFLib;
    const original=await PDFDocument.load(sourceBytes.slice());
    const form=original.getForm(); if(form.getFields().length) form.flatten();
    const out=await PDFDocument.create();out.setTitle('Personalized copies');out.setProducer('Ism PDF Watermark Studio');
    const dimensions=[];
    for(let i=1;i<=sourceDoc.numPages;i++) {const p=await sourceDoc.getPage(i);dimensions.push(p.getViewport({scale:1}));}
    for(let n=0;n<recipients.length;n++) {
      const copies=await out.copyPages(original,original.getPageIndices()); const cache=new Map();
      for(let i=0;i<copies.length;i++) {
        const page=out.addPage(copies[i]),v=dimensions[i],key=`${v.width},${v.height}`;
        let image=cache.get(key);if(!image){const overlay=makeOverlay(v.width,v.height,recipients[n],opts);image=await out.embedPng(overlay.toDataURL('image/png'));cache.set(key,image);}
        // Map the visible page coordinates through its inverse viewport transform.
        // This preserves watermark position on rotated and cropped source pages.
        const [a,b,c,d,e,f]=v.transform,det=a*d-b*c;
        const ia=d/det,ib=-b/det,ic=-c/det,id=a/det,ie=(c*f-d*e)/det,iff=(b*e-a*f)/det;
        page.pushOperators(pushGraphicsState(),concatTransformationMatrix(ia*v.width,ib*v.width,-ic*v.height,-id*v.height,ic*v.height+ie,id*v.height+iff));
        page.drawImage(image,{x:0,y:0,width:1,height:1});page.pushOperators(popGraphicsState());
      }
      $('generate').textContent=`Preparing copy ${n+1} of ${recipients.length}…`;await new Promise(r=>setTimeout(r,0));
    }
    const bytes=await out.save();clearResult();resultUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    $('resultFrame').src=resultUrl+'#toolbar=1&view=FitH';$('download').href=resultUrl;$('openPdf').href=resultUrl;
    $('download').download=sourceName.replace(/\.pdf$/i,'')+' — personalized.pdf';
    $('resultInfo').textContent=`${recipients.length} copies · ${out.getPageCount()} pages · In the same order as your names`;
    $('result').showModal();$('status').classList.remove('show');
  } catch(e) {console.error(e);notify('Could not prepare this PDF. It may contain unsupported content. Try another PDF or a smaller print run.');}
  finally {setBusy(false);}
}
$('generate').addEventListener('click',generate);$('closeResult').addEventListener('click',()=>$('result').close());
$('print').addEventListener('click',()=>{try {$('resultFrame').contentWindow.focus();$('resultFrame').contentWindow.print();}catch {notify('Use Open PDF to print from your browser’s PDF viewer.');}});
updateNames();updateOutputs();
