import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  ownerForStore, planWorkspaceStoreImport, applyWorkspaceStoreImport,
} = require('../desktop/workspace-store-import.cjs');
const accountId='f2d47f10-4a7d-4c39-b905-0c4a9e5418d1';
const firstStore='748327fc-b5b7-41f8-87e7-89bc6649ad7d';
const secondStore='aaff770f-534a-421f-8886-d4889c87d705';
const oldCollection='2a5eb2be-29ba-4f40-9f2b-52f1df12a612';
const charA='5f44c4f4-55ad-4f75-bdc2-b999a01c3b11';
const charB='6c5b884f-c5af-48db-a6ee-7be0496b644a';
const batch='bc797239-990a-4c83-8ea6-34c743e02a9c';
const upscaleAsset='93b3b03c-e4a9-48ad-81c6-3ddebb03f060';
const thumbnailAsset='06702285-6a72-4dfb-840b-7cac0ae267d6';
const listingAsset='90c9a583-b71d-4227-8a18-f3d28c039a74';
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('FAKE-BUT-MAGIC-HEADER-IMAGE-DATA')]);
function project() {
  return {
    id:oldCollection,name:'Watercolor Baby Animals',characters:[
      {id:charA,name:'Baby Bear',status:'done',prompt:'A cute baby bear',
        imageUrl:'/api/images/'+charA+'?format=png&batch='+batch,
        upscaledImageUrl:'/api/images/'+upscaleAsset+'?format=png',upscaleJob:{id:'legacy-job'}},
      {id:charB,name:'Baby Otter',status:'ready',prompt:'A baby otter'},
    ],
    thumbnails:[{id:'one',name:'Main Cover',aiImageUrl:'/api/thumbnail-background?projectId='+oldCollection+'&assetId='+thumbnailAsset+'&format=png'}],
    listingImages:[{number:1,renderedImageUrl:'/api/thumbnail-background?projectId='+oldCollection+'&assetId='+listingAsset+'&format=png'}],
    researchJob:{status:'completed'},promptJob:{status:'completed'},upscaleBatch:{id:'old-batch'},
  };
}
function fixture({missing=false}={}) {
  const root=mkdtempSync(path.join(tmpdir(),'paletteiq-native-restore-test-'));
  const archive=path.join(root,'archive');
  const live=path.join(root,'live');
  mkdirSync(path.join(archive,'database'),{recursive:true});
  mkdirSync(path.join(live,'database'),{recursive:true});
  const sourceDB = new DatabaseSync(path.join(archive,'database','paletteiq.db'));
  const destDB = new DatabaseSync(path.join(live,'database','paletteiq.db'));
  for(const db of [sourceDB,destDB]){
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    db.exec('CREATE TABLE studio_settings(owner TEXT PRIMARY KEY,preferences TEXT NOT NULL,etsy_credential TEXT,openai_credential TEXT,gemini_credential TEXT,upscale_credential TEXT,updated_at INTEGER NOT NULL)');
    db.exec('CREATE TABLE image_batches(id TEXT PRIMARY KEY,owner TEXT NOT NULL,project_id TEXT NOT NULL,status TEXT NOT NULL)');
    db.exec('CREATE TABLE paletteiq_stores(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,name TEXT NOT NULL)');
  }
  destDB.prepare('INSERT INTO paletteiq_stores VALUES (?,?,?)').run(firstStore,accountId,'My Art Store');
  destDB.prepare('INSERT INTO paletteiq_stores VALUES (?,?,?)').run(secondStore,accountId,'Another Store');
  const currentOwner=ownerForStore(accountId,firstStore);
  destDB.prepare('INSERT INTO studio_settings VALUES (?,?,?,?,?,?,?)').run(currentOwner,
    JSON.stringify({target:35,quality:'high'}),'SECRET_OLD_ETSY','SECRET_OPENAI',null,null,Date.now());
  const source=project();
  sourceDB.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(oldCollection,'local_seedy',source.name,JSON.stringify(source),Date.now());
  sourceDB.prepare('INSERT INTO studio_settings VALUES (?,?,?,?,?,?,?)').run('local_seedy',
    JSON.stringify({target:80,model:'gpt-image-1-mini',openaiCredential:'NEVER-IMPORT'}),null,'OLD_SECRET',null,null,Date.now());
  const imageRoot=path.join(archive,'images','collections','local_seedy');
  mkdirSync(path.join(imageRoot,'batches',batch),{recursive:true});
  writeFileSync(path.join(imageRoot,'batches',batch,charA+'.png'),png);
  writeFileSync(path.join(imageRoot,upscaleAsset+'.png'),png);
  writeFileSync(path.join(imageRoot,thumbnailAsset+'.png'),png);
  if(!missing)writeFileSync(path.join(imageRoot,listingAsset+'.png'),png);
  return {root,archive,live,sourceDB,destDB,currentOwner,cleanup(){
    sourceDB.close();destDB.close();rmSync(root,{recursive:true,force:true});
  }};
}
const opts=f=>({archiveFolder:f.archive,database:f.destDB,directory:f.live,accountId,
  storeId:firstStore,mode:'skip'});

