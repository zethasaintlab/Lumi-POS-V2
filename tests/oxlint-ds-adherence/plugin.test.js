'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('parseSyntaxSelectors: mengenali bentuk literalBan', async () => {
  const { parseSyntaxSelectors } = await import('../../tools/oxlint-plugins/ds-adherence.mjs');
  const rules = parseSyntaxSelectors([
    { selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]', message: 'hex' },
  ]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].kind, 'literalBan');
  assert.equal(rules[0].message, 'hex');
  assert.ok(rules[0].regex.test('#ff0000'), 'regex harus cocok hex color');
  assert.ok(!rules[0].regex.test('not-a-color'), 'regex tidak boleh cocok string biasa');
});

test('parseSyntaxSelectors: mengenali bentuk propWhitelist', async () => {
  const { parseSyntaxSelectors } = await import('../../tools/oxlint-plugins/ds-adherence.mjs');
  const rules = parseSyntaxSelectors([
    {
      selector: "JSXOpeningElement[name.name='Button'] > JSXAttribute > JSXIdentifier[name!=/^(?:variant|critical)$/]",
      message: 'no-extra-prop',
    },
  ]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].kind, 'propWhitelist');
  assert.equal(rules[0].component, 'Button');
  assert.ok(rules[0].allowed.has('variant'));
  assert.ok(rules[0].allowed.has('critical'));
  assert.ok(!rules[0].allowed.has('bogus'));
});

test('parseSyntaxSelectors: mengenali bentuk propEnum', async () => {
  const { parseSyntaxSelectors } = await import('../../tools/oxlint-plugins/ds-adherence.mjs');
  const rules = parseSyntaxSelectors([
    {
      selector: "JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='variant'] > Literal[value!=/^(?:primary|secondary)$/]",
      message: 'bad-variant',
    },
  ]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].kind, 'propEnum');
  assert.equal(rules[0].component, 'Button');
  assert.equal(rules[0].prop, 'variant');
  assert.ok(rules[0].allowed.has('primary'));
  assert.ok(!rules[0].allowed.has('bogus'));
});

test('parseSyntaxSelectors: bentuk tak dikenal harus throw, bukan diam-diam dilewati', async () => {
  const { parseSyntaxSelectors } = await import('../../tools/oxlint-plugins/ds-adherence.mjs');
  assert.throws(
    () => parseSyntaxSelectors([{ selector: 'TotallyUnknownShape[foo=bar]', message: 'x' }]),
    /unrecognized no-restricted-syntax selector shape/,
    'selector bentuk baru yang tidak dikenali harus membuat plugin gagal load, bukan lolos diam-diam'
  );
});

test('globToRegex: pola ** cocok glob-style, bukan literal', async () => {
  const { globToRegex } = await import('../../tools/oxlint-plugins/ds-adherence.mjs');
  const re = globToRegex('components/forms/**');
  assert.ok(re.test('components/forms/Button.jsx'));
  assert.ok(re.test('components/forms/nested/Deep.jsx'));
  assert.ok(!re.test('components/data/Card.jsx'), 'tidak boleh cocok grup komponen lain');
});

test('plugin default export: memuat ds-bundle/_adherence.oxlintrc.json asli tanpa error', async () => {
  const plugin = (await import('../../tools/oxlint-plugins/ds-adherence.mjs')).default;
  assert.equal(plugin.meta.name, 'ds-adherence');
  assert.ok(plugin.rules['no-restricted-syntax']);
  assert.ok(plugin.rules['no-restricted-imports']);
  assert.equal(typeof plugin.rules['no-restricted-syntax'].create, 'function');
  assert.equal(typeof plugin.rules['no-restricted-imports'].create, 'function');
});
