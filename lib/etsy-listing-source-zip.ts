import type { ListingAsset } from './etsy-listing-image-plan';

/**
 * ZIP is an honest, downloadable archive of user-selected ORIGINAL bytes.
 * OpenAI Vision cannot directly view PNGs inside a ZIP input_file: the same
 * selected source IDs are separately delivered as numbered image contact
 * sheets to the Responses API. Never use arbitrary external URLs as R2 keys.
 */
const UUID = /^[0-9a-f-]{36}$/i;

export function originalAssetStorageKey(asset: ListingAsset, owner: string): {key:string; extension:'png'|'jpg'} | null {
  if (!UUID.test(asset.id) || !asset.imageUrl) return null;
  let url: URL;
  try { url=new URL(asset.imageUrl,'https://app.local'); }
  catch { return null; }
  const match=/^\/api\/images\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if(url.origin!=='https://app.local'||!match||match[1].toLowerCase()!==asset.id.toLowerCase()) return null;
  const extension=url.searchParams.get('format')==='jpg'?'jpg':'png';
  const batch=url.searchParams.get('batch');
  if(batch!==null&&!UUID.test(batch)) return null;
  return {key:batch
    ? 'generated/'+owner+'/batches/'+batch+'/'+asset.id+'.'+extension
    : 'generated/'+owner+'/'+asset.id+'.'+extension,
    extension};
}

export function sourceZipFilename(index: number, asset: ListingAsset, extension: 'png'|'jpg'): string {
  const label=asset.name.normalize('NFKD').replace(/[^a-zA-Z0-9-_ ]/g,'').trim()
    .replace(/\s+/g,'-').slice(0,55)||'clipart';
  return 'clipart/'+String(index+1).padStart(4,'0')+'-'+label+'-'+asset.id.slice(0,8)+'.'+extension;
}

export function selectedSourceManifest(input:{
  theme:string; title:string; subtitle:string; badge:string; prompt:string;
  assets:Array<{assetId:string;name:string;category?:string;file:string}>;
}){
  return {
    format:'paletteiq-original-clipart-source-v1',
    purpose:'Etsy thumbnail source art. ZIP is NOT an OpenAI vision input.',
    artworkRule:'Use these original PNG/JPG bytes in final composite, never regenerate them.',
    canvas:{width:1024,height:1024},
    theme:input.theme,
    lettering:{title:input.title,subtitle:input.subtitle,badge:input.badge},
    clipart:input.assets,
    prompt:input.prompt
  };
}
