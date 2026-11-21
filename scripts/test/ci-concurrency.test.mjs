import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('successive main commits retain independent original verification runs',()=>{
  const yaml=fs.readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  const section=yaml.match(/^concurrency:\r?\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(section,'CI declares its cancellation policy');
  const template=section.match(/^ {2}group: (.+)$/m)?.[1].trim();
  assert.ok(template,'CI has a concurrency key');
  const group=github=>{
    const value=template.replace(/\$\{\{\s*github\.(workflow|ref|sha)\s*\}\}/g,(_,key)=>github[key]);
    assert.ok(!value.includes('${{'),'Unmodelled concurrency expression');
    return value.toLowerCase(); // GitHub concurrency keys are case insensitive.
  };
  const run={workflow:'CI',ref:'refs/heads/main',sha:'a'.repeat(40)};
  const keys=['a','b','c'].map(letter=>group({...run,sha:letter.repeat(40)}));
  assert.equal(new Set(keys).size,3,'Later commits must not replace an active or queued earlier commit');
  assert.notEqual(group(run),group({...run,ref:'refs/tags/v0.3.0'}));
  assert.notEqual(group(run),group({...run,workflow:'Publish'}));
  assert.notEqual(group(run),`${run.workflow}-${run.ref}`.toLowerCase(),'Leave the original active branch group running');
  assert.match(section,/^ {2}cancel-in-progress: false\s*$/m,'Automatic cancellation stays disabled');
});
