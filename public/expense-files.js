export const RECEIPT_LIMIT=10*1024*1024;
export const RECEIPT_TYPES=['image/jpeg','image/png','image/webp','application/pdf'];
export function validateReceipt(file){
 if(!file||!Number.isInteger(file.size)||file.size<1)throw new Error('Bir belge seçin.');
 if(!RECEIPT_TYPES.includes(file.type))throw new Error('JPG, PNG, WEBP veya PDF seçin.');
 if(file.size>RECEIPT_LIMIT)throw new Error('Belge en fazla 10 MB olabilir.');
 if(!file.name||file.name.length>150)throw new Error('Dosya adı 1–150 karakter olmalıdır.');
 return {fileName:file.name,mimeType:file.type,bytes:file.size};
}
export function expenseUpdate(expense,values){
 return {operation:'update',expenseId:expense.id,expected:{category:expense.category,description:expense.description,amount:expense.amount,date:expense.date},...values};
}
// The expense is already saved before any file transfer. Retrying never creates a new expense.
export async function uploadReceipt(api,expenseId,file,kind='expense'){
 const metadata=validateReceipt(file);
 const result=await api('expenses/manage','POST',{operation:kind==='decision'?'reserve-decision':'reserve',...(kind==='decision'?{decisionId:expenseId}:{expenseId}),...metadata});
 const reserved=result.file;
 try{
  await api('files/upload','POST',{path:reserved.path,file});
  await api('expenses/manage','POST',{operation:'complete',fileId:reserved.id});
  return reserved;
 }catch(error){
  try{
   await api('files/remove','DELETE',{path:reserved.path});
   await api('expenses/manage','POST',{operation:'remove',fileId:reserved.id});
  }catch{error.message+=' Tamamlanmamış kaydı Belgeler bölümünden kaldırabilirsiniz.';}
  throw error;
 }
}
export async function removeReceipt(api,file){
 await api('files/remove','DELETE',{path:file.path});
 await api('expenses/manage','POST',{operation:'remove',fileId:file.id});
}
