'use strict';

const initTest = require('./init-test');

const path = require('path'),
   fs = require('fs-extra');

const generateWorkflow = require('../gulp/grabber/generate-workflow.js');
const { promiseWithTimeout, TimeoutError } = require('../lib/promise-with-timeout');

const workspaceFolder = path.join(__dirname, 'workspace'),
   cacheFolder = path.join(workspaceFolder, 'cache'),
   sourceFolder = path.join(workspaceFolder, 'source'),
   configPath = path.join(workspaceFolder, 'config.json'),
   outputJson = path.join(workspaceFolder, 'output.json'),
   moduleSourceFolder = path.join(sourceFolder, 'Модуль');

const config = {
   cache: cacheFolder,
   output: outputJson,
   builderTests: true,
   modules: [
      {
         name: 'Модуль',
         path: path.join(sourceFolder, 'Модуль')
      }
   ]
};

const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};

const prepareTest = async function(fixtureFolder) {
   await clearWorkspace();
   await fs.ensureDir(sourceFolder);
   await fs.copy(fixtureFolder, sourceFolder);
};

const runWorkflow = function() {
   return new Promise((resolve, reject) => {
      generateWorkflow([`--config="${configPath}"`])((error) => {
         if (error) {
            reject(error);
         } else {
            resolve();
         }
      });
   });
};

/**
 * properly finish test in builder main workflow was freezed by unexpected
 * critical errors from gulp plugins
 * @returns {Promise<void>}
 */
const runWorkflowWithTimeout = async function() {
   let result;
   try {
      result = await promiseWithTimeout(runWorkflow(), 60000);
   } catch (err) {
      result = err;
   }
   if (result instanceof TimeoutError) {
      true.should.equal(false);
   }
};

const timeout = function(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
};

// в файловой системе HFS Plus точность хранения даты равняется 1 секунде
// из-за этого тесты могуть падать непредсказуемым образом, и при этом для пользователя проблем не будет
const timeoutForMacOS = async function() {
   if (process.platform === 'darwin') {
      await timeout(1000);
   }
};

// все тесты по сути завязаны на значение контекста(context) одной фразы в файле Component.<extension>
const checkResult = async function(extension, context) {
   const resultObj = await fs.readJSON(outputJson);
   resultObj.length.should.equals(1);
   resultObj[0].key.should.equals('AnyText');
   resultObj[0].context.should.equals(context);
   resultObj[0].ui.should.equals(moduleSourceFolder);
   resultObj[0].module.should.equals(path.join(moduleSourceFolder, `Component.${extension}`));
};

