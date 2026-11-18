'use strict';

/** Standalone TLS-only SMTP transport for the Windows Electron runtime.
 * SMTP secrets never enter the renderer, Wrangler environment or GPU server.
 * Supports port 465 (implicit TLS) and 587 (mandatory STARTTLS).
 */
const net = require('node:net');
const tls = require('node:tls');
const { randomUUID } = require('node:crypto');

const ADDRESS = /^[^\s@<>"()[\],;:]{1,64}@[A-Za-z0-9.-]{1,189}$/;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i;
const cleanText = (value, length = 160) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, length);
function validateSmtpConfig(raw) {
  const config = {
    host: String(raw?.host || '').trim().toLowerCase(),
    port: Number(raw?.port || 587),
    username: String(raw?.username || '').trim(),
    sender: String(raw?.sender || '').trim(),
    password: String(raw?.password || ''),
  };
  if (!HOST.test(config.host) || ![465, 587].includes(config.port))
    throw new Error('SMTP requires a valid host and TLS port 465 or STARTTLS port 587');
  if (!ADDRESS.test(config.username) || !ADDRESS.test(config.sender))
    throw new Error('SMTP username and from address must be valid email addresses');
  if (/gmail\.com$/i.test(config.host) && config.username.toLowerCase() !== config.sender.toLowerCase())
    throw new Error('Gmail SMTP username and sender must match');
  if (config.host === 'smtp.gmail.com') config.password = config.password.replace(/\s/g, '');
  if (!config.password || config.password.length > 1024)
    throw new Error('SMTP App Password is missing or invalid');
  return config;
}

class SmtpReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.block = [];
    this.replies = [];
    this.waiting = [];
    this.failure = null;
    this.onData = chunk => {
      this.buffer += chunk.toString('utf8');
      if (this.buffer.length > 65536) return this.fail(new Error('SMTP response exceeds limit'));
      while (this.buffer.includes('\n')) {
        const i = this.buffer.indexOf('\n');
        const line = this.buffer.slice(0, i).replace(/\r$/, '');
        this.buffer = this.buffer.slice(i + 1);
        const match = /^(\d{3})([ -])/.exec(line);
        if (!match) return this.fail(new Error('Malformed SMTP response'));
        this.block.push(line);
        if (match[2] === ' ') {
          const reply = { code: Number(match[1]), message: this.block.join('\n') };
          this.block = [];
          const pending = this.waiting.shift();
          if (pending) pending.resolve(reply);
          else this.replies.push(reply);
        }
      }
    };
    this.onError = error => this.fail(error);
    this.onClose = () => this.fail(new Error('SMTP connection closed unexpectedly'));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }
  fail(error) {
    this.failure = error;
    for (const task of this.waiting.splice(0)) task.reject(error);
    this.socket.destroy();
  }
  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }
  read(expected) {
    if (this.failure) return Promise.reject(this.failure);
    const next = this.replies.length ? Promise.resolve(this.replies.shift()) :
      new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
    return next.then(reply => {
      if (!expected.includes(reply.code)) throw new Error(
        'SMTP rejected request (' + reply.code + ')');
      return reply;
    });
  }
  async command(line, expected) {
    if (/[\r\n]/.test(line)) throw new Error('SMTP command contains a newline');
    this.socket.write(line + '\r\n');
    return this.read(expected);
  }
}

function connected(socket, eventName) {
  return new Promise((resolve, reject) => {
    const done = () => { socket.off(eventName, success); socket.off('error', error); };
    const success = () => { done(); resolve(); };
    const error = err => { done(); reject(err); };
    socket.once(eventName, success);
    socket.once('error', error);
  });
}

function smtpBody(message) {
  const sender = cleanText(message.sender, 254);
  const recipient = cleanText(message.recipient, 254);
  if (!ADDRESS.test(sender) || !ADDRESS.test(recipient)) throw new Error('Invalid notification address');
  const subject = cleanText(message.subject || 'PaletteIQ OpenAI Batch completed', 150);
  const body = String(message.body || '');
  if (body.length > 10000) throw new Error('SMTP message is too large');
  const encodedSubject = '=?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=';
  const text = Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  return [
    'From: <' + sender + '>',
    'To: <' + recipient + '>',
    'Subject: ' + encodedSubject,
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + randomUUID() + '@paletteiq.local>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    text,
  ].join('\r\n');
}

async function sendSmtpMessage(raw, message) {
  const config = validateSmtpConfig(raw);
  const payload = smtpBody({ ...message, sender: config.sender });
  let socket;
  let reader;
  try {
    if (config.port === 465) {
      socket = tls.connect({
        host: config.host, port: config.port, servername: config.host,
        minVersion: 'TLSv1.2', rejectUnauthorized: true,
      });
      socket.setTimeout(18000, () => socket.destroy(new Error('SMTP timeout')));
      reader = new SmtpReader(socket);
      await connected(socket, 'secureConnect');
      if (!socket.authorized) throw new Error('SMTP server TLS certificate invalid');
    } else {
      socket = net.createConnection({ host: config.host, port: config.port });
      socket.setTimeout(18000, () => socket.destroy(new Error('SMTP timeout')));
      reader = new SmtpReader(socket);
      await connected(socket, 'connect');
    }
    await reader.read([220]);
    await reader.command('EHLO paletteiq.local', [250]);
    if (config.port === 587) {
      await reader.command('STARTTLS', [220]);
      reader.detach();
      const secured = tls.connect({
        socket, servername: config.host, minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      });
      socket = secured;
      await connected(secured, 'secureConnect');
      if (!secured.authorized) throw new Error('SMTP STARTTLS certificate invalid');
      reader = new SmtpReader(secured);
      await reader.command('EHLO paletteiq.local', [250]);
    }
    const credentials = Buffer.from('\0' + config.username + '\0' + config.password).toString('base64');
    await reader.command('AUTH PLAIN ' + credentials, [235]);
    await reader.command('MAIL FROM:<' + config.sender + '>', [250]);
    await reader.command('RCPT TO:<' + message.recipient + '>', [250, 251]);
    await reader.command('DATA', [354]);
    socket.write(payload + '\r\n.\r\n');
    await reader.read([250]);
    try { await reader.command('QUIT', [221]); } catch { /* Accepted by SMTP already. */ }
    return { accepted: true };
  } finally {
    reader?.detach();
    socket?.destroy();
  }
}

function completionMessage(details) {
  const store = cleanText(details.storeName, 90);
  const collection = cleanText(details.collectionName, 160);
  const batchId = cleanText(details.openaiBatchId || details.batchId, 150);
  const total = Number(details.total);
  const completed = Number(details.completed);
  const failed = Number(details.failed);
  const counts = completed >= 0 && failed >= 0 && completed + failed === total
    ? 'Completed: ' + completed + '\nFailed: ' + failed + '\n'
    : 'Completed/failed counts: not yet available from OpenAI.\n';
  return {
    recipient: details.recipient,
    subject: 'PaletteIQ image generation completed · ' + collection,
    body: 'Your OpenAI image generation Batch is completed.\n\n' +
      'Store: ' + store + '\nCollection: ' + collection +
      '\nOpenAI Batch ID: ' + batchId + '\nTotal images: ' + total + '\n' +
      counts + '\nPNG images may still be importing into PaletteIQ.\n' +
      'Open PaletteIQ Desktop to review your images.\n',
  };
}

module.exports = { validateSmtpConfig, sendSmtpMessage, smtpBody, completionMessage };
