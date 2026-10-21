import {createApi} from './transport.js?v=receipt-1';
import {config} from './config.js';
import {paymentReceipt,receiptSvg,receiptLink,downloadReceipt} from './receipts.js?v=receipt-1';
const api=createApi(config),id=Number(new URL(location.href).searchParams.get('payment'));
const $=selector=>document.querySelector(selector);
let receipt;
async function load(){
 receipt=null;$('.receipt-controls').hidden=true;$('#receiptPreview').innerHTML='';$('#receiptError').textContent='';$('#retryReceipt').hidden=true;$('#receiptStatus').textContent='Ödeme kaydı kontrol ediliyor…';
 try{
  receipt=paymentReceipt(await api('state'),id);$('#receiptPreview').innerHTML=receiptSvg(receipt,receiptLink(location.href,id));$('.receipt-controls').hidden=false;$('#receiptStatus').textContent='Ödeme kaydı mevcut.';document.title=receipt.number+' · Ödeme makbuzu';
 }catch(error){$('#receiptStatus').textContent='Makbuz doğrulanamadı.';$('#receiptError').textContent=error.message;$('#retryReceipt').hidden=false;}
}
$('#downloadReceipt').addEventListener('click',async()=>{
 const button=$('#downloadReceipt');button.disabled=true;
 try{const current=paymentReceipt(await api('state'),id);await downloadReceipt(current,receiptLink(location.href,id));}
 catch(error){await load();$('#receiptError').textContent=error.message;}finally{button.disabled=false;}
});
$('#printReceipt').addEventListener('click',async()=>{await load();if(receipt)window.print();});
$('#retryReceipt').addEventListener('click',load);
load();
