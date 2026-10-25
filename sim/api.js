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

export function createApi({ circuitsDir = CIRCUITS_DIR } = {}) {
  const e = new Engine();

  const circuits = {
    list() {
      try {
        return fs.readdirSync(circuitsDir)
          .filter(f => f.endsWith('.json') && !NON_CIRCUITS.has(f))
          .map(f => f.replace(/\.json$/, ''));
      } catch { return []; }
    },
    load(name) {
      const file = path.join(circuitsDir, `${name}.json`);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    save(name, json) {
      fs.mkdirSync(circuitsDir, { recursive: true });
      const file = path.join(circuitsDir, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(json, null, 2));
      return file;
    }
  };

  const dispatcher = createDispatcher({ engine: e, circuits });

  // identical public shape to the pre-refactor api
  return { ...dispatcher, engine: e, call: dispatcher.call, TOOLS };
}
