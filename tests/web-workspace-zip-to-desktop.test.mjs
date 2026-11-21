import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PORTABLE_WEB_FORMAT,PORTABLE_WEB_VERSION,workspaceImageReference,
  collectWorkspaceAssets,workspaceAssetPaths,
} from '../lib/web-workspace-portable.ts';
const require=createRequire(import.meta.url);
const {readWebArchive,materializeWebArchive}=require('../desktop/web-workspace-archive.cjs');
const {ownerForStore,planWorkspaceStoreImport,applyWorkspaceStoreImport}=require('../desktop/workspace-store-import.cjs');
const {readFileSync:readSource}=require('node:fs');
const read=p=>readSource(new URL('../'+p,import.meta.url),'utf8');

const account='f2d47f10-4a7d-4c39-b905-0c4a9e5418d1';
const store='748327fc-b5b7-41f8-87e7-89bc6649ad7d';
const projectId='2a5eb2be-29ba-4f40-9f2b-52f1df12a612';
const charId='5f44c4f4-55ad-4f75-bdc2-b999a01c3b11';
const thumbnailId='2a505f0d-4f99-497a-9c1e-a9f3d8cc5500';
const batchId='bc797239-990a-4c83-8ea6-34c743e02a9c';
const upscaleId='18d13f1c-cea1-41e9-9635-daf2414af522';
const owner='user_'+account.replaceAll('-','')+'_store_'+store.replaceAll('-','');
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('PNG-BYTES-PORTABLE-ORIGINAL')]);
function srcProject() {
  return {id:projectId,name:'Soft Boho Beach',characters:[{
    id:charId,name:'Striped Beach Hammock',status:'done',
    imageUrl:'/api/images/'+charId+'?format=png&batch='+batchId,
    upscaledImageUrl:'/api/images/'+upscaleId+'?format=png',
    prompt:'Watercolor hammock, transparent PNG',
  }], thumbnails:[{id:'cover',aiImageUrl:'/api/thumbnail-background?projectId='+projectId+'&assetId='+thumbnailId+'&format=png'}],
  listing:{title:'Boho Summer Beach Clipart',description:'Pastel beach collection'},
  fullAutomation:{enabled:true,stage:'images',target:100,leaseUntil:900000,expandAttempts:12},
  researchJob:{responseId:'resp_source'},promptJob:{responseId:'resp_prompts'},
  images:['https://i.etsystatic.com/reference-photo.jpg'],
  };
}
function fixture(){
  const root=mkdtempSync(path.join(tmpdir(),'paletteiq-web-zip-test-'));
  const folder=path.join(root,'staging'),live=path.join(root,'desktop');
  mkdirSync(path.join(folder,'database'),{recursive:true});
  mkdirSync(live);
  const data=srcProject();
  const zipManifest={format:PORTABLE_WEB_FORMAT,version:PORTABLE_WEB_VERSION,source:'web',
    credentialsExcluded:true,createdAt:new Date().toISOString(),collections:1,images:3};
  writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(zipManifest));
  const exportJson={format:PORTABLE_WEB_FORMAT,version:PORTABLE_WEB_VERSION,sourceOwner:owner,
    preferences:{quality:'low',target:100,openaiCredential:'NEVER-IMPORT',automationPromptModel:'gpt-6-luna'},
    projects:[{id:projectId,name:data.name,data:JSON.stringify(data),updatedAt:Date.now()}]};
  writeFileSync(path.join(folder,'database','web-collections.json'),JSON.stringify(exportJson));
  const assets=collectWorkspaceAssets(data);
  for(const asset of assets){
    const {archive}=workspaceAssetPaths(owner,asset);
    const full=path.join(folder,...archive.split('/'));
    mkdirSync(path.dirname(full),{recursive:true});
    writeFileSync(full,png);
  }
  const dbPath=path.join(root,'desktop.db');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE paletteiq_stores(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,name TEXT NOT NULL)');
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  db.exec('CREATE TABLE image_batches(id TEXT PRIMARY KEY,owner TEXT NOT NULL,project_id TEXT NOT NULL,status TEXT NOT NULL)');
  db.exec('CREATE TABLE studio_settings(owner TEXT PRIMARY KEY,preferences TEXT NOT NULL,etsy_credential TEXT,openai_credential TEXT,gemini_credential TEXT,upscale_credential TEXT,updated_at INTEGER NOT NULL)');
  db.prepare('INSERT INTO paletteiq_stores VALUES (?,?,?)').run(store,account,'My Etsy Store');
  db.prepare('INSERT INTO studio_settings(owner,preferences,openai_credential,updated_at) VALUES (?,?,?,?)')
    .run(ownerForStore(account,store),JSON.stringify({quality:'medium'}),'SECRET_DESKTOP',Date.now());
  return {root,folder,live,db,exportJson};
}
function cleanup(f){f.db.close();rmSync(f.root,{recursive:true,force:true});}

