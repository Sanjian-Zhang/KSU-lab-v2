import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('Set GITHUB_TOKEN before running this script.');

const branch = await git.currentBranch({ fs, dir: root });
const sha = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
console.log('Branch:', branch, 'HEAD:', sha.slice(0, 7));

// Test: list refs on remote (requires auth)
console.log('\n[1/2] Checking remote refs...');
try {
  const refs = await git.listServerRefs({
    http,
    url: 'https://github.com/Sanjian-Zhang/KSU-lab-v2.git',
    forPush: true,
    onAuth: () => ({ username: 'x-access-token', password: TOKEN }),
  });
  console.log('Remote refs:', JSON.stringify(refs));
} catch (e) {
  console.log('Remote check:', e.message); // Expect 409 (empty repo) - OK
}

console.log('\n[2/2] Pushing main...');
try {
  const result = await git.push({
    fs,
    http,
    dir: root,
    remoteUrl: 'https://github.com/Sanjian-Zhang/KSU-lab-v2.git',
    ref: branch,
    onAuth: () => ({ username: 'x-access-token', password: TOKEN }),
    onAuthFailure: () => { throw new Error('Auth failed'); },
  });
  console.log('\n✓ Push successful!');
  console.log('  https://github.com/Sanjian-Zhang/KSU-lab-v2');
} catch (err) {
  console.error('\n✗ Push failed:', err.message);
  process.exit(1);
}
