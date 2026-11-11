import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUpscaleServerUrl } from '../lib/upscale-server-url.ts';

test('GPU Server URL supports localhost and private IPv4 with explicit port', () => {
  assert.equal(normalizeUpscaleServerUrl('http://192.168.1.10:8000'), 'http://192.168.1.10:8000');
  assert.equal(normalizeUpscaleServerUrl('http://10.0.0.5:8000'), 'http://10.0.0.5:8000');
  assert.equal(normalizeUpscaleServerUrl('https://172.16.0.9:443'), 'https://172.16.0.9');
  assert.equal(normalizeUpscaleServerUrl('http://localhost:8000'), 'http://localhost:8000');
  assert.equal(normalizeUpscaleServerUrl(''), '');
});
test('GPU Server URL blocks public and credential-bearing destinations', () => {
  for (const url of ['http://8.8.8.8:8000', 'https://example.com', 'http://169.254.169.254',
    'http://user:pass@192.168.1.10:8000', 'http://192.168.1.10:8000/path',
    'http://192.168.1.10:8000?key=x', 'file:///etc/passwd', 'http://192.168.1.999:8000']) {
    assert.equal(normalizeUpscaleServerUrl(url), null, url);
  }
});