// нужно проверить что происходить, что кеш работает
describe('gulp/grabber/generate-workflow.js', () => {
   before(async() => {
      await initTest();
   });

   describe('check localization words collector for js', () => {
      it('rebuild without changes', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/javascript');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('js', 'AnyContext');

         await runWorkflowWithTimeout();
         await checkResult('js', 'AnyContext');

         await clearWorkspace();
      });

      it('rebuild with changes in sources', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/javascript');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('js', 'AnyContext');

         await timeoutForMacOS();
         const testFilePath = path.join(sourceFolder, 'Модуль/Component.js');
         const testFileText = (await fs.readFile(testFilePath)).toString();
         await fs.writeFile(testFilePath, testFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('js', 'AnyContext123');

         await clearWorkspace();
      });

      it('rebuild with changes in cache', async() => {
         //
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/javascript');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('js', 'AnyContext');

         await timeoutForMacOS();
         const cacheFilePath = path.join(cacheFolder, 'grabber-cache.json');
         const cacheFileText = (await fs.readFile(cacheFilePath)).toString();
         await fs.writeFile(cacheFilePath, cacheFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('js', 'AnyContext123');

         await clearWorkspace();
      });
   });

   describe('check localization words collector for ts', () => {
      it('rebuild without changes', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/typescript');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('ts', 'AnyContext');

         await runWorkflowWithTimeout();
         await checkResult('ts', 'AnyContext');

         await clearWorkspace();
      });

      it('rebuild with changes in sources', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/typescript');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('ts', 'AnyContext');

         await timeoutForMacOS();
         const testFilePath = path.join(sourceFolder, 'Модуль/Component.ts');
         const testFileText = (await fs.readFile(testFilePath)).toString();
         await fs.writeFile(testFilePath, testFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('ts', 'AnyContext123');

         await clearWorkspace();
      });

      it('rebuild with changes in cache', async() => {
         //
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/typescript');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('ts', 'AnyContext');

         await timeoutForMacOS();
         const cacheFilePath = path.join(cacheFolder, 'grabber-cache.json');
         const cacheFileText = (await fs.readFile(cacheFilePath)).toString();
         await fs.writeFile(cacheFilePath, cacheFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('ts', 'AnyContext123');

         await clearWorkspace();
      });
   });

   describe('check localization words collector for xhtml code', () => {
      it('rebuild without changes', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/xhtml');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('xhtml', 'AnyContext');

         await runWorkflowWithTimeout();
         await checkResult('xhtml', 'AnyContext');

         await clearWorkspace();
      });

      it('rebuild with changes in xhtml code', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/xhtml');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('xhtml', 'AnyContext');

         await timeoutForMacOS();
         const testFilePath = path.join(sourceFolder, 'Модуль/Component.xhtml');
         const testFileText = (await fs.readFile(testFilePath)).toString();
         await fs.writeFile(testFilePath, testFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('xhtml', 'AnyContext123');

         await clearWorkspace();
      });

      it('rebuild with changes in cache', async() => {
         //
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/xhtml');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('xhtml', 'AnyContext');

         await timeoutForMacOS();
         const cacheFilePath = path.join(cacheFolder, 'grabber-cache.json');
         const cacheFileText = (await fs.readFile(cacheFilePath)).toString();
         await fs.writeFile(cacheFilePath, cacheFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('xhtml', 'AnyContext123');

         await clearWorkspace();
      });

      it('rebuild with changes in js code', async() => {
         // Unlike 1st and 3rd builds, for 2nd build js source has @translatable option
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/xhtml');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('xhtml', 'AnyContext');

         await timeoutForMacOS();
         const testFilePath = path.join(sourceFolder, 'Модуль/ComponentWithOption.js');
         const testFileText = (await fs.readFile(testFilePath)).toString();
         await fs.writeFile(testFilePath, testFileText.replace('@translatable', '@translatable123'));

         await runWorkflowWithTimeout();
         const resultObj = await fs.readJSON(outputJson);
         resultObj.length.should.equals(0);

         await timeoutForMacOS();
         await fs.writeFile(testFilePath, testFileText);

         await runWorkflowWithTimeout();
         await checkResult('xhtml', 'AnyContext');

         await clearWorkspace();
      });
   });

   describe.skip('check localization words collector for tmpl code', () => {
      it('rebuild without changes', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/tmpl');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('tmpl', 'AnyContext');

         await runWorkflowWithTimeout();
         await checkResult('tmpl', 'AnyContext');

         await clearWorkspace();
      });

      it('rebuild with changes in tmpl code', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/tmpl');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('tmpl', 'AnyContext');

         await timeoutForMacOS();
         const testFilePath = path.join(sourceFolder, 'Модуль/Component.tmpl');
         const testFileText = (await fs.readFile(testFilePath)).toString();
         await fs.writeFile(testFilePath, testFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('tmpl', 'AnyContext123');

         await clearWorkspace();
      });

      it('rebuild with changes in cache', async() => {
         //
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/tmpl');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('tmpl', 'AnyContext');

         await timeoutForMacOS();
         const cacheFilePath = path.join(cacheFolder, 'grabber-cache.json');
         const cacheFileText = (await fs.readFile(cacheFilePath)).toString();
         await fs.writeFile(cacheFilePath, cacheFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('tmpl', 'AnyContext123');

         await clearWorkspace();
      });

      it('rebuild with changes in js code', async() => {
         // Unlike 1st and 3rd builds, for 2nd build js source has @translatable option
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/tmpl');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('tmpl', 'AnyContext');

         await timeoutForMacOS();
         const testFilePath = path.join(sourceFolder, 'Модуль/ComponentWithOption.js');
         const testFileText = (await fs.readFile(testFilePath)).toString();
         await fs.writeFile(testFilePath, testFileText.replace('@translatable', '@translatable123'));

         await runWorkflowWithTimeout();
         const resultObj = await fs.readJSON(outputJson);
         resultObj.length.should.equals(0);

         await timeoutForMacOS();
         await fs.writeFile(testFilePath, testFileText);

         await runWorkflowWithTimeout();
         await checkResult('tmpl', 'AnyContext');

         await clearWorkspace();
      });
   });

   describe.skip('check localization words collector for wml code', () => {
      it('rebuild without changes', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/wml');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('wml', 'AnyContext');

         await runWorkflowWithTimeout();
         await checkResult('wml', 'AnyContext');

         await clearWorkspace();
      });

      it('rebuild with changes in wml code', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/wml');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('wml', 'AnyContext');

         await timeoutForMacOS();
         const testFilePath = path.join(sourceFolder, 'Модуль/Component.wml');
         const testFileText = (await fs.readFile(testFilePath)).toString();
         await fs.writeFile(testFilePath, testFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('wml', 'AnyContext123');

         await clearWorkspace();
      });

      it('rebuild with changes in cache', async() => {
         //
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/wml');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('wml', 'AnyContext');

         await timeoutForMacOS();
         const cacheFilePath = path.join(cacheFolder, 'grabber-cache.json');
         const cacheFileText = (await fs.readFile(cacheFilePath)).toString();
         await fs.writeFile(cacheFilePath, cacheFileText.replace('AnyContext', 'AnyContext123'));

         await runWorkflowWithTimeout();
         await checkResult('wml', 'AnyContext123');

         await clearWorkspace();
      });

      it('rebuild with changes in js code', async() => {
         // Unlike 1st and 3rd builds, for 2nd build js source has @translatable option
         const fixtureFolder = path.join(__dirname, 'fixture/grabber-generate-workflow/wml');
         await prepareTest(fixtureFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
         await checkResult('wml', 'AnyContext');

         await timeoutForMacOS();
         const testFilePath = path.join(sourceFolder, 'Модуль/ComponentWithOption.js');
         const testFileText = (await fs.readFile(testFilePath)).toString();
         await fs.writeFile(testFilePath, testFileText.replace('@translatable', '@translatable123'));

         await runWorkflowWithTimeout();
         const resultObj = await fs.readJSON(outputJson);
         resultObj.length.should.equals(0);

         await timeoutForMacOS();
         await fs.writeFile(testFilePath, testFileText);

         await runWorkflowWithTimeout();
         await checkResult('wml', 'AnyContext');

         await clearWorkspace();
      });
   });
});
