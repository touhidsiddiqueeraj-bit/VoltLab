#!/usr/bin/env node
// scripts/gen-circuit-index.mjs — writes circuits/index.json, the manifest the
// offline bundle (browser ?local=1 mode, Android APK) uses to list bundled
// circuits without a directory listing. Node's HTTP host ignores it (fs scan).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'circuits');

const circuits = fs.readdirSync(dir)
  .filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'manifest.json')
  .sort()
  .map(f => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return {
      name: f.replace(/\.json$/, ''),
      title: j.name || f.replace(/\.json$/, ''),
      description: j.description || ''
    };
  });

fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ circuits }, null, 2) + '\n');
console.log(`circuits/index.json: ${circuits.length} circuits — ${circuits.map(c => c.name).join(', ')}`);
