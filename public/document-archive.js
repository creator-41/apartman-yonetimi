import {validateReceipt} from './expense-files.js';
export const DOCUMENT_CATEGORIES=['Yönetim planı','Karar defteri','Sözleşme','Fatura','Diğer'];
export function archiveFields(title,category,shared){
 title=String(title||'').trim();if(!title||title.length>120||!DOCUMENT_CATEGORIES.includes(category))throw new Error('Başlık ve kategori seçin.');
 return {title,category,shared:shared===true};
}
export function filterDocuments(rows,{query='',category='',archived=false}={}){
 const q=query.trim().toLocaleLowerCase('tr-TR');
 return rows.filter(d=>Boolean(d.archived)===archived&&(!category||d.category===category)&&(!q||[d.title,d.file_name,d.category].some(s=>String(s).toLocaleLowerCase('tr-TR').includes(q))));
}
// Keep reservations after uncertain responses; a retry reuses the same ID and confirms stored bytes.
export async function uploadArchiveDocument(api,{id,...fields},file){
 const metadata=validateReceipt(file),reserved=await api('documents/manage','POST',{operation:'reserve',id,...fields,...metadata});
 if(reserved.file.uploaded)return reserved.file;
 try{await api('archive-files/upload','POST',{path:reserved.file.path,file});}
 catch(uploadError){try{return (await api('documents/manage','POST',{operation:'complete',id})).file;}catch{throw uploadError;}}
 return (await api('documents/manage','POST',{operation:'complete',id})).file;
}
