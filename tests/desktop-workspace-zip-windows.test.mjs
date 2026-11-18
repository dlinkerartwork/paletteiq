import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { backupWorkspace, validateWorkspace, prepareWorkspaceStoreImport } =
  require('../desktop/workspace-backup.cjs');
const { applyWorkspaceStoreImport, ownerForStore } = require('../desktop/workspace-store-import.cjs');
const accountId='4d50ee81-7ce0-4955-9d7c-d150a49a5d97';
const storeId='e9db23ae-c245-4c74-8726-3100dfd3136b';
const projectId='839959f1-11df-4a74-ad27-4c5ef3daf01a';
const characterId='b858f164-f2c8-4d52-be80-b32f37e20c6f';
const batchId='cc86d5d8-54bd-44c2-94af-bf79b826125a';
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('WINDOWS-ROUNDTRIP')]);

test('Windows Desktop ZIP export -> native extraction -> selected-store PNG import', {skip:process.platform!=='win32'}, async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'paletteiq-zip-windows-'));
  const source=path.join(root,'old-workspace');
  const target=path.join(root,'new-desktop');
  mkdirSync(path.join(source,'database'),{recursive:true});
  mkdirSync(path.join(target,'database'),{recursive:true});
  let oldDB,db;
  try {
    oldDB=new DatabaseSync(path.join(source,'database','paletteiq.db'));
    db=new DatabaseSync(path.join(target,'database','paletteiq.db'));
    for(const instance of [oldDB,db]){
      instance.exec('CREATE TABLE projects (id TEXT PRIMARY KEY,owner TEXT,name TEXT,data TEXT,updated_at INTEGER)');
      instance.exec('CREATE TABLE image_batches (id TEXT PRIMARY KEY,owner TEXT,project_id TEXT,status TEXT)');
      instance.exec('CREATE TABLE studio_settings (owner TEXT PRIMARY KEY,preferences TEXT,etsy_credential TEXT,openai_credential TEXT,gemini_credential TEXT,upscale_credential TEXT,updated_at INTEGER)');
      instance.exec('CREATE TABLE paletteiq_stores (id TEXT PRIMARY KEY,account_id TEXT,name TEXT)');
    }
    oldDB.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(projectId,'local_seedy','A Collection',
      JSON.stringify({id:projectId,name:'A Collection',characters:[{
        id:characterId,name:'Bear',prompt:'Baby Bear',status:'done',
        imageUrl:'/api/images/'+characterId+'?format=png&batch='+batchId,
      }]}),Date.now());
    oldDB.prepare('INSERT INTO studio_settings VALUES (?,?,?,?,?,?,?)').run('local_seedy',
      JSON.stringify({target:10}), 'ENCRYPTED1','ENCRYPTED2','ENCRYPTED3','ENCRYPTED4',Date.now());
    db.prepare('INSERT INTO paletteiq_stores VALUES (?,?,?)').run(storeId,accountId,'Target Store');
    const oldImage=path.join(source,'images','collections','local_seedy','batches',batchId);
    mkdirSync(oldImage,{recursive:true});
    writeFileSync(path.join(oldImage,characterId+'.png'),png);
    const archive=path.join(root,'old-paletteiq.zip');
    await backupWorkspace({directory:source,database:oldDB,destination:archive});
    assert.ok(existsSync(archive));
    const staging=await prepareWorkspaceStoreImport({source:archive,workspaceRoot:target});
    assert.ok(validateWorkspace(staging));
    assert.deepEqual(readFileSync(path.join(staging,'images','collections','local_seedy','batches',batchId,characterId+'.png')),png);
    const scrubbed=new DatabaseSync(path.join(staging,'database','paletteiq.db'),{readOnly:true});
    const creds=scrubbed.prepare('SELECT * FROM studio_settings').get();
    scrubbed.close();
    assert.equal(creds.etsy_credential,null);
    assert.equal(creds.openai_credential,null);
    assert.equal(creds.gemini_credential,null);
    assert.equal(creds.upscale_credential,null);
    const report=applyWorkspaceStoreImport({archiveFolder:staging,database:db,directory:target,accountId,storeId,mode:'keep-both'});
    assert.equal(report.imagesCopied,1);
    const stored=JSON.parse(db.prepare('SELECT data FROM projects WHERE id=?').get(projectId).data);
    assert.match(stored.characters[0].imageUrl,/^\/api\/images\/[0-9a-f-]{36}\?format=png$/);
    const imageId=stored.characters[0].imageUrl.match(/\/api\/images\/([0-9a-f-]{36})/)[1];
    const restored=path.join(target,'images','collections',ownerForStore(accountId,storeId),imageId+'.png');
    assert.deepEqual(readFileSync(restored),png);
    assert.ok(existsSync(report.safetyDatabase));
  }finally{
    if(oldDB)oldDB.close();
    if(db)db.close();
    rmSync(root,{recursive:true,force:true});
  }
});
