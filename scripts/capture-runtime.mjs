import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const image = process.argv[2];
assert(image, 'Usage: node scripts/capture-runtime.mjs <just-built-image> [output]');
const sha = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const paths = git(['ls-files', '--cached', '--others', '--exclude-standard']).split(/\r?\n/)
  .filter(p => p.startsWith('backend/src/main/') || ['backend/pom.xml', 'backend/Dockerfile'].includes(p)).sort();
const fileHashes = Object.fromEntries(paths.map(p => [p, sha(readFileSync(p))]));
const imageId = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
assert(imageId.startsWith('sha256:'));
const manifest = { capturedAt: new Date().toISOString(), commit: git(['rev-parse', 'HEAD']), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), sourceSha256: sha(JSON.stringify(fileHashes)), fileHashes, image, imageId,
  workingTreeStatus: git(['status', '--porcelain']),
  precondition: 'Captured immediately after build with backend source changes frozen; source hash represents backend runtime sources, not evaluation outcomes.' };
const path = process.argv[3] || '.tools/phase2-runtime.json';
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Runtime provenance written to ${path}: ${manifest.commit.slice(0, 7)}, ${imageId}`);
