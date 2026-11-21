'use strict';

/**
 * Offline Desktop-only import of a legacy workspace (SQLite + image files)
 * into one authenticated account store. Never uploads ZIP bytes through the
 * browser or rewrites existing image files.
 */
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled', 'expired']);
const MODES = new Set(['skip','replace','keep-both']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER = /^[a-zA-Z0-9_-]{1,120}$/;
const MAX_PROJECTS = 5000;
const MAX_PROJECT_CHARS = 700_000;
const prefKeys = new Set(['target','model','quality','analysisModel','output','background',
  'variations','defaultStyle','autoSave','seoProvider','seoGeminiModel','seoOpenaiModel',
  'seoDraftFields','seoTitleMaxLength','seoAltTextCount','seoFileNaming','seoPrompts',
  'upscaleProvider','upscaleServerUrl','upscaleFactor','upscaleRequireTransparency',
  'upscaleQc','upscaleModel','upscaleCleanup','upscaleCleanupStrength']);

const validUuid = value => typeof value === 'string' && UUID.test(value);
function ownerForStore(accountId, storeId) {
  if (!validUuid(accountId) || !validUuid(storeId)) throw Error('Invalid account or destination store');
  return 'user_' + accountId.replace(/-/g,'').toLowerCase() + '_store_' + storeId.replace(/-/g,'').toLowerCase();
}

function assertDestination(database, accountId, storeId) {
  const store = database.prepare('SELECT id, name, account_id FROM paletteiq_stores WHERE id=? AND account_id=?')
    .get(storeId,accountId);
  if (!store) throw Error('Destination store is not owned by the signed-in account');
  return { ...store, owner: ownerForStore(accountId,storeId) };
}

function imageReference(value) {
  if (typeof value !== 'string' || !value.includes('/api/')) return null;
  let url;
  try { url = new URL(value,'http://paletteiq.internal'); } catch { return null; }
  if (url.pathname.startsWith('/api/images/')) {
    const id = url.pathname.slice('/api/images/'.length);
    const format = url.searchParams.get('format') || 'png';
    const batch = url.searchParams.get('batch');
    if (!validUuid(id) || !['png','jpg'].includes(format) || (batch && !validUuid(batch))) return null;
    return { kind:'image', id, format, batch };
  }
  if (url.pathname === '/api/thumbnail-background') {
    const id = url.searchParams.get('assetId');
    const projectId = url.searchParams.get('projectId');
    const format = url.searchParams.get('format');
    if (!validUuid(id) || !validUuid(projectId) || !['png','jpg'].includes(format)) return null;
    return { kind:'thumbnail', id, format, projectId };
  }
  return null;
}

function visit(value, fn, depth = 0) {
  if (depth > 30) throw Error('Backup collection nesting exceeds supported depth');
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map(entry => visit(entry,fn,depth+1));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const mapped = visit(item,fn,depth+1);
    if (mapped !== undefined) result[key] = mapped;
  }
  return result;
}

function sourceAssetPath(archiveFolder, owner, asset) {
  if (!OWNER.test(owner)) throw Error('Invalid owner directory in legacy backup');
  const root = path.join(archiveFolder,'images','collections',owner);
  const candidate = asset.kind === 'image' && asset.batch
    ? path.join(root,'batches',asset.batch,asset.id+'.'+asset.format)
    : path.join(root,asset.id+'.'+asset.format);
  if (fs.existsSync(candidate)) {
    const base = fs.realpathSync(path.join(archiveFolder,'images','collections'));
    const resolved = fs.realpathSync(candidate);
    if (!resolved.startsWith(base + path.sep))
      throw Error('Workspace ZIP image resolves outside the extracted archive');
  }
  return candidate;
}

function isImageFile(file, format) {
  try {
    const link = fs.lstatSync(file);
    if (link.isSymbolicLink()) return false;
    const info = fs.statSync(file);
    if (!info.isFile() || info.size < 8 || info.size > 2_147_483_648) return false;
    const data = Buffer.alloc(8);
    const fd = fs.openSync(file,'r');
    try { fs.readSync(fd,data,0,8,0); } finally { fs.closeSync(fd); }
    return format === 'png'
      ? data.equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  } catch { return false; }
}

