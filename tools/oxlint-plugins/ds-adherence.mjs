import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADHERENCE_CONFIG_PATH = path.join(__dirname, '..', '..', 'ds-bundle', '_adherence.oxlintrc.json');

const LITERAL_BAN = /^Literal\[value=\/(.+)\/([a-z]*)\]$/;
const PROP_WHITELIST = /^JSXOpeningElement\[name\.name='([^']+)'\] > JSXAttribute > JSXIdentifier\[name!=\/\^\(\?:(.+)\)\$\/\]$/;
const PROP_ENUM = /^JSXOpeningElement\[name\.name='([^']+)'\] > JSXAttribute\[name\.name='([^']+)'\] > Literal\[value!=\/\^\(\?:(.+)\)\$\/\]$/;

function parseSyntaxSelectors(entries) {
  const rules = [];
  for (const entry of entries) {
    const { selector, message } = entry;
    let m;
    if ((m = selector.match(PROP_ENUM))) {
      rules.push({ kind: 'propEnum', component: m[1], prop: m[2], allowed: new Set(m[3].split('|')), message });
    } else if ((m = selector.match(PROP_WHITELIST))) {
      rules.push({ kind: 'propWhitelist', component: m[1], allowed: new Set(m[2].split('|')), message });
    } else if ((m = selector.match(LITERAL_BAN))) {
      rules.push({ kind: 'literalBan', regex: new RegExp(m[1], m[2]), message });
    } else {
      throw new Error(
        `ds-adherence plugin: unrecognized no-restricted-syntax selector shape in ` +
        `_adherence.oxlintrc.json -- cannot enforce it safely.\nSelector: ${selector}`
      );
    }
  }
  return rules;
}

function loadAdherenceConfig() {
  const raw = JSON.parse(readFileSync(ADHERENCE_CONFIG_PATH, 'utf8'));
  const syntaxEntries = raw.rules['no-restricted-syntax'].slice(1);
  const syntaxRules = parseSyntaxSelectors(syntaxEntries);
  const importPatterns = raw.rules['no-restricted-imports'][1].patterns;
  return { syntaxRules, importPatterns };
}

/**
 * Larangan LOKAL — bukan dari `_adherence.oxlintrc.json`.
 *
 * ⛔ Kenapa di sini dan bukan di berkas adherence: berkas itu ada di
 * `ds-bundle/`, dan `ds-bundle/` adalah artefak vendor yang tidak pernah
 * disunting (keputusan user, 31 Agustus 2026). Menambahkan aturan ke sana akan
 * hilang tanpa jejak pada pembaruan bundle berikutnya — dan yang hilang adalah
 * penjaga skala teks.
 *
 * Yang dilarang: tiga ukuran teks bundle yang TIDAK punya tempat di skala
 * final lima token (lihat tabel pemetaan di `CLAUDE.md`). Ketiganya tidak
 * dapat DIHAPUS dari bundle — vendor — jadi larangan adalah satu-satunya
 * bentuk penegakan yang tersedia.
 *
 * `t-title-lg` dilarang DITULIS, bukan dilarang ADA: `StatCard` bundle
 * memakainya untuk angka metrik B-01, dan `packages/ds/lumi.css`
 * mengikatnya ke `--t-metric` di dalam `.stat`. Yang ditolak adalah kode
 * aplikasi yang menuliskan kelasnya sendiri — di sanalah ukuran kelima bocor
 * ke layar yang tidak berhak.
 *
 * ⛔ Batas yang dinyatakan: oxlint TIDAK membaca berkas CSS. Pemakaian
 * `var(--text-hero)` di dalam `.css` ditangkap
 * `tests/runtime/token-css-ada.test.js`, bukan di sini.
 */
const BAN_LOKAL = [
  {
    regex: /\bt-hero\b|var\(\s*--text-hero\s*\)/,
    message:
      "Ukuran teks `--text-hero` (40px) tidak ada di skala final. Skala: 32/20/15/12 " +
      "plus `--t-metric` (hanya angka kartu dasbor). Lihat tabel pemetaan di CLAUDE.md.",
  },
  {
    regex: /\bt-heading\b|var\(\s*--text-heading\s*\)/,
    message:
      "Ukuran teks `--text-heading` (28px) tidak ada di skala final. Skala: 32/20/15/12 " +
      "plus `--t-metric` (hanya angka kartu dasbor). Lihat tabel pemetaan di CLAUDE.md.",
  },
  {
    regex: /\bt-title-lg\b|var\(\s*--text-title-lg\s*\)/,
    message:
      "`t-title-lg` (24px) hanya sah lewat <StatCard> di kartu dasbor B-01, tempat ia " +
      "terikat ke `--t-metric`. Jangan menuliskan kelasnya sendiri. Lihat CLAUDE.md.",
  },
];

const { syntaxRules, importPatterns } = loadAdherenceConfig();

const literalBans = [...syntaxRules.filter((r) => r.kind === 'literalBan'), ...BAN_LOKAL];
const propWhitelists = new Map(
  syntaxRules.filter((r) => r.kind === 'propWhitelist').map((r) => [r.component, r])
);
const propEnums = syntaxRules.filter((r) => r.kind === 'propEnum');

const noRestrictedSyntax = {
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        for (const ban of literalBans) {
          if (ban.regex.test(node.value)) {
            context.report({ message: ban.message, node });
          }
        }
      },
      JSXOpeningElement(node) {
        const component = node.name.name;
        const whitelist = propWhitelists.get(component);
        const enums = propEnums.filter((e) => e.component === component);
        if (!whitelist && enums.length === 0) return;

        for (const attr of node.attributes) {
          if (attr.type !== 'JSXAttribute') continue;
          const propName = attr.name.name;

          if (whitelist && !whitelist.allowed.has(propName)) {
            context.report({ message: whitelist.message, node: attr });
            continue;
          }

          const enumRule = enums.find((e) => e.prop === propName);
          if (enumRule && attr.value && attr.value.type === 'Literal' && typeof attr.value.value === 'string') {
            if (!enumRule.allowed.has(attr.value.value)) {
              context.report({ message: enumRule.message, node: attr.value });
            }
          }
        }
      },
    };
  },
};

