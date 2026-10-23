// A display preference only: never grants access or changes the shared records.
export const MY_UNIT_KEY='komsu-apartman-unit-v1';
export function createUnitPreference(host){
 let value=null;try{value=host.localStorage.getItem(MY_UNIT_KEY);}catch{}
 const valid=(candidate,units)=>{const id=Number(candidate);return Number.isSafeInteger(id)&&id>0&&units.some(u=>u.id===id)?id:null;};
 return {
  get(units){return valid(value,units);},
  set(candidate,units){const id=valid(candidate,units);if(!id)throw new Error('Dairenizi / dükkânınızı seçin.');value=String(id);try{host.localStorage.setItem(MY_UNIT_KEY,value);return true;}catch{return false;}},
  sync(valueFromStorage){value=valueFromStorage;}
 };
}