test('preview counts all original, upscaled, thumbnail, and listing PNGs without changing destination',()=>{
  const f=fixture();
  try {
    const result=planWorkspaceStoreImport(opts(f));
    assert.equal(result.sourceCollections,1);
    assert.equal(result.characters,2);
    assert.equal(result.filesAvailable,4);
    assert.equal(result.filesMissing,0);
    assert.equal(result.counts.create,1);
    assert.equal(f.destDB.prepare('SELECT count(*) AS n FROM projects').get().n,0);
  } finally { f.cleanup(); }
});

test('restore verifies exact PNG bytes, rehomes asset IDs, updates URLs, and saves local snapshot',()=>{
  const f=fixture();
  try {
    const report=applyWorkspaceStoreImport({...opts(f),importPreferences:true});
    assert.equal(report.imagesCopied,4);
    assert.equal(report.imagesMissing,0);
    assert.ok(existsSync(report.safetyDatabase));
    const before = new DatabaseSync(report.safetyDatabase,{readOnly:true});
    try { assert.equal(before.prepare('SELECT count(*) AS n FROM projects').get().n,0); }
    finally { before.close(); }
    const stored=f.destDB.prepare('SELECT * FROM projects WHERE id=?').get(oldCollection);
    assert.equal(stored.owner,f.currentOwner);
    const item=JSON.parse(stored.data);
    assert.equal(item.characters[0].prompt,'A cute baby bear');
    assert.equal(item.characters[0].status,'done');
    assert.equal('upscaleJob' in item.characters[0],false);
    assert.equal('researchJob' in item,false);
    const imageURLs=[item.characters[0].imageUrl,item.characters[0].upscaledImageUrl,
      item.thumbnails[0].aiImageUrl,item.listingImages[0].renderedImageUrl];
    const savedPaths=[];
    for(const url of imageURLs){
      assert.ok(!url.includes(batch));
      const parsed=new URL(url,'http://localhost');
      let id;
      if(parsed.pathname.startsWith('/api/images/')){
        id=parsed.pathname.split('/').at(-1);
      }else{
        id=parsed.searchParams.get('assetId');
        assert.equal(parsed.searchParams.get('projectId'),oldCollection);
      }
      assert.notEqual(id,charA);
      const file=path.join(f.live,'images','collections',f.currentOwner,id+'.png');
      savedPaths.push(file);
      assert.deepEqual(readFileSync(file),png);
    }
    assert.equal(new Set(savedPaths).size,4);
    assert.equal(readdirSync(path.dirname(savedPaths[0])).length,4);
    assert.equal(f.destDB.prepare('SELECT count(*) AS n FROM image_batches').get().n,0);
    const prefs=f.destDB.prepare('SELECT * FROM studio_settings WHERE owner=?').get(f.currentOwner);
    const updated=JSON.parse(prefs.preferences);
    assert.equal(updated.target,80);
    assert.equal(updated.quality,'high');
    assert.equal(updated.openaiCredential,undefined);
    assert.equal(prefs.openai_credential,'SECRET_OPENAI');
    assert.equal(prefs.etsy_credential,'SECRET_OLD_ETSY');
    // Other store never receives imported rows or PNGs.
    assert.equal(f.destDB.prepare('SELECT count(*) AS n FROM projects WHERE owner=?')
      .get(ownerForStore(accountId,secondStore)).n,0);
  } finally {f.cleanup();}
});

