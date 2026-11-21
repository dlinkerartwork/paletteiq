'use strict';

/**
 * Turn a Web-export ZIP metadata payload into a small, read-only staging
 * SQLite database compatible with the existing, audited Desktop Store ZIP
 * importer. No user accounts, sessions, API credentials or paid job queues
 * are moved to the new Desktop store automatically.
 */
const { DatabaseSync }=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const FORMAT='paletteiq-web-workspace-export';
const OWNER=/^[a-zA-Z0-9_-]{1,120}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROJECTS=5000;
const MAX_DATA=700_000;
const PREF_KEYS=new Set([
  'target','model','quality','analysisModel','output','background','variations',
  'defaultStyle','autoSave','seoProvider','seoGeminiModel','seoOpenaiModel',
  'seoDraftFields','seoTitleMaxLength','seoAltTextCount','seoFileNaming',
  'seoPrompts','upscaleProvider','upscaleServerUrl','upscaleFactor',
  'upscaleRequireTransparency','upscaleQc','upscaleModel',
  'upscaleCleanup','upscaleCleanupStrength','automationPromptModel',
  'automationImageModel','automationImageQuality',
]);

function readWebArchive(folder) {
  const manifestPath=path.join(folder,'manifest.json');
  if(!fs.existsSync(manifestPath))return null;
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(manifest.format!==FORMAT)return null;
  if(manifest.version!==1||manifest.credentialsExcluded!==true)
    throw Error('Unsupported or unsafe Web Workspace ZIP manifest');
  const dataPath=path.join(folder,'database','web-collections.json');
  if(!fs.existsSync(dataPath)||fs.statSync(dataPath).size>512*1024*1024)
    throw Error('Missing or oversized Web collection metadata');
  const snapshot=JSON.parse(fs.readFileSync(dataPath,'utf8'));
  if(snapshot.format!==FORMAT||snapshot.version!==1||
    typeof snapshot.sourceOwner!=='string'||!OWNER.test(snapshot.sourceOwner)||
    !Array.isArray(snapshot.projects)||snapshot.projects.length>MAX_PROJECTS||
    !snapshot.preferences||typeof snapshot.preferences!=='object'||Array.isArray(snapshot.preferences))
    throw Error('Invalid Web Workspace ZIP metadata');
  const ids=new Set();
  const rows=snapshot.projects.map(row=>{
    if(!row||typeof row!=='object'||!UUID.test(row.id)||
      typeof row.name!=='string'||!row.name.trim()||typeof row.data!=='string'||
      row.data.length>MAX_DATA||ids.has(row.id))
      throw Error('Invalid or duplicate collection in Web workspace');
    ids.add(row.id);
    const project=JSON.parse(row.data);
    if(!project||Array.isArray(project)||project.id!==row.id||
      typeof project.name!=='string'||!Array.isArray(project.characters))
      throw Error('Invalid Web Collection content: '+row.id);
    return {id:row.id,name:row.name,data:row.data,
      updatedAt:Number.isSafeInteger(row.updatedAt)&&row.updatedAt>0?row.updatedAt:Date.now()};
  });
  const settings={};
  for(const [key,value] of Object.entries(snapshot.preferences)){
    if(PREF_KEYS.has(key))settings[key]=value;
  }
  if(JSON.stringify(settings).length>35_000)throw Error('Web production preferences exceed limits');
  if(manifest.collections!==rows.length)throw Error('Web ZIP Collection count does not match manifest');
  return {owner:snapshot.sourceOwner,rows,settings,manifest};
}

function materializeWebArchive(folder) {
  const source=readWebArchive(folder);
  if(!source)return false;
  const dbPath=path.join(folder,'database','paletteiq.db');
  if(fs.existsSync(dbPath))throw Error('Web workspace ZIP unexpectedly contains a SQLite database');
  const database=new DatabaseSync(dbPath);
  try{
    database.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    database.exec('CREATE TABLE studio_settings(owner TEXT PRIMARY KEY,preferences TEXT NOT NULL,etsy_credential TEXT,openai_credential TEXT,gemini_credential TEXT,upscale_credential TEXT,updated_at INTEGER NOT NULL)');
    database.exec('CREATE TABLE image_batches(id TEXT PRIMARY KEY,owner TEXT NOT NULL,project_id TEXT NOT NULL,status TEXT NOT NULL)');
    database.exec('BEGIN IMMEDIATE');
    try{
      const stmt=database.prepare('INSERT INTO projects(id,owner,name,data,updated_at) VALUES (?,?,?,?,?)');
      for(const row of source.rows)stmt.run(row.id,source.owner,row.name,row.data,row.updatedAt);
      database.prepare('INSERT INTO studio_settings(owner,preferences,updated_at) VALUES (?,?,?)')
        .run(source.owner,JSON.stringify(source.settings),Date.now());
      database.exec('COMMIT');
    }catch(error){database.exec('ROLLBACK');throw error;}
  }catch(error){database.close();fs.rmSync(dbPath,{force:true});throw error;}
  database.close();
  // Only the extracted, disposable staging directory is rewritten. The
  // original Web-export archive and its files stay bit-for-bit unchanged.
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({
    format:'paletteiq-workspace-backup',version:1,
    source:'web',credentialsExcluded:true,createdAt:source.manifest.createdAt,
  }));
  return true;
}

module.exports={FORMAT,readWebArchive,materializeWebArchive};
