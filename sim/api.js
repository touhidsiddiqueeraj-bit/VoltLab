// sim/api.js — Node host for the tool dispatcher: wires sim/tools.js to the
// circuits/ directory on disk. Browsers and the offline APK import sim/tools.js
// directly with their own circuits store (app/js/local-api.js).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from './engine.js';
import { createDispatcher, TOOLS } from './tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CIRCUITS_DIR = path.join(__dirname, '..', 'circuits');

// files that live in circuits/ but are not circuits (the offline-bundle manifest)
const NON_CIRCUITS = new Set(['index.json', 'manifest.json']);

export function createApi({ circuitsDir = CIRCUITS_DIR, userCircuitsDir } = {}) {
  const e = new Engine();

  // circuitsDir = the bundled, read-only library (AppImage/deb/Program Files
  // mount it read-only). userCircuitsDir = a writable overlay (userData);
  // saves land there when the bundle can't be written, and user copies shadow
  // bundled files of the same name.
  const circuits = {
    list() {
      const names = new Set();
      for (const dir of [circuitsDir, userCircuitsDir]) {
        if (!dir) continue;
        try {
          for (const f of fs.readdirSync(dir)) {
            if (f.endsWith('.json') && !NON_CIRCUITS.has(f)) names.add(f.replace(/\.json$/, ''));
          }
        } catch { /* dir may not exist yet */ }
      }
      return [...names];
    },
    load(name) {
      if (userCircuitsDir) {
        try { return JSON.parse(fs.readFileSync(path.join(userCircuitsDir, `${name}.json`), 'utf8')); } catch { /* fall through to the bundled copy */ }
      }
      return JSON.parse(fs.readFileSync(path.join(circuitsDir, `${name}.json`), 'utf8'));
    },
    save(name, json) {
      const body = JSON.stringify(json, null, 2);
      const primary = path.join(circuitsDir, `${name}.json`);
      try {
        fs.mkdirSync(circuitsDir, { recursive: true });
        fs.writeFileSync(primary, body);
        return primary;
      } catch {
        if (!userCircuitsDir) throw new Error(`cannot write ${primary} (read-only install and no user circuits dir configured)`);
        fs.mkdirSync(userCircuitsDir, { recursive: true });
        const target = path.join(userCircuitsDir, `${name}.json`);
        fs.writeFileSync(target, body);
        return target;
      }
    }
  };

  const dispatcher = createDispatcher({ engine: e, circuits });

  // identical public shape to the pre-refactor api
  return { ...dispatcher, engine: e, call: dispatcher.call, TOOLS };
}
