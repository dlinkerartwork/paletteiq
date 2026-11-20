#!/usr/bin/env node
/**
 * PaletteIQ LOCAL WEB D1 RECOVERY — explicit offline claim. No reset/delete.
 *
 * FIRST: stop npm run dev. Inspect with:
 *   node scripts/inspect-lost-collections.cjs
 * Dry run:
 *   node scripts/recover-local-web-collections.cjs --email owner@example.com
 * Apply:
 *   node scripts/recover-local-web-collections.cjs --email owner@example.com --apply --server-stopped
 *
 * A FULL .wrangler/state backup is REQUIRED before modifying the D1 database.
 * Old R2 object keys are NEVER moved or deleted: 0006 authorizes fallback
 * reads for one selected store in the same persistence directory.
 */
const { DatabaseSync } = require('node:sqlite');
const { existsSync, readdirSync, readFileSync, mkdirSync, cpSync, statSync, statfsSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { homedir } = require('node:os');

function die(text) { console.error('Recovery stopped safely: ' + text); process.exitCode = 1; return false; }
const args = process.argv.slice(2);
function arg(name) { const at = args.indexOf(name); return at < 0 ? null : args[at + 1]; }
const email = (arg('--email') || '').toLowerCase().trim();
const storeName = arg('--store-name');
const storeId = arg('--store-id');
const apply = args.includes('--apply');
const stopped = args.includes('--server-stopped');
const root = process.cwd();
const state = path.resolve(arg('--state') || path.join(root, '.wrangler', 'state'));
const backups = path.resolve(arg('--backup-dir') || path.join(root, '.wrangler', 'legacy-recovery-backups'));
const explicitDb = arg('--database') ? path.resolve(arg('--database')) : null;
const skipped = new Set(['blobs','blob','cache','tmp','images','node_modules','.git']);
const options = [];
function findD1(folder, level = 0) {
  if (level > 11) return;
  let entries;
  try { entries = readdirSync(folder, { withFileTypes:true }); } catch { return; }
  for (const file of entries) {
    const filename=path.join(folder,file.name);
    if (file.isSymbolicLink()) continue;
    if (file.isDirectory() && !skipped.has(file.name)) findD1(filename,level+1);
    else if (file.isFile() && /\.(db|sqlite3?)$/i.test(file.name)) {
      let db;
      try {
        db = new DatabaseSync(filename,{readOnly:true});
        const table = db.prepare("SELECT 1 FROM sqlite_master WHERE name='projects' AND type='table'").get();
        if (table && db.prepare("SELECT 1 FROM sqlite_master WHERE name='paletteiq_accounts' AND type='table'").get())
          options.push(filename);
      } catch { /* Other local resource dbs are not project databases. */ }
      finally { try { db?.close(); } catch {} }
    }
  }
}
function totalBytes(folder) {
  let sum=0;
  function visit(dir) {
    for(const f of readdirSync(dir,{withFileTypes:true})) {
      if(f.isSymbolicLink()) continue;
      const p=path.join(dir,f.name);
      if(f.isDirectory()) visit(p);
      else if(f.isFile()) sum+=statSync(p).size;
    }
  }
  visit(folder); return sum;
}
function run(){
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return die('Specify the email address already registered in PaletteIQ using --email.');
  if (!existsSync(state)) return die('Local D1/R2 state was not found at: '+state+
    '\nCheck the original repository folder. DO NOT create a new state.');
  if (explicitDb) {
    if (!explicitDb.startsWith(state+path.sep)) return die('--database must be inside the selected .wrangler/state.');
    options.push(explicitDb);
  } else findD1(state);
  const candidates=[];
  for(const filename of [...new Set(options)]) {
    let db;
    try {
      db=new DatabaseSync(filename,{readOnly:true});
      const row=db.prepare('SELECT id FROM paletteiq_accounts WHERE email=?').get(email);
      const old=db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner='local_seedy'").get().n;
      const owned=db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner LIKE ?').get('user_%_store_%').n;
      if(row) candidates.push({filename,old,owned});
    } catch { /* Invalid or older local database. */ }
    finally { try {db?.close()} catch {} }
  }
  if(candidates.length!==1) return die(
    candidates.length===0
      ? 'No database with this registered email was found in this state. Run the read-only inspect command to locate your original data.'
      : 'Multiple local D1 databases contain this email. Use --database with the exact file found by inspect-lost-collections.cjs.'
  );
  const selected=candidates[0];
  const db=new DatabaseSync(selected.filename, {readOnly:!apply});
  try {
    const account=db.prepare('SELECT id FROM paletteiq_accounts WHERE email=?').get(email);
    const stores=db.prepare('SELECT id,name,account_id,legacy_asset_owner FROM paletteiq_stores WHERE account_id=?').all(account.id);
    const matching=storeId ? stores.filter(s=>s.id===storeId)
      : storeName ? stores.filter(s=>s.name.toLowerCase()===storeName.toLowerCase())
      : stores.length===1 ? stores : [];
    if(matching.length!==1) return die('Choose a unique owned store using --store-name or --store-id. Available stores: '+
      stores.map(s=>s.name+' ('+s.id+')').join(', '));
    const store=matching[0];
    const newOwner='user_'+account.id.replace(/-/g,'')+'_store_'+store.id.replace(/-/g,'');
    const count=db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner='local_seedy'").get().n;
    const oldJobs=db.prepare("SELECT COUNT(*) AS n FROM image_batches WHERE owner='local_seedy'").get().n;
    const target=db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner=?').get(newOwner).n;
    console.log('LOCAL WEB RECOVERY PLAN (',apply?'APPLY':'READ-ONLY PREVIEW',')');
    console.log('Current database:',selected.filename);
    console.log('Target store:',store.name,'('+store.id+')');
    console.log('Legacy collections:',count,'| old image batches:',oldJobs,'| existing collections in target store:',target);
    console.log('R2: original generated/local_seedy/ keys will remain unchanged.');
    if(!count) return die('No local_seedy collections in this database. Do not run migration. Use the read-only inspector to find the original database.');
    if(store.legacy_asset_owner && store.legacy_asset_owner!=='local_seedy') return die('Target store already has an unrelated legacy owner.');
    const already=db.prepare("SELECT COUNT(*) AS n FROM paletteiq_stores WHERE legacy_asset_owner='local_seedy' AND id<>?").get(store.id).n;
    if(already) return die('Legacy workspace is already claimed by another store. No changes made.');
    const colliding=db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner='local_seedy' AND id IN (SELECT id FROM projects WHERE owner=?)").get(newOwner).n;
    if(colliding) return die('Collection ID collision, refusing recovery.');
    if(!apply) {
      console.log('\nDry run only. All files and rows are intact.');
      console.log('When ready, STOP PaletteIQ and run the same command with --apply --server-stopped.');
      return;
    }
    if(!stopped) return die('Stop the local dev server, then add --server-stopped to acknowledge that the SQLite/R2 state is no longer being written.');
    const destination=path.join(backups,'state-before-claim-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
    if (destination.startsWith(state+path.sep) || destination===state) return die('Backup destination must be OUTSIDE the live .wrangler/state folder.');
    mkdirSync(backups,{recursive:true});
    const size=totalBytes(state);
    const free=statfsSync(backups);
    const available=Number(free.bavail)*Number(free.bsize);
    if(available < size*1.15) return die('Insufficient free space to back up ALL R2 and D1 state ('+
      Math.ceil(size/1024/1024)+' MB). Free disk space or specify --backup-dir on another drive.');
    console.log('Backing up complete local D1 and R2 state to:',destination);
    cpSync(state,destination,{recursive:true,errorOnExist:true,force:false,preserveTimestamps:true});
    // Full directory copy is preferable to a SQL-only backup: user may have
    // hundreds of R2 clipart bodies. Verify copied count/bytes before mutation.
    const copiedSize=totalBytes(destination);
    if(copiedSize!==size) return die('Full state backup verification failed. Original state unchanged.');
    console.log('Backup verified:',Math.ceil(copiedSize/1024/1024),'MB.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const moved=db.prepare("UPDATE projects SET owner=? WHERE owner='local_seedy'").run(newOwner);
      if(Number(moved.changes)!==Number(count)) throw Error('Collection count changed during migration');
      db.prepare("UPDATE image_batches SET owner=? WHERE owner='local_seedy'").run(newOwner);
      db.prepare("UPDATE paletteiq_stores SET legacy_asset_owner='local_seedy' WHERE id=? AND account_id=?").run(store.id,account.id);
      const settings=db.prepare("SELECT preferences FROM studio_settings WHERE owner='local_seedy'").get();
      if(settings && !db.prepare('SELECT 1 FROM studio_settings WHERE owner=?').get(newOwner)) {
        db.prepare('INSERT INTO studio_settings (owner,preferences,etsy_credential,openai_credential,gemini_credential,upscale_credential,updated_at) VALUES (?, ?, NULL,NULL,NULL,NULL,?)')
          .run(newOwner,settings.preferences,Date.now());
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    console.log('\nRECOVERY SUCCESS: transferred',count,'collections to',store.name);
    console.log('Full backup (do not delete):',destination);
    console.log('Original R2 image objects were NOT moved, modified or deleted.');
    console.log('Restart PaletteIQ, sign in and open this store. Previously generated PNGs will load through a server-verified alias.');
    console.log('Old encrypted provider keys remain untouched; re-enter API keys under the new store if needed.');
  } finally { db.close(); }
}
try { run(); }
catch(e) { die('No changes are made unless the backup completes and a single DB transaction succeeds. Details: '+
  (e instanceof Error?e.message:String(e))); }
