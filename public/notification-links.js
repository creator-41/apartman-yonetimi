export function adminRequestFromHash(hash=''){
 const match=/^#yonetim-talep=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hash);
 return match?match[1].toLowerCase():null;
}
