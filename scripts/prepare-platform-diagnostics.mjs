import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function instrumentFixture(source) {
  for (const marker of ['test as base, expect,', 'export const test = base.extend', 'export { expect };'])
    if(source.split(marker).length!==2)throw Error('Unsupported original fixture exports');
  return source.replace('test as base, expect,','test as base, expect as originalExpect,')
    .replace('export const test = base.extend','const originalTest = base.extend')
    .replace('export { expect };',`import { observedExpect, observePage } from "../platform-diagnostics/observer";
export const expect = observedExpect(originalExpect);
export const test = originalTest.extend({
  page: async ({ page }, use, testInfo) => {
    const finish = await observePage(page, testInfo);
    try { await use(page); } finally { await finish(); }
  },
});`);
}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fileManifest(root, files) { return files.map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(root,file)))})); }
export function prepareDiagnostics(root, expected) {
  if(!/^[0-9a-f]{40}$/.test(expected??''))throw Error('Use an immutable commit SHA');
  const head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(head!==expected)throw Error('Target checkout does not match the original commit');
  const directory=path.join(root,'platform-diagnostics');if(fs.existsSync(directory))throw Error('Preserve the existing replay');
  const productPaths=execFileSync('git',['-C',root,'ls-files','-z','packages','apps'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const casePaths=['e2e/keyboard.spec.ts','e2e/table-preview.spec.ts','e2e/image-preview.spec.ts'];
  const product=fileManifest(root,productPaths),cases=fileManifest(root,casePaths);
  const fixture=fs.readFileSync(path.join(root,'e2e/fixtures.ts'));
  const transformed=instrumentFixture(fixture.toString('utf8'));
  const driver=fileURLToPath(new URL('../diagnostics/',import.meta.url));
  fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'original-fixtures.ts'),fixture,{flag:'wx'});
  fs.copyFileSync(path.join(driver,'platform-observer.ts'),path.join(directory,'observer.ts'));
  const config=fs.readFileSync(path.join(driver,'platform.config.ts'),'utf8').replace('from "../playwright.config"','from "./playwright.config"')
    .replace('testDir: "../e2e"','testDir: "./e2e"').replace('outputDir: "../test-results/','outputDir: "test-results/');
  fs.writeFileSync(path.join(root,'playwright.platform-diagnostics.config.ts'),config,{flag:'wx'});
  fs.writeFileSync(path.join(root,'e2e/fixtures.ts'),transformed);
  if(JSON.stringify(fileManifest(root,productPaths))!==JSON.stringify(product)||JSON.stringify(fileManifest(root,casePaths))!==JSON.stringify(cases))throw Error('Original application or case bytes changed');
  const identity={head,product,cases,fixtureBefore:hash(fixture),fixtureAfter:hash(Buffer.from(transformed)),originalCaseBodiesUnchanged:true,applicationSourceUnchanged:true};
  fs.writeFileSync(path.join(directory,'identity.json'),JSON.stringify(identity,null,2),{flag:'wx'});
  console.log(`Prepared read-only observation of ${head}; original application and three cases unchanged`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareDiagnostics(path.resolve(process.argv[2]??'.'),process.argv[3]??process.env.SLATE_DIAGNOSTIC_TARGET);