function readArchive(folder) {
  const location = path.join(folder,'database','paletteiq.db');
  const legacy = new DatabaseSync(location,{readOnly:true});
  try {
    const rows = legacy.prepare('SELECT id, owner, name, data FROM projects ORDER BY updated_at DESC').all();
    if (rows.length > MAX_PROJECTS) throw Error('Backup has too many collections');
    const projects = rows.map(row=>{
      if (!validUuid(row.id) || !OWNER.test(row.owner)) throw Error('Unsupported legacy collection identifier or owner');
      const project = JSON.parse(row.data);
      if (!project || typeof project !== 'object' || Array.isArray(project) ||
        project.id !== row.id || typeof project.name !== 'string' || !Array.isArray(project.characters) ||
        typeof row.data !== 'string' || row.data.length > MAX_PROJECT_CHARS)
        throw Error('Invalid collection data in workspace backup');
      return { id:row.id, name:row.name, sourceOwner:row.owner, project };
    });
    const settings = legacy.prepare('SELECT owner, preferences FROM studio_settings').all();
    return {projects,settings};
  } finally { legacy.close(); }
}

function planWorkspaceStoreImport({ archiveFolder, database, accountId, storeId, mode = 'skip' }) {
  if (!MODES.has(mode)) throw Error('Choose Skip, Replace, or Keep Both');
  const destination = assertDestination(database,accountId,storeId);
  const archive = readArchive(archiveFolder);
  const existing = new Map(database.prepare('SELECT id,owner FROM projects').all().map(row=>[row.id,row.owner]));
  const existingBatches = database.prepare('SELECT owner,project_id,status FROM image_batches WHERE owner=?').all(destination.owner);
  const rows = [];
  const used = new Set(existing.keys());
  for (const item of archive.projects) {
    const occupied = existing.get(item.id);
    let action = !occupied ? 'create'
      : mode === 'skip' ? 'skip'
      : mode === 'keep-both' ? 'keep-both'
      : occupied === destination.owner ? 'replace' : 'blocked';
    if (action === 'replace' && existingBatches.some(b=>b.project_id===item.id&&!TERMINAL.has(b.status)))
      action = 'blocked';
    let newId = item.id;
    if (action === 'keep-both') do { newId = randomUUID(); } while (used.has(newId));
    used.add(newId);
    const references = new Map();
    if (!['skip','blocked'].includes(action)) visit(item.project,value=>{
      const asset = imageReference(value);
      if (!asset) return value;
      if (asset.kind === 'thumbnail' && asset.projectId !== item.id)
        return value; // foreign collection's thumbnail reference is not imported
      const source = sourceAssetPath(archiveFolder,item.sourceOwner,asset);
      const refKey = asset.kind+':'+asset.id+':'+(asset.batch||'')+':'+asset.format;
      if (!references.has(refKey)) references.set(refKey,{
        key:refKey, source, kind:asset.kind, format:asset.format,
        newAssetId:randomUUID(), present:isImageFile(source,asset.format),
      });
      return value;
    });
    rows.push({...item, action, newId, files:[...references.values()]});
  }
  const counts = Object.fromEntries(['create','skip','replace','keep-both','blocked']
    .map(action=>[action,rows.filter(row=>row.action===action).length]));
  const files = rows.flatMap(row=>row.files);
  return {
    destination:{id:destination.id,name:destination.name,owner:destination.owner},
    counts,
    filesTotal:files.length,
    filesAvailable:files.filter(f=>f.present).length,
    filesMissing:files.filter(f=>!f.present).length,
    characters: rows.filter(row=>!['skip','blocked'].includes(row.action))
      .reduce((total,row)=>total+row.project.characters.length,0),
    sourceCollections:archive.projects.length,
    sourceOwners:[...new Set(archive.projects.map(row=>row.sourceOwner))],
    rows,settings:archive.settings,
  };
}