function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*\*/g, '.*') + '$');
}

// Shared by ImportDeclaration, ExportNamedDeclaration ("export ... from") and
// ExportAllDeclaration ("export * from") -- all three carry the imported/
// re-exported path on `node.source` (a Literal, or null for a plain
// `export { x }` with no `from` clause, which has no path to check).
function checkImportSource(context, sourceNode) {
  if (!sourceNode) return;
  const specifier = sourceNode.value;
  if (typeof specifier !== 'string' || !specifier.includes('ds-bundle/')) return;
  const afterDsBundle = specifier.slice(specifier.indexOf('ds-bundle/') + 'ds-bundle/'.length);
  for (const pattern of importPatterns) {
    for (const glob of pattern.group) {
      if (globToRegex(glob).test(afterDsBundle)) {
        context.report({ message: pattern.message, node: sourceNode });
        return;
      }
    }
  }
}

const noRestrictedImports = {
  create(context) {
    return {
      ImportDeclaration(node) {
        checkImportSource(context, node.source);
      },
      ExportNamedDeclaration(node) {
        checkImportSource(context, node.source);
      },
      ExportAllDeclaration(node) {
        checkImportSource(context, node.source);
      },
    };
  },
};

const plugin = {
  meta: { name: 'ds-adherence' },
  rules: {
    'no-restricted-syntax': noRestrictedSyntax,
    'no-restricted-imports': noRestrictedImports,
  },
};

export { parseSyntaxSelectors, globToRegex, noRestrictedSyntax, noRestrictedImports };
export default plugin;
