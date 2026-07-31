import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_CONFIG_PATH = path.join(REPO_ROOT, 'ds-bundle', '_adherence.oxlintrc.json');
const OUTPUT_CONFIG_PATH = path.join(REPO_ROOT, '.oxlintrc.generated.json');

const source = JSON.parse(readFileSync(SOURCE_CONFIG_PATH, 'utf8'));

const generated = {
  jsPlugins: ['./tools/oxlint-plugins/ds-adherence.mjs'],
  plugins: ['react'],
  rules: {
    'react/forbid-elements': source.rules['react/forbid-elements'],
    'ds-adherence/no-restricted-syntax': 'warn',
    'ds-adherence/no-restricted-imports': 'warn',
  },
  overrides: [
    {
      files: ['**/index.js', 'packages/ds/index.ts'],
      rules: { 'ds-adherence/no-restricted-imports': 'off' },
    },
  ],
};

writeFileSync(OUTPUT_CONFIG_PATH, JSON.stringify(generated, null, 2) + '\n');
console.log(`Generated ${OUTPUT_CONFIG_PATH}`);
