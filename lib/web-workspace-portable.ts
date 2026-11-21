/**
 * Asset references in saved PaletteIQ Collection JSON. Only namespaced
 * images/thumbnail URLs are exportable; external Etsy reference photographs
 * are intentionally not copied into local workspace backups.
 */
export type WorkspaceAsset = {
  kind:'image'|'thumbnail'; id:string; format:'png'|'jpg';batch?:string;projectId?:string;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PORTABLE_WEB_FORMAT='paletteiq-web-workspace-export';
export const PORTABLE_WEB_VERSION=1;
export function workspaceImageReference(value:unknown):WorkspaceAsset|null {
  if(typeof value!=='string'||!value.includes('/api/'))return null;
  let url:URL;
  try{url=new URL(value,'http://paletteiq.internal');}catch{return null;}
  if(url.pathname.startsWith('/api/images/')){
    const id=url.pathname.slice('/api/images/'.length);
    const format=url.searchParams.get('format')||'png';
    const batch=url.searchParams.get('batch');
    if(!uuid.test(id)||!['png','jpg'].includes(format)||(batch&&!uuid.test(batch)))return null;
    return {kind:'image',id,format:format as 'png'|'jpg',...(batch?{batch}:{})};
  }
  if(url.pathname==='/api/thumbnail-background'){
    const id=url.searchParams.get('assetId');
    const projectId=url.searchParams.get('projectId');
    const format=url.searchParams.get('format');
    if(!id||!projectId||!uuid.test(id)||!uuid.test(projectId)||!['png','jpg'].includes(format||''))return null;
    return {kind:'thumbnail',id,projectId,format:format as 'png'|'jpg'};
  }
  return null;
}
export function collectWorkspaceAssets(project:unknown):WorkspaceAsset[] {
  if(!project||typeof project!=='object'||Array.isArray(project))throw Error('Invalid collection');
  const p=project as {id?:unknown};
  if(typeof p.id!=='string'||!uuid.test(p.id))throw Error('Invalid collection ID');
  const map=new Map<string,WorkspaceAsset>();
  const visit=(value:unknown,depth:number):void=>{
    if(depth>30)throw Error('Collection nesting exceeds supported export depth');
    if(typeof value==='string'){
      const asset=workspaceImageReference(value);
      if(asset && (asset.kind!=='thumbnail'||asset.projectId===p.id)){
        const key=asset.kind+':'+asset.id+':'+(asset.batch||'')+':'+asset.format;
        map.set(key,asset);
      }
    }else if(Array.isArray(value))for(const item of value)visit(item,depth+1);
    else if(value&&typeof value==='object')for(const item of Object.values(value))visit(item,depth+1);
  };
  visit(project,0);
  return [...map.values()];
}
export function workspaceAssetPaths(owner:string,asset:WorkspaceAsset) {
  if(!/^[a-zA-Z0-9_-]{1,120}$/.test(owner))throw Error('Invalid export owner');
  const relative=(asset.batch?'batches/'+asset.batch+'/':'')+asset.id+'.'+asset.format;
  return {
    archive:'images/collections/'+owner+'/'+relative,
    storage:'generated/'+owner+'/'+relative,
  };
}
