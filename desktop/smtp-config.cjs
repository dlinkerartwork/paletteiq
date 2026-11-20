'use strict';

const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const SMTP_KEYS = [
  'PALETTEIQ_SMTP_HOST', 'PALETTEIQ_SMTP_PORT', 'PALETTEIQ_SMTP_USERNAME',
  'PALETTEIQ_SMTP_USER', 'PALETTEIQ_SMTP_PASSWORD', 'PALETTEIQ_SMTP_FROM',
];

function parseDotEnv(source) {
  const values = {};
  for (const line of String(source).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    if (SMTP_KEYS.includes(match[1])) values[match[1]] = value;
  }
  return values;
}

function rawSmtpSettings(values) {
  return {
    host: values.PALETTEIQ_SMTP_HOST || '',
    port: Number(values.PALETTEIQ_SMTP_PORT || '587'),
    username: values.PALETTEIQ_SMTP_USERNAME || values.PALETTEIQ_SMTP_USER || '',
    sender: values.PALETTEIQ_SMTP_FROM || values.PALETTEIQ_SMTP_USERNAME || values.PALETTEIQ_SMTP_USER || '',
    password: values.PALETTEIQ_SMTP_PASSWORD || '',
  };
}

function loadDesktopSmtpDefaults(root, packaged, variables = process.env) {
  // Installer staging contains ONLY SMTP keys extracted from the private
  // builder's .env; it never includes OpenAI, GPU or encryption keys.
  const filename = path.join(root, packaged ? 'desktop-smtp.env' : '.env');
  const file = existsSync(filename) ? parseDotEnv(readFileSync(filename, 'utf8')) : {};
  const inherited = Object.fromEntries(SMTP_KEYS.filter(key => variables[key] !== undefined)
    .map(key => [key, variables[key]]));
  return rawSmtpSettings({ ...file, ...inherited });
}

function formatDesktopSmtpForBundle(source) {
  const parsed = parseDotEnv(source);
  const settings = rawSmtpSettings(parsed);
  const configured = Boolean(settings.host && settings.username && settings.password && settings.sender);
  if (!configured) return '';
  // Explicit field allowlist: never embed unrelated .env credentials.
  return SMTP_KEYS.filter(key => parsed[key]).map(key => key + '=' + parsed[key]).join('\n') + '\n';
}

module.exports = { SMTP_KEYS, parseDotEnv, rawSmtpSettings, loadDesktopSmtpDefaults, formatDesktopSmtpForBundle };
