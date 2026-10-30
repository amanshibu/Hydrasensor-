// Run: node serve-https.mjs  → open the printed https://<laptop-ip>:3443 link on your phone.
// Phones only allow GPS on https pages, so this is needed for precise location over Wi-Fi/hotspot.
import https from 'node:https';
import { readFileSync, existsSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = import.meta.dirname;
const certDir = join(root, '.cert');
const PORT = +process.env.PORT || 3443;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

if (!existsSync(join(certDir, 'cert.pem'))) {
  mkdirSync(certDir, { recursive: true });
  // ponytail: self-signed, so each browser warns once; use mkcert for a trusted cert if that gets in the way.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=HydraSense dev',
    '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
}

https.createServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, (req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'https://x').pathname);
    const file = join(root, rel.endsWith('/') ? `${rel}index.html` : rel);
    // Stay inside the app folder and never serve dotfiles (.cert holds the private key).
    if (!file.startsWith(root) || /[\\/]\./.test(file.slice(root.length)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(400).end('Bad request');
  }
}).listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat().filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map(a => a.address);
  console.log(`HydraSense on https://localhost:${PORT}`);
  for (const ip of ips) console.log(`  phone: https://${ip}:${PORT}`);
  console.log('First visit shows a certificate warning: tap "Show Details" → "visit this website" (Safari) or "Advanced" → "Proceed" (Chrome).');
});
