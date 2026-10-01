import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../src/config/env.ts';
import { buildOpenApiDocument } from '../src/openapi.ts';

const out = path.join(REPO_ROOT, 'docs/openapi.json');
writeFileSync(out, `${JSON.stringify(buildOpenApiDocument('http://localhost:8000'), null, 2)}\n`);
console.log(`Wrote ${out}`);
