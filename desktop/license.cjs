const { createHash, verify } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const PRODUCT = 'paletteiq-desktop';
function deviceCode(guid) {
  if (typeof guid !== 'string' || !guid.trim()) throw new Error('Windows device identifier unavailable');
  return createHash('sha256').update(`${PRODUCT}:v1:${guid.trim().toLowerCase()}`).digest('hex').slice(0, 32).toUpperCase();
}
function windowsDeviceCode() {
  if (process.platform !== 'win32') throw new Error('Windows activation only');
  const output = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
  if (!match) throw new Error('Cannot read Windows device identifier');
  return deviceCode(match[1]);
}
function verifyLicense(data, publicKey, currentDevice) {
  const p = data?.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p) || typeof data?.signature !== 'string') throw new Error('Invalid license format');
  if (p.version !== 1 || p.product !== PRODUCT || p.type !== 'perpetual' || !/^[0-9A-F]{32}$/.test(p.deviceCode || '')) throw new Error('Unsupported license');
  if (p.deviceCode !== currentDevice) throw new Error('This license belongs to another Windows device');
  const bytes = Buffer.from(data.signature, 'base64');
  if (bytes.length !== 64 || !verify(null, Buffer.from(JSON.stringify(p)), publicKey, bytes)) throw new Error('Invalid license signature');
  return p;
}
function readValidLicense(file, publicKey, device) {
  return verifyLicense(JSON.parse(readFileSync(file, 'utf8')), publicKey, device);
}
module.exports = { PRODUCT, deviceCode, windowsDeviceCode, verifyLicense, readValidLicense };
