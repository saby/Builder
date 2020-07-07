'use strict';

const initTest = require('./init-test');
const path = require('path');
const fs = require('fs-extra');
const workspaceFolder = path.join(__dirname, 'fixture/builder-generate-workflow/_packLibraries/Modul');
const { runCompilerAndCheckForErrors } = require('../lib/typescript-compiler');
const { getTranspileOptions } = require('../lib/compile-es-and-ts');

describe('typescript compiler', () => {
   before(async() => {
      await initTest();
   });
   it('should return errors list', async() => {
      const outputPath = `${workspaceFolder}/result.txt`;
      const result = await runCompilerAndCheckForErrors(workspaceFolder, outputPath);
      result.should.have.members([
         'public/publicInterface.ts(15,30): error TS1005: \'{\' expected.',
         'public/publicInterface.ts(8,33): error TS1005: \')\' expected.'
      ]);
   });
   it('should save tsc output into selected file', async() => {
      const outputPath = `${workspaceFolder}/result.txt`;
      await runCompilerAndCheckForErrors(workspaceFolder, outputPath);
      const result = await fs.readFile(outputPath, 'utf8');
      result.includes('public/publicInterface.ts(15,30): error TS1005: \'{\' expected.').should.equal(true);
      result.includes('public/publicInterface.ts(8,33): error TS1005: \')\' expected.').should.equal(true);

      // remove artifact after test completion
      await fs.remove(outputPath);
   });
   it('should return corrent compilerOptions in depends of content format(basic ts module or amd-formatted)', () => {
      let tsContent = "define('Module/myComponent', [], function() { return 'test123'; }";
      let result = getTranspileOptions('Module/someAnotherName.js', 'Module/someAnotherName', tsContent);

      // if ts module amd-formatted, compilerOptions shouldn't contain "module" option
      result.compilerOptions.hasOwnProperty('module').should.equal(false);

      result = getTranspileOptions('Module/myComponent.js', 'Module/myComponent', tsContent);

      // if ts module amd-formatted, compilerOptions shouldn't contain "module" option
      result.compilerOptions.hasOwnProperty('module').should.equal(false);

      tsContent = "import { getter } './getterModule; export default getter;'";
      result = getTranspileOptions('Module/someAnotherName.js', 'Module/someAnotherName', tsContent);

      result.compilerOptions.hasOwnProperty('module').should.equal(true);
   });
});
