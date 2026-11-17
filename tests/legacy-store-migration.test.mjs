import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const script = new URL('../scripts/migrate-legacy-desktop-to-store.cjs', import.meta.url);
const accountId='ddf32abb-d05e-4da7-95bd-8d8a25a4c75e';
const storeId='33e7c871-e67c-45c2-bf90-3e4e810e542d';

test('explicit offline Desktop migration preserves old collections/assets and never migrates encrypted API credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'piq-legacy-store-'));
  const databaseFolder = join(root,'database');
  mkdirSync(databaseFolder,{recursive:true});
  const db=new DatabaseSync(join(databaseFolder,'paletteiq.db'));
  const oldOwner='local_seedy';
  const newOwner='user_'+accountId.replace(/-/g,'')+'_store_'+storeId.replace(/-/g,'');
  try {
    db.exec('CREATE TABLE paletteiq_accounts(id TEXT PRIMARY KEY, email TEXT)');
    db.exec('CREATE TABLE paletteiq_stores(id TEXT PRIMARY KEY,account_id TEXT,name TEXT)');
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,owner TEXT,name TEXT,data TEXT,updated_at INTEGER)');
    db.exec('CREATE TABLE image_batches(id TEXT PRIMARY KEY,owner TEXT)');
    db.exec('CREATE TABLE studio_settings(owner TEXT PRIMARY KEY,preferences TEXT,etsy_credential TEXT,openai_credential TEXT,gemini_credential TEXT,upscale_credential TEXT,updated_at INTEGER)');
    db.prepare('INSERT INTO paletteiq_accounts VALUES (?,?)').run(accountId,'owner@example.com');
    db.prepare('INSERT INTO paletteiq_stores VALUES (?,?,?)').run(storeId,accountId,'My Etsy Store');
    db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run('old-project',oldOwner,'Old animals','{"characters":[]}',1);
    db.prepare('INSERT INTO image_batches VALUES (?,?)').run('old-batch',oldOwner);
    db.prepare('INSERT INTO studio_settings VALUES (?,?,?,?,?,?,?)').run(oldOwner,'{"target":120}','secret-etsy','secret-openai',null,null,1);
    const oldPath=join(root,'images','collections',oldOwner);
    mkdirSync(oldPath,{recursive:true});
    writeFileSync(join(oldPath,'fake-image.png'), Buffer.from([137,80,78,71]));
    const list=spawnSync(process.execPath,[script.pathname,'--email','owner@example.com','--workspace',root,'--list-stores'],{encoding:'utf8'});
    assert.equal(list.status,0,list.stderr);
    assert.match(list.stdout,/My Etsy Store/);
    const migrate=spawnSync(process.execPath,[script.pathname,'--email','owner@example.com',
      '--workspace',root,'--store-name','My Etsy Store','--confirm'],{encoding:'utf8'});
    assert.equal(migrate.status,0,migrate.stderr);
    assert.match(migrate.stdout,/Migrated 1 legacy collections/);
    assert.equal(db.prepare('SELECT owner FROM projects WHERE id=?').get('old-project').owner,newOwner);
    assert.equal(db.prepare('SELECT owner FROM image_batches WHERE id=?').get('old-batch').owner,newOwner);
    assert.equal(db.prepare('SELECT preferences FROM studio_settings WHERE owner=?').get(newOwner).preferences,'{"target":120}');
    assert.equal(db.prepare('SELECT etsy_credential FROM studio_settings WHERE owner=?').get(newOwner).etsy_credential,null);
    assert.equal(db.prepare('SELECT openai_credential FROM studio_settings WHERE owner=?').get(newOwner).openai_credential,null);
    assert.ok(existsSync(join(root,'images','collections',newOwner,'fake-image.png')));
    assert.ok(!existsSync(join(root,'images','collections',oldOwner)));
    assert.ok(readdirSync(join(root,'database','upgrade-backups')).some(name=>name.endsWith('.db')));
    const repeat=spawnSync(process.execPath,[script.pathname,'--email','owner@example.com',
      '--workspace',root,'--confirm'],{encoding:'utf8'});
    assert.notEqual(repeat.status,0);
  } finally { db.close(); rmSync(root,{recursive:true,force:true}); }
});
