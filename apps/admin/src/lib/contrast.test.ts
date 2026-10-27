import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AA_TEXT, AA_UI, contrastRatio, hexToRgb, luminance } from './contrast.ts';
import { CONTRAST_PAIRS, FORBIDDEN_PAIRS, PALETTE } from './palette.ts';

test('contrast helper matches the WCAG reference values', () => {
  assert.deepEqual(hexToRgb('#263baa'), [38, 59, 170]);
  assert.deepEqual(hexToRgb('fff'), [255, 255, 255]);
  assert.throws(() => hexToRgb('#12345'));
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21, 'order does not matter');
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  // #767676 on white is the classic "just passes AA" grey.
  assert.ok(contrastRatio('#767676', '#ffffff') >= 4.5);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5);
});

test('every palette pair the panel uses meets WCAG AA', () => {
  const failing = CONTRAST_PAIRS.map((p) => ({ ...p, ratio: contrastRatio(PALETTE[p.fg], PALETTE[p.bg]) }))
    .filter((p) => p.ratio < p.min)
    .map((p) => `${p.fg} on ${p.bg} (${p.use}): ${p.ratio.toFixed(2)} < ${p.min}`);
  assert.deepEqual(failing, []);
});

test('the pastel fills fail with white text, so the panel never uses them that way', () => {
  for (const { fg, bg } of FORBIDDEN_PAIRS) {
    assert.ok(contrastRatio(PALETTE[fg], PALETTE[bg]) < AA_TEXT, `${fg} on ${bg}`);
  }
  // The old soft borders were too faint for inputs (WCAG 1.4.11): that is why --line exists.
  assert.ok(contrastRatio(PALETTE.lilac, PALETTE.white) < AA_UI);
  assert.ok(contrastRatio(PALETTE.lavender, PALETTE.white) < AA_UI);
});

test('globals.css :root has exactly these palette values', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  for (const [name, hex] of Object.entries(PALETTE)) {
    const m = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`));
    assert.ok(m, `--${name} is missing from :root`);
    assert.equal(m[1].toLowerCase(), hex, `--${name}`);
  }
});