test('Keep Both copies collection with new UUID and repairs thumbnail project IDs',()=>{
  const f=fixture();
  try {
    applyWorkspaceStoreImport(opts(f));
    const preview=planWorkspaceStoreImport({...opts(f),mode:'keep-both'});
    assert.equal(preview.counts['keep-both'],1);
    const result=applyWorkspaceStoreImport({...opts(f),mode:'keep-both'});
    assert.equal(result.imagesCopied,4);
    const rows=f.destDB.prepare('SELECT * FROM projects WHERE owner=?').all(f.currentOwner);
    assert.equal(rows.length,2);
    const copy=rows.find(row=>row.id!==oldCollection);
    const value=JSON.parse(copy.data);
    assert.equal(value.id,copy.id);
    assert.match(value.name,/restored/);
    const thumb=new URL(value.thumbnails[0].aiImageUrl,'http://localhost');
    assert.equal(thumb.searchParams.get('projectId'),copy.id);
    assert.deepEqual(readFileSync(path.join(f.live,'images','collections',f.currentOwner,
      thumb.searchParams.get('assetId')+'.png')),png);
    assert.equal(f.destDB.prepare('SELECT count(*) AS n FROM image_batches').get().n,0);
  }finally{f.cleanup();}
});

test('foreign-owned IDs cannot be replaced or deleted',()=>{
  const f=fixture();
  try {
    const foreign=ownerForStore(accountId,secondStore);
    f.destDB.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(oldCollection,foreign,
      'Keep Foreign Data','{"safe":true}',Date.now());
    const preview=planWorkspaceStoreImport({...opts(f),mode:'replace'});
    assert.equal(preview.counts.blocked,1);
    assert.throws(()=>applyWorkspaceStoreImport({...opts(f),mode:'replace'}),/Blocked duplicate/);
    assert.equal(f.destDB.prepare('SELECT owner FROM projects WHERE id=?').get(oldCollection).owner,foreign);
    const skip=applyWorkspaceStoreImport({...opts(f),mode:'skip'});
    assert.equal(skip.imagesCopied,0);
    assert.equal(f.destDB.prepare('SELECT owner FROM projects WHERE id=?').get(oldCollection).owner,foreign);
  } finally {f.cleanup();}
});

test('missing PNG is reported and blocks import until partial recovery explicitly approved',()=>{
  const f=fixture({missing:true});
  try {
    const preview=planWorkspaceStoreImport(opts(f));
    assert.equal(preview.filesMissing,1);
    assert.equal(preview.filesAvailable,3);
    assert.throws(()=>applyWorkspaceStoreImport(opts(f)),/missing/);
    assert.equal(f.destDB.prepare('SELECT count(*) AS n FROM projects').get().n,0);
    const restored=applyWorkspaceStoreImport({...opts(f),allowMissing:true});
    assert.equal(restored.imagesCopied,3);
    const item=JSON.parse(f.destDB.prepare('SELECT data FROM projects WHERE id=?').get(oldCollection).data);
    assert.equal(item.listingImages[0].renderedImageUrl,undefined);
    assert.equal(item.characters[0].status,'done');
  } finally {f.cleanup();}
});

test('not-owned destination store ID fails before import or filesystem mutation',()=>{
  const f=fixture();
  try {
    assert.throws(()=>planWorkspaceStoreImport({...opts(f),accountId:'33333333-3333-4333-8333-333333333333'}),/not owned/);
    assert.equal(f.destDB.prepare('SELECT count(*) AS n FROM projects').get().n,0);
  } finally {f.cleanup();}
});
