import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects, studioSettings } from '@/db/schema';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { headRecoverableAsset, getRecoverableAsset } from '@/lib/recovered-assets';
import { nonSecretPreferences } from '@/lib/backup-restore';
import { collectWorkspaceAssets, workspaceAssetPaths, PORTABLE_WEB_FORMAT, PORTABLE_WEB_VERSION } from '@/lib/web-workspace-portable';
import { zipStream, type ZipEntry } from '@/lib/zip-stream';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
}});
const encoder=new TextEncoder();
const entry=(name:string,body:string):ZipEntry=>({name,stream:async()=>new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(encoder.encode(body));controller.close();},
})});
const filename=(date:Date,partial=false)=>'paletteiq-web-workspace-'+date.toISOString().slice(0,10)+(partial?'-partial':'')+'.zip';
const maxCollections=5000;
const maxAssets=19500;

/**
 * Authenticated, read-only export of the current Web store. The ZIP contains
 * real saved PNG/JPG bytes and full Collection JSON; never API credentials.
 * It is intentionally separate from Etsy product package ZIP exports.
 */
export async function GET(request:Request) {
  const user=await getChatGPTUser();
  if(!user)return json({error:'Sign in to export the Web workspace'},401);
  const bucket=nativeAssetBucket()??env.BUCKET;
  if(!bucket)return json({error:'Image storage unavailable. Web Workspace ZIP requires R2 or the native asset store.'},503);
  try{
    const rows=await getDb().select().from(projects).where(eq(projects.owner,user.userId));
    if(rows.length>maxCollections)return json({error:'Too many collections for one Web Workspace ZIP'},413);
    const saved=await getDb().select({preferences:studioSettings.preferences}).from(studioSettings)
      .where(eq(studioSettings.owner,user.userId)).limit(1);
    const settings=saved[0]?JSON.parse(saved[0].preferences) as Record<string,unknown>:{};
    const preferences=nonSecretPreferences(settings);
    const payload={
      format:PORTABLE_WEB_FORMAT,version:PORTABLE_WEB_VERSION,
      sourceOwner:user.userId,
      exportedAt:new Date().toISOString(),
      projects:rows.map(row=>({
        id:row.id, name:row.name, data:row.data, updatedAt:row.updatedAt,
      })),
      preferences,
    };
    // Refuse broken project snapshots instead of shipping a ZIP that appears
    // to have 100 completed images while the actual PNG files are missing.
    const assets=new Map<string,{archive:string;storage:string}>();
    for(const row of rows){
      if(typeof row.data!=='string'||row.data.length>700_000)
        return json({error:'Collection '+row.name+' exceeds the supported backup size'},413);
      const project=JSON.parse(row.data) as {id:string};
      if(project.id!==row.id)return json({error:'Collection ID mismatch in '+row.name},409);
      for(const asset of collectWorkspaceAssets(project)){
        const paths=workspaceAssetPaths(user.userId,asset);
        assets.set(paths.archive,paths);
      }
    }
    if(assets.size>maxAssets)return json({error:'Too many saved PNG/JPG assets for one ZIP; export smaller stores separately.'},413);
    const missing:string[]=[];
    const available:Array<{archive:string;storage:string}>=[];
    // Scan every referenced object. The default export is strict, but users
    // can explicitly download all *available* PNG/JPG plus a complete missing
    // asset report instead of losing the whole migration.
    for(const record of assets.values()){
      if(!await headRecoverableAsset(bucket,record.storage))missing.push(record.archive);
      else available.push(record);
    }
    const params=new URL(request.url).searchParams;
    const preview=params.get('preview')==='1';
    const allowMissing=params.get('allowMissing')==='1';
    if(preview)return json({
      collections:rows.length,images:available.length,referencedImages:assets.size,
      missingCount:missing.length,missing:missing.slice(0,30),
      partialExportAvailable:missing.length>0,
      message:missing.length
        ? 'Some saved PNG/JPG objects are unavailable. A strict export will stop. You may explicitly export a partial ZIP containing all available images and a full missing-asset report; missing images will remain unverified until restored or regenerated.'
        : 'All saved image references are available. The ZIP includes real PNG/JPG, Collection metadata and non-secret settings.',
    });
    if(missing.length&&!allowMissing)return json({
      error:'Some saved PNG/JPG objects are missing. Use preview and explicitly choose partial export, or repair storage before retrying.',
      missing:missing.slice(0,30),missingCount:missing.length,availableImages:available.length,
      referencedImages:assets.size,
    },409);
    const exportPayload={...payload,missingAssets:missing};
    const manifest={format:PORTABLE_WEB_FORMAT,version:PORTABLE_WEB_VERSION,
      source:'web',createdAt:payload.exportedAt,credentialsExcluded:true,
      collections:rows.length,images:available.length,missingImages:missing.length,
      referencedImages:assets.size,partial:missing.length>0};
    const entries:ZipEntry[]=[
      entry('manifest.json',JSON.stringify(manifest,null,2)),
      entry('database/web-collections.json',JSON.stringify(exportPayload)),
    ];
    // Do not manufacture blank PNG files: the Desktop importer detects
    // absent assets and requires explicit "Allow partial image recovery",
    // removing broken URLs only in the imported copy.
    for(const paths of available){
      entries.push({name:paths.archive,stream:async()=> (await getRecoverableAsset(bucket,paths.storage))?.body||null});
    }
    return new Response(zipStream(entries),{headers:{
      'Content-Type':'application/zip',
      'Content-Disposition':'attachment; filename="'+filename(new Date(),missing.length>0)+'"',
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
    }});
  }catch(error){
    console.error('[PaletteIQ Web Workspace ZIP export]',error);
    return json({error:error instanceof Error?error.message.slice(0,220):'Web Workspace ZIP export failed'},500);
  }
}
