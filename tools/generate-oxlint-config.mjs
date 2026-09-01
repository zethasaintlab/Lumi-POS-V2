import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_CONFIG_PATH = path.join(REPO_ROOT, 'ds-bundle', '_adherence.oxlintrc.json');
const OUTPUT_CONFIG_PATH = path.join(REPO_ROOT, '.oxlintrc.generated.json');

const source = JSON.parse(readFileSync(SOURCE_CONFIG_PATH, 'utf8'));

// This generator only knows how to translate these three rule keys into the
// generated config below. If _adherence.oxlintrc.json ever gains a new rule
// (or loses one of these), that's a silent-drop hazard identical to the one
// this whole plan exists to fix -- fail loud instead of narrowing quietly.
const EXPECTED_RULE_KEYS = ['react/forbid-elements', 'no-restricted-imports', 'no-restricted-syntax'];
const actualRuleKeys = Object.keys(source.rules);
const missingKeys = EXPECTED_RULE_KEYS.filter((k) => !actualRuleKeys.includes(k));
const unexpectedKeys = actualRuleKeys.filter((k) => !EXPECTED_RULE_KEYS.includes(k));
if (missingKeys.length > 0 || unexpectedKeys.length > 0) {
  throw new Error(
    `generate-oxlint-config: _adherence.oxlintrc.json rules no longer match the ` +
    `set this generator knows how to handle.\n` +
    `Expected exactly: ${EXPECTED_RULE_KEYS.join(', ')}\n` +
    (missingKeys.length > 0 ? `Missing: ${missingKeys.join(', ')}\n` : '') +
    (unexpectedKeys.length > 0 ? `Unexpected: ${unexpectedKeys.join(', ')}\n` : '') +
    `Update this generator to handle the new rule set before proceeding.`
  );
}

const generated = {
  jsPlugins: ['./tools/oxlint-plugins/ds-adherence.mjs'],
  plugins: source.plugins,
  rules: {
    'react/forbid-elements': source.rules['react/forbid-elements'],
    'ds-adherence/no-restricted-syntax': 'warn',
    'ds-adherence/no-restricted-imports': 'warn',
  },
  overrides: [
    {
      // ⛔ PERUBAHAN ATURAN, 31 Agustus 2026: cakupannya diperluas dari
      // `packages/ds/index.ts` menjadi SELURUH `packages/ds/`.
      //
      // Maksud aturannya adalah "kode APLIKASI mengimpor dari pintu depan
      // design system, bukan menjangkau internal bundle". Paket `ds` sendiri
      // adalah pintu depan itu — ia HARUS menjangkau internal untuk
      // membungkusnya, dan `packages/ds/overlay.tsx` (pembungkus dialog yang
      // menambahkan Escape-menutup) tidak dapat ada tanpa itu.
      //
      // Yang TIDAK dilonggarkan: `apps/**` tetap tunduk penuh. Aturan ini
      // masih menangkap layar mana pun yang mengimpor langsung dari
      // `ds-bundle/`, dan itulah pelanggaran yang benar-benar berbahaya.
      files: ['**/index.js', 'packages/ds/**'],
      rules: { 'ds-adherence/no-restricted-imports': 'off' },
    },
  ],
};

writeFileSync(OUTPUT_CONFIG_PATH, JSON.stringify(generated, null, 2) + '\n');
console.log(`Generated ${OUTPUT_CONFIG_PATH}`);