function safePreferences(settings, sourceOwner) {
  const stored = settings.find(row=>row.owner===sourceOwner);
  if (!stored) return null;
  let source;
  try { source = JSON.parse(stored.preferences); }
  catch { throw Error('Invalid production preferences in source workspace'); }
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error('Invalid production preferences');
  const result = {};
  for (const [k,v] of Object.entries(source)) if (prefKeys.has(k)) result[k]=v;
  result.upscaleProvider = 'remote';
  result.seoTitleMaxLength=140;
  if (JSON.stringify(result).length>35000) throw Error('Source preferences are too large');
  return result;
}

function fileHash(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file,'r');
  const chunk = Buffer.allocUnsafe(1024*1024);
  try {
    let read=0;
    while ((read=fs.readSync(fd,chunk,0,chunk.length,null))>0) hash.update(chunk.subarray(0,read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function convertProject(row, owner, allowMissing) {
  const fileLookup = new Map(row.files.map(f=>[f.key,f]));
  const rewritten = visit(row.project, value => {
    const asset=imageReference(value);
    if (!asset) return value;
    if (asset.kind==='thumbnail' && asset.projectId!==row.id) return value;
    const key=asset.kind+':'+asset.id+':'+(asset.batch||'')+':'+asset.format;
    const file=fileLookup.get(key);
    if (!file || !file.present) return allowMissing ? undefined : value;
    return asset.kind==='image'
      ? '/api/images/'+file.newAssetId+'?format='+asset.format
      : '/api/thumbnail-background?projectId='+row.newId+'&assetId='+file.newAssetId+'&format='+asset.format;
  });
  rewritten.id=row.newId;
  if (row.action==='keep-both') rewritten.name=String(rewritten.name).slice(0,132)+' (restored)';
  for (const character of rewritten.characters) {
    if (character && character.status==='done' && !character.imageUrl && !character.upscaledImageUrl) {
      character.status='ready'; // old PNG missing: do not claim image is generated
    }
    // Old async jobs should not resume in a new store by accident.
    if (character && character.upscaleJob) delete character.upscaleJob;
  }
  delete rewritten.researchJob;
  delete rewritten.promptJob;
  delete rewritten.upscaleBatch;
  const json=JSON.stringify(rewritten);
  if (json.length>MAX_PROJECT_CHARS) throw Error('Restored collection exceeds the 700 KB limit: '+row.name);
  return {project:rewritten,data:json,owner};
}

function applyWorkspaceStoreImport({ archiveFolder,database,directory,accountId,storeId,mode,
  allowMissing = false,importPreferences = false }) {
  const plan=planWorkspaceStoreImport({archiveFolder,database,accountId,storeId,mode});
  if (plan.counts.blocked) throw Error('Blocked duplicate or an active image batch. Choose Keep Both or Skip.');
  if (plan.filesMissing && !allowMissing) throw Error('Some source PNG/JPG files are missing. Restore cancelled; allow missing images explicitly to continue.');
  const imports=plan.rows.filter(row=>!['skip','blocked'].includes(row.action));
  const prepared=imports.map(row=>({row,...convertProject(row,plan.destination.owner,allowMissing)}));
  const selectedSourceOwner = imports[0]?.sourceOwner || plan.rows[0]?.sourceOwner;
  const preferences=importPreferences && selectedSourceOwner
    ? safePreferences(plan.settings,selectedSourceOwner) : null;
  if (preferences && plan.sourceOwners.length>1)
    throw Error('Multiple source stores found. Import preferences separately to avoid mixing stores.');
  const backups=path.join(directory,'backups','before-store-import');
  fs.mkdirSync(backups,{recursive:true});
  const backupId=randomUUID();
  const dbBackup=path.join(backups,backupId+'.db');
  const receipt=path.join(backups,backupId+'.json');
  // Entire live SQLite database, including existing accounts, is protected.
  // This is a local private backup, not uploaded and not exposed via the Web.
  database.prepare('VACUUM INTO ?').run(dbBackup);
  if (!fs.existsSync(dbBackup)||fs.statSync(dbBackup).size<1024) throw Error('Safety snapshot verification failed');
  const imageRoot=path.join(directory,'images','collections',plan.destination.owner);
  fs.mkdirSync(imageRoot,{recursive:true});
  const added=[];
  let committed = false;
  try {
    for (const file of imports.flatMap(row=>row.files).filter(f=>f.present)) {
      const destination=path.join(imageRoot,file.newAssetId+'.'+file.format);
      const temporary=path.join(imageRoot,'.'+file.newAssetId+'.'+randomUUID()+'.tmp');
      try {
        fs.copyFileSync(file.source,temporary,fs.constants.COPYFILE_EXCL);
        if (!isImageFile(temporary,file.format) ||
          fs.statSync(file.source).size!==fs.statSync(temporary).size ||
          fileHash(file.source)!==fileHash(temporary))
          throw Error('Image verification failed for '+path.basename(file.source));
        // Hard links create the destination atomically and fail if it exists;
        // unlike rename(), they cannot replace another store image.
        try { fs.linkSync(temporary,destination); }
        catch (cause) {
          if (!['ENOSYS','EPERM','EOPNOTSUPP','EXDEV'].includes(cause.code)) throw cause;
          fs.copyFileSync(temporary,destination,fs.constants.COPYFILE_EXCL);
        }
        added.push(destination);
      } finally { if(fs.existsSync(temporary)) fs.rmSync(temporary,{force:true}); }
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      const stmt=database.prepare('INSERT INTO projects (id,owner,name,data,updated_at) VALUES (?,?,?,?,?) '+
        'ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data,updated_at=excluded.updated_at '+
        'WHERE projects.owner=excluded.owner');
      const now=Date.now();
      for(const item of prepared) {
        const result=stmt.run(item.row.newId,plan.destination.owner,
          item.project.name.slice(0,160),item.data,now);
        if(result.changes!==1) throw Error('Collection ownership conflict during import');
      }
      if(preferences) {
        const old=database.prepare('SELECT preferences FROM studio_settings WHERE owner=?').get(plan.destination.owner);
        // Never overwrite or import encrypted credentials into another store.
        const merged=old ? {...JSON.parse(old.preferences),...preferences} : preferences;
        database.prepare('INSERT INTO studio_settings(owner,preferences,updated_at) VALUES (?,?,?) '+
          'ON CONFLICT(owner) DO UPDATE SET preferences=excluded.preferences,updated_at=excluded.updated_at')
          .run(plan.destination.owner,JSON.stringify(merged),now);
      }
      database.exec('COMMIT');
      committed = true;
    } catch(error){ database.exec('ROLLBACK');throw error; }
    const report={
      format:'paletteiq-workspace-store-import',version:1,
      importedAt:new Date().toISOString(),storeId,storeName:plan.destination.name,
      safetyDatabase:dbBackup,mode,allowMissing,counts:plan.counts,
      imagesCopied:added.length,imagesMissing:plan.filesMissing,
      preservedOldBatches:true,
    };
    // The SQL transaction is already committed. A failed optional receipt
    // must never cause us to remove committed image files.
    try { fs.writeFileSync(receipt,JSON.stringify(report,null,2),{mode:0o600}); }
    catch { report.receiptWarning = 'The optional import receipt could not be written; safety SQLite snapshot still exists.'; }
    return {...report,backupId};
  } catch(error) {
    // New UUIDs guarantee these were not pre-existing store assets.
    // On SQL rollback, deleting only our freshly created files is safe.
    if (!committed) for(const image of added) { try { fs.rmSync(image,{force:true}); } catch {} }
    throw error;
  }
}

module.exports={
  imageReference,ownerForStore,assertDestination,isImageFile,
  readArchive,planWorkspaceStoreImport,applyWorkspaceStoreImport,
};
