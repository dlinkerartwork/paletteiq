import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const source = fileURLToPath(new URL('../scripts/recover-local-web-collections.cjs', import.meta.url));
const accountId = '389f8dca-87ec-49b3-85e4-60cf9c432a14';
const storeId = '504bfe69-1f8b-4d68-bafc-9ea8f27065b3';

test('local Web recovery makes a FULL verified R2+D1 backup before moving only legacy metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'paletteiq-web-recovery-'));
  const state = join(directory,'.wrangler','state');
  const d1 = join(state,'v3','d1');
  const r2 = join(state,'v3','r2','legacy-bodies');
  mkdirSync(d1,{recursive:true});
  mkdirSync(r2,{recursive:true});
  const r2Original = join(r2,'image-body.raw');
  writeFileSync(r2Original,Buffer.from('old-clipart-bytes'));
  const database = join(d1,'source.sqlite');
  const db=new DatabaseSync(database);
  try {
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY, owner TEXT NOT NULL,name TEXT,data TEXT,updated_at INTEGER)');
    db.exec('CREATE TABLE image_batches(id TEXT PRIMARY KEY,owner TEXT)');
    db.exec('CREATE TABLE studio_settings(owner TEXT PRIMARY KEY,preferences TEXT,etsy_credential TEXT,openai_credential TEXT,gemini_credential TEXT,upscale_credential TEXT,updated_at INTEGER)');
    db.exec(readFileSync(new URL('../drizzle/0005_accounts_and_stores.sql', import.meta.url),'utf8'));
    db.exec(readFileSync(new URL('../drizzle/0006_legacy_asset_recovery.sql', import.meta.url),'utf8'));
    db.prepare('INSERT INTO paletteiq_accounts(id,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)')
      .run(accountId,'oldowner@example.com','salt','hash',Date.now());
    db.prepare('INSERT INTO paletteiq_stores(id,account_id,name,created_at) VALUES (?,?,?,?)')
      .run(storeId,accountId,'Old Artwork Shop',Date.now());
    db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)')
      .run('legacy-coll','local_seedy','Baby dolphin',JSON.stringify({characters:[{id:'image123',imageUrl:'/api/images/123'}]}),Date.now());
    db.prepare('INSERT INTO image_batches VALUES (?,?)').run('legacy-batch','local_seedy');
    db.prepare('INSERT INTO studio_settings VALUES (?,?,?,?,?,?,?)')
      .run('local_seedy','{"target":120}', 'secret','secret',null,null,Date.now());
    const run=(args=[])=>spawnSync(process.execPath,[source,'--state',state,'--email','oldowner@example.com',...args],{
      cwd:directory,encoding:'utf8',maxBuffer:1024*1024
    });
    const before=run();
    assert.equal(before.status,0,before.stderr);
    assert.match(before.stdout,/READ-ONLY PREVIEW/);
    // Windows terminals may force ANSI colors around numeric values in console output.
    assert.match(stripVTControlCharacters(before.stdout),/Legacy collections: 1/);
    assert.equal(db.prepare("SELECT owner FROM projects WHERE id='legacy-coll'").get().owner,'local_seedy');
    const missing=run(['--apply']);
    assert.notEqual(missing.status,0);
    assert.match(missing.stderr,/--server-stopped/);
    assert.equal(db.prepare("SELECT owner FROM projects WHERE id='legacy-coll'").get().owner,'local_seedy');
    const result=run(['--apply','--server-stopped']);
    assert.equal(result.status,0,result.stderr+"\n"+result.stdout);
    assert.match(result.stdout,/RECOVERY SUCCESS/);
    const newOwner='user_'+accountId.replaceAll('-','')+'_store_'+storeId.replaceAll('-','');
    assert.equal(db.prepare("SELECT owner FROM projects WHERE id='legacy-coll'").get().owner,newOwner);
    assert.equal(db.prepare("SELECT owner FROM image_batches WHERE id='legacy-batch'").get().owner,newOwner);
    assert.equal(db.prepare("SELECT legacy_asset_owner FROM paletteiq_stores WHERE id=?").get(storeId).legacy_asset_owner,'local_seedy');
    assert.equal(db.prepare("SELECT preferences FROM studio_settings WHERE owner=?").get(newOwner).preferences,'{"target":120}');
    assert.equal(db.prepare("SELECT etsy_credential FROM studio_settings WHERE owner=?").get(newOwner).etsy_credential,null);
    assert.equal(readFileSync(r2Original,'utf8'),'old-clipart-bytes');
    const backups=join(directory,'.wrangler','legacy-recovery-backups');
    const snapshots=readdirSync(backups);
    assert.equal(snapshots.length,1);
    assert.ok(existsSync(join(backups,snapshots[0],'v3','d1','source.sqlite')));
    assert.equal(readFileSync(join(backups,snapshots[0],'v3','r2','legacy-bodies','image-body.raw'),'utf8'),'old-clipart-bytes');
    assert.notEqual(run(['--apply','--server-stopped']).status,0);
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});

test('legacy image URLs read through database-verified owner alias, never through a global fallback', () => {
  const helper=readFileSync(new URL('../lib/recovered-assets.ts',import.meta.url),'utf8');
  const auth=readFileSync(new URL('../lib/palette-accounts.ts',import.meta.url),'utf8');
  const paths=[
    'app/api/images/[id]/route.ts','app/api/exports/route.ts',
    'app/api/upscale/route.ts','app/api/upscale-batches/route.ts',
    'app/api/thumbnail-upscale/route.ts','app/api/thumbnail-background/route.ts',
    'app/api/listing-image-studio/route.ts',
  ];
  assert.match(helper,/legacy_asset_owner|legacyAssetOwner/);
  assert.match(helper,/paletteStores\.accountId/);
  assert.match(helper,/getRecoverableAsset/);
  assert.match(helper,/generated\/local_seedy/);
  assert.match(auth,/legacyAssetOwner: stores\[0\]\.legacyAssetOwner/);
  for(const path of paths)
    assert.match(readFileSync(new URL('../'+path,import.meta.url),'utf8'),/getRecoverableAsset|headRecoverableAsset/,path);
});