test('Portable export matches Desktop importer file paths for Batch, upscale and thumbnail',()=>{
  const data=srcProject();
  const assets=collectWorkspaceAssets(data);
  assert.equal(assets.length,3);
  assert.equal(workspaceImageReference(data.characters[0].imageUrl)?.batch,batchId);
  assert.equal(workspaceImageReference(data.thumbnails[0].aiImageUrl)?.kind,'thumbnail');
  assert.equal(workspaceImageReference('https://i.etsystatic.com/example.png'),null);
  const refs=assets.map(x=>workspaceAssetPaths(owner,x));
  assert.ok(refs.some(x=>x.archive.includes('/batches/'+batchId+'/'+charId+'.png')));
  assert.ok(refs.some(x=>x.archive.endsWith('/'+upscaleId+'.png')));
  assert.ok(refs.some(x=>x.archive.endsWith('/'+thumbnailId+'.png')));
  for(const item of refs)assert.equal(item.storage,item.archive.replace('images/collections/','generated/'));
});

test('Portable Web metadata materializes staging SQLite without importing credentials or accounts',()=>{
  const f=fixture();
  try{
    assert.equal(readWebArchive(f.folder).rows.length,1);
    assert.equal(materializeWebArchive(f.folder),true);
    const db=new DatabaseSync(path.join(f.folder,'database','paletteiq.db'),{readOnly:true});
    try{
      assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n,1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM image_batches').get().n,0);
      assert.equal(db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name=?').get('paletteiq_accounts').n,0);
      const settings=db.prepare('SELECT * FROM studio_settings WHERE owner=?').get(owner);
      assert.equal(settings.openai_credential,null);
      assert.equal(JSON.parse(settings.preferences).openaiCredential,undefined);
      assert.equal(JSON.parse(settings.preferences).automationPromptModel,'gpt-6-luna');
    }finally{db.close();}
    assert.equal(JSON.parse(readFileSync(path.join(f.folder,'manifest.json'),'utf8')).source,'web');
  }finally{cleanup(f);}
});

test('Web ZIP can import every saved PNG and listing into an existing Desktop store without erasing Desktop credentials',()=>{
  const f=fixture();
  try{
    materializeWebArchive(f.folder);
    const plan=planWorkspaceStoreImport({archiveFolder:f.folder,database:f.db,
      accountId:account,storeId:store,mode:'skip'});
    assert.equal(plan.sourceCollections,1);
    assert.equal(plan.filesTotal,3);
    assert.equal(plan.filesAvailable,3);
    assert.equal(plan.filesMissing,0);
    const report=applyWorkspaceStoreImport({archiveFolder:f.folder,database:f.db,
      directory:f.live,accountId:account,storeId:store,mode:'skip',importPreferences:true});
    assert.equal(report.imagesCopied,3);
    assert.equal(report.imagesMissing,0);
    const item=JSON.parse(f.db.prepare('SELECT data FROM projects WHERE id=?').get(projectId).data);
    assert.equal(item.characters[0].prompt,'Watercolor hammock, transparent PNG');
    assert.equal(item.listing.title,'Boho Summer Beach Clipart');
    assert.equal(item.fullAutomation.stage,'paused');
    assert.equal(item.fullAutomation.enabled,false);
    assert.match(item.fullAutomation.lastError,/Imported from Web localhost/);
    assert.equal(item.researchJob,undefined);
    assert.equal(item.promptJob,undefined);
    const settings=f.db.prepare('SELECT * FROM studio_settings WHERE owner=?').get(owner);
    assert.equal(settings.openai_credential,'SECRET_DESKTOP');
    for(const url of [item.characters[0].imageUrl,item.characters[0].upscaledImageUrl,item.thumbnails[0].aiImageUrl]){
      const u=new URL(url,'http://localhost');
      const asset=u.searchParams.get('assetId')||u.pathname.split('/').pop();
      const name=path.join(f.live,'images','collections',owner,asset+'.png');
      assert.ok(existsSync(name),name);
      assert.deepEqual(readFileSync(name),png);
    }
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM image_batches').get().n,0);
    const original=JSON.parse(readFileSync(path.join(f.folder,'database','web-collections.json'),'utf8'));
    assert.equal(original.projects.length,1);
    assert.equal(JSON.parse(original.projects[0].data).fullAutomation.stage,'images');
  }finally{cleanup(f);}
});

test('Missing Web ZIP image cannot silently be restored as a complete generated asset',()=>{
  const f=fixture();
  try{
    const target=path.join(f.folder,'images','collections',owner,'batches',batchId,charId+'.png');
    rmSync(target);
    materializeWebArchive(f.folder);
    const plan=planWorkspaceStoreImport({archiveFolder:f.folder,database:f.db,
      accountId:account,storeId:store,mode:'skip'});
    assert.equal(plan.filesMissing,1);
    assert.throws(()=>applyWorkspaceStoreImport({archiveFolder:f.folder,database:f.db,directory:f.live,
      accountId:account,storeId:store,mode:'skip'}),/missing/i);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM projects').get().n,0);
  }finally{cleanup(f);}
});

test('Partial ZIP import keeps the available originals, never copies missing PNGs, and requires explicit consent',()=>{
  const f=fixture();
  try{
    const sourcePath=path.join(f.folder,'images','collections',owner,'batches',batchId,charId+'.png');
    rmSync(sourcePath);
    materializeWebArchive(f.folder);
    const opts={archiveFolder:f.folder,database:f.db,directory:f.live,
      accountId:account,storeId:store,mode:'skip'};
    const report=planWorkspaceStoreImport(opts);
    assert.equal(report.filesMissing,1);
    assert.equal(report.filesAvailable,2);
    assert.throws(()=>applyWorkspaceStoreImport(opts),/missing/i);
    const restored=applyWorkspaceStoreImport({...opts,allowMissing:true});
    assert.equal(restored.imagesCopied,2);
    assert.equal(restored.imagesMissing,1);
    const project=JSON.parse(f.db.prepare('SELECT data FROM projects WHERE id=?').get(projectId).data);
    assert.equal(project.characters[0].imageUrl,undefined);
    assert.ok(project.characters[0].upscaledImageUrl,'Available upscale remains');
    assert.equal(project.characters[0].prompt,'Watercolor hammock, transparent PNG');
    assert.equal(project.listing.title,'Boho Summer Beach Clipart');
    assert.equal(project.webImportReport.missingImages,1);
    assert.equal(project.webImportReport.partialRestore,true);
    assert.equal(project.fullAutomation.stage,'paused');
    assert.equal(project.fullAutomation.enabled,false);
    assert.match(project.fullAutomation.lastError,/missing PNG\/JPG/);
    const liveRoot=path.join(f.live,'images','collections',owner);
    const upscaleUrl=new URL(project.characters[0].upscaledImageUrl,'http://localhost');
    assert.deepEqual(readFileSync(path.join(liveRoot,upscaleUrl.pathname.split('/').pop()+'.png')),png);
  }finally{cleanup(f);}
});

test('A previously completed Web automation becomes paused when any saved image is missing',()=>{
  const f=fixture();
  try{
    const snapshot=JSON.parse(readFileSync(path.join(f.folder,'database','web-collections.json'),'utf8'));
    const project=JSON.parse(snapshot.projects[0].data);
    project.fullAutomation={...project.fullAutomation,stage:'completed',enabled:true};
    snapshot.projects[0].data=JSON.stringify(project);
    writeFileSync(path.join(f.folder,'database','web-collections.json'),JSON.stringify(snapshot));
    rmSync(path.join(f.folder,'images','collections',owner,'batches',batchId,charId+'.png'));
    materializeWebArchive(f.folder);
    applyWorkspaceStoreImport({archiveFolder:f.folder,database:f.db,directory:f.live,
      accountId:account,storeId:store,mode:'skip',allowMissing:true});
    const saved=JSON.parse(f.db.prepare('SELECT data FROM projects WHERE id=?').get(projectId).data);
    assert.equal(saved.fullAutomation.stage,'paused');
    assert.equal(saved.fullAutomation.enabled,false);
    assert.equal(saved.webImportReport.missingImages,1);
    assert.equal(saved.listing.title,'Boho Summer Beach Clipart');
  }finally{cleanup(f);}
});

test('Exporter reports all missing asset paths but omits unavailable bytes only on explicit partial download',()=>{
  const api=read('app/api/web-workspace-export/route.ts');
  const panel=read('components/web-workspace-export-panel.tsx');
  assert.match(api,/if\(!await headRecoverableAsset\(bucket,record.storage\)\)missing.push\(record.archive\)/);
  assert.match(api,/if\(preview\)return json/);
  assert.match(api,/if\(missing.length&&!allowMissing\)return json/);
  assert.match(api,/missingImages:missing.length/);
  assert.match(api,/missingAssets:missing/);
  assert.match(api,/for\(const paths of available\)/);
  assert.match(panel,/partial ZIP/);
  assert.match(panel,/setAcceptPartial\(false\)/);
  assert.match(panel,/disabled=\{!acceptPartial\|\|busy\}/);
  assert.match(panel,/\?allowMissing=1/);
});

test('Web workspace export and Desktop zip import routes remain authenticated and never replay paid jobs',()=>{
  const api=read('app/api/web-workspace-export/route.ts');
  const native=read('desktop/workspace-backup.cjs');
  const importer=read('desktop/workspace-store-import.cjs');
  const settings=read('components/studio-settings.tsx');
  const gate=read('components/shared-local-workspace-gate.tsx');
  assert.match(api,/getChatGPTUser\(\)/);
  assert.match(api,/eq\(projects.owner,user.userId\)/);
  assert.match(api,/headRecoverableAsset\(bucket,record.storage\)/);
  assert.match(api,/zipStream\(entries\)/);
  assert.doesNotMatch(api,/openai\(/);
  assert.match(native,/materializeWebArchive\(staging\)/);
  assert.match(native,/database\/web-collections.json/);
  assert.match(importer,/row.sourceType==='web'/);
  assert.match(importer,/enabled:false,stage:'paused'/);
  assert.match(settings,/<WebWorkspaceExportPanel\/>/);
  assert.match(gate,/get\('webExport'\)==='1'/);
});
