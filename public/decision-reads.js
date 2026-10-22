export function decisionReadPayload(decision,unitId){
 const unit=Number(unitId);
 if(!Number.isInteger(unit)||unit<=0)throw Error('Dairenizi / dükkânınızı seçin.');
 if(!Number.isInteger(decision?.id)||!decision.version||decision.archived)throw Error('Karar değişmiş veya arşivlenmiş. Listeyi yenileyin.');
 return {operation:'mark',decisionId:decision.id,unitId:unit,version:decision.version};
}
