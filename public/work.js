export const statusName=status=>({pending:'Bekliyor',in_progress:'Devam ediyor',done:'Tamamlandı'})[status]||status;
export function openTasks(tasks,today){
 return tasks.filter(t=>!t.archived&&t.status!=='done').sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999')||a.id-b.id);
}
export function taskSave(task,changes={}){
 return {operation:'save',id:task.id,version:task.version,title:task.title,notes:task.notes,assignee:task.assignee,dueDate:task.due_date||'',status:task.status,decisionId:task.decision_id||'',...changes};
}
