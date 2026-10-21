export function changeInfo(entry){
 const row=entry.after_row||entry.before_row;
 if(!row||!['payment','expense'].includes(entry.entity)||!['INSERT','UPDATE','DELETE'].includes(entry.operation))throw new Error('Geçersiz işlem kaydı.');
 const names={payment:{INSERT:'Ödeme alındı',DELETE:'Ödeme iptal edildi'},expense:{INSERT:'Gider eklendi',UPDATE:'Gider düzenlendi',DELETE:'Gider silindi'}};
 const before=Number(entry.before_row?.amount||0),after=Number(entry.after_row?.amount||0);
 const cashChange=(entry.entity==='payment'?1:-1)*(before-after);
 const debtChange=entry.entity==='payment'?after-before:0;
 return {title:entry.undo_of?'İşlem geri alındı':names[entry.entity][entry.operation]||'Ödeme değişti',row,cashChange,debtChange,canUndo:!entry.undo_of&&!entry.undone_at};
}
