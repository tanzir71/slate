import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instrumentFixture } from '../prepare-platform-diagnostics.mjs';
import { observedExpect } from '../../diagnostics/platform-observer.ts';

test('diagnostic fixture keeps the original context factory and only replaces exported delegates',()=>{
  const source=fs.readFileSync(new URL('../../e2e/fixtures.ts',import.meta.url),'utf8');
  const result=instrumentFixture(source);
  const originalBody=source.slice(source.indexOf('base.extend'),source.indexOf('export { expect };'));
  assert.ok(result.includes(originalBody));
  assert.match(result,/await observePage\(page, testInfo\)/);
  assert.match(result,/await use\(page\)/);
  assert.throws(()=>instrumentFixture(source.replace('export const test','const test')),/Unsupported/);
});

test('diagnostic expect returns original matchers and preserves static matcher helpers',()=>{
  const matcher={toBe(){return 'same matcher';}},calls=[];
  const original=Object.assign(value=>{calls.push(value);return matcher;},{poll(){return 'poll';},soft(){return 'soft';}});
  const wrapped=observedExpect(original);
  const geometry={height:157.5,columns:[160,340],header:{}};
  assert.equal(wrapped(geometry),matcher);
  assert.equal(wrapped.poll,original.poll);
  assert.equal(wrapped.soft,original.soft);
  assert.deepEqual(calls,[geometry]);
});
