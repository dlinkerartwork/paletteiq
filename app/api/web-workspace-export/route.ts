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
const filename=(date:Date)=>'paletteiq-web-workspace-'+date.toISOString().slice(0,10)+'.zip';
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
    // Preflight all saved media; a missing object blocks export before a ZIP
    // download starts. Never silently discard an image reference.
    for(const record of assets.values()){
      if(!await headRecoverableAsset(bucket,record.storage)){
        if(missing.length<10)missing.push(record.archive);
      }
    }
    if(missing.length)return json({error:'Web workspace contains missing saved PNG/JPG assets; no incomplete ZIP was exported.',
      missing,checkedAssets:assets.size},409);
    const manifest={format:PORTABLE_WEB_FORMAT,version:PORTABLE_WEB_VERSION,
      source:'web',createdAt:payload.exportedAt,credentialsExcluded:true,
      collections:rows.length,images:assets.size};
    const entries:ZipEntry[]=[
      entry('manifest.json',JSON.stringify(manifest,null,2)),
      entry('database/web-collections.json',JSON.stringify(payload)),
    ];
    for(const paths of assets.values()){
      entries.push({name:paths.archive,stream:async()=> (await getRecoverableAsset(bucket,paths.storage))?.body||null});
    }
    const wantsPreview=new URL(request.url).searchParams.get('preview')==='1';
    if(wantsPreview)return json({
      collections:rows.length,images:assets.size,
      message:'Export includes real PNG/JPG files, Collection metadata and non-secret settings. Active OpenAI jobs will be paused for review when imported into Desktop.',
    });
    return new Response(zipStream(entries),{headers:{
      'Content-Type':'application/zip',
      'Content-Disposition':'attachment; filename="'+filename(new Date())+'"',
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
    }});
  }catch(error){
    console.error('[PaletteIQ Web Workspace ZIP export]',error);
    return json({error:error instanceof Error?error.message.slice(0,220):'Web Workspace ZIP export failed'},500);
  }
}
