import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sizeSmilesSvg, SmilesStructure } from '../src/shared/lib/smiles.js';

function zeroSizedDrawing(viewBox: string): { svg: SVGSVGElement; attributes: Map<string, string>; style: { width: string; height: string } } {
  const attributes = new Map([['viewBox', viewBox]]);
  const style = { width: '0px', height: '0px' };
  const svg = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    style,
  } as unknown as SVGSVGElement; // The drawing adapter uses only these browser SVG methods/styles.
  return { svg, attributes, style };
}

void test('a parsed molecule with drawable bonds cannot remain invisible because the drawer measured a 0px inline SVG', () => {
  for (const bounds of ['-12 -12 80 100', '0 0 120 30', '-40 -40 90 90']) {
    const { svg, attributes, style } = zeroSizedDrawing(bounds);
    sizeSmilesSvg(svg);
    const width = Number(attributes.get('width'));
    const height = Number(attributes.get('height'));
    assert.ok(width > 0 && width <= 220);
    assert.ok(height > 0 && height <= 120);
    assert.equal(style.width, `${String(width)}px`);
    assert.equal(style.height, 'auto');
    assert.equal(attributes.get('viewBox'), bounds, 'Sizing must never crop or rewrite the chemical drawing geometry.');
  }
});

void test('the SVG begins with positive intrinsic bounds before the client drawing effect runs', () => {
  const html = renderToStaticMarkup(createElement(SmilesStructure, { smiles: 'Oc1ccccc1' }));
  assert.match(html, /<svg[^>]*width="[1-9]\d*"[^>]*height="[1-9]\d*"/);
  assert.match(html, /aria-label="Chemical structure Oc1ccccc1"/);
});

void test('missing or invalid molecular drawing geometry cannot be treated as a successful empty diagram', () => {
  for (const bounds of ['', '0 0 0 100', '0 0 100 0', '0 0 NaN 100', '0 0 100 Infinity']) {
    const { svg } = zeroSizedDrawing(bounds);
    assert.throws(() => { sizeSmilesSvg(svg); }, /no usable geometry/);
  }
});
