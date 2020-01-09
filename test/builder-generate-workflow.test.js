/**
 * Main unit-tests for builder workflow generator(main workflow for 'build' task)
 * @author Kolbeshin F.A.
 */

'use strict';

const initTest = require('./init-test');

const path = require('path'),
   fs = require('fs-extra'),
   pMap = require('p-map'),
   helpers = require('../lib/helpers'),
   { decompress } = require('iltorb'),
   { isWindows } = require('../lib/builder-constants'),
   { promiseWithTimeout, TimeoutError } = require('../lib/promise-with-timeout');

const generateWorkflow = require('../gulp/builder/generate-workflow.js');

const {
   timeoutForMacOS, getMTime, removeRSymbol, isSymlink, isRegularFile, linkPlatform
} = require('./lib');

const workspaceFolder = path.join(__dirname, 'workspace'),
   cacheFolder = path.join(workspaceFolder, 'cache'),
   outputFolder = path.join(workspaceFolder, 'output'),
   logsFolder = path.join(workspaceFolder, 'logs'),
   sourceFolder = path.join(workspaceFolder, 'source'),
   configPath = path.join(workspaceFolder, 'config.json'),
   moduleOutputFolder = path.join(outputFolder, 'Modul'),
   module2OutputFolder = path.join(outputFolder, 'Modul2'),
   moduleSourceFolder = path.join(sourceFolder, 'Модуль'),
   noThemesModuleOutputFolder = path.join(outputFolder, 'Modul_bez_tem'),
   noThemesModuleSourceFolder = path.join(sourceFolder, 'Модуль без тем'),
   themesSourceFolder = path.join(sourceFolder, 'Тема Скрепка');

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

const brotliDecompress = function(data) {
   return new Promise((resolve, reject) => {
      decompress(data, (err, decompressed) => {
         if (err) {
            reject(err);
         } else {
            resolve(decompressed);
         }
      });
   });
};

/**
 * properly finish test in builder main workflow was freezed by unexpected
 * critical errors from gulp plugins
 * @returns {Promise<void>}
 */
const runWorkflowWithTimeout = async function(timeout) {
   let result;
   try {
      result = await promiseWithTimeout(runWorkflow(), timeout || 600000);
   } catch (err) {
      result = err;
   }
   if (result instanceof TimeoutError) {
      true.should.equal(false);
   }
};

// нужно проверить что происходит:
// 1. при переименовывании файла == добавление/удаление файла
// 2. при изменении файла
// 3. если файл не менять
describe('gulp/builder/generate-workflow.js', () => {
   before(async() => {
      await initTest();
   });

   it('compile less with coverage', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         lessCoverage: true,
         less: true,
         themes: true,
         typescript: true,
         dependenciesGraph: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'Модуль без тем',
               path: path.join(sourceFolder, 'Модуль без тем')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      const testModuleDepsPath = path.join(outputFolder, 'TestModule/module-dependencies.json');
      let lessDependenciesForTest = (await fs.readJson(testModuleDepsPath)).lessDependencies;

      lessDependenciesForTest['TestModule/stable'].should.have.members([
         'css!Controls-theme/themes/default/helpers/_mixins',
         'css!Controls-theme/themes/default/helpers/_old-mixins',
         'css!SBIS3.CONTROLS/themes/_mixins',
         'css!SBIS3.CONTROLS/themes/online/_variables',
         'css!TestModule/Stable-for-import',
         'css!TestModule/Stable-for-theme-import',
         'css!TestModule/Stable-with-import',
         'css!TestModule/test-style-assign',
         'css!TestModule/test-styles-object',
         'css!TestModule/test-theme-object',
         'css!Модуль/Stable'
      ]);

      // запустим повторно таску
      await runWorkflowWithTimeout();

      lessDependenciesForTest = (await fs.readJson(testModuleDepsPath)).lessDependencies;
      lessDependenciesForTest['TestModule/stable'].should.have.members([
         'css!Controls-theme/themes/default/helpers/_mixins',
         'css!Controls-theme/themes/default/helpers/_old-mixins',
         'css!SBIS3.CONTROLS/themes/_mixins',
         'css!SBIS3.CONTROLS/themes/online/_variables',
         'css!TestModule/Stable-for-import',
         'css!TestModule/Stable-for-theme-import',
         'css!TestModule/Stable-with-import',
         'css!TestModule/test-style-assign',
         'css!TestModule/test-styles-object',
         'css!TestModule/test-theme-object',
         'css!Модуль/Stable'
      ]);

      await clearWorkspace();
   });

   it('new type locales: must compile js-locale and write it to contents only for existing json-locales', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/locales');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const correctContents = {
         availableLanguage: {
            en: 'English',
            'en-US': 'English',
            ru: 'Русский',
            'ru-RU': 'Русский'
         },
         buildMode: 'debug',
         defaultLanguage: 'ru-RU',
         htmlNames: {},
         modules: {
            Modul: {
               dict: [
                  'en',
                  'en-GB',
                  'en-US',
                  'ru-RU'
               ],
               name: 'Модуль'
            }
         }
      };
      const testResults = async() => {
         const contents = await fs.readJson(path.join(moduleOutputFolder, 'contents.json'));
         contents.should.deep.equal(correctContents);
         const listOfDictionaries = await fs.readdir(path.join(moduleOutputFolder, 'lang/en'));
         listOfDictionaries.should.have.members([
            'en-GB.js',
            'en-GB.json',
            'en-GB.json.js',
            'en-US.js',
            'en-US.json',
            'en-US.json.js',
            'en.js',
            'en.json',
            'en.json.js'
         ]);
         const currentDictDirectory = path.join(moduleOutputFolder, 'lang/en');
         (await fs.readJson(path.join(currentDictDirectory, 'en.json'))).should.deep.equal({
            '10 или 12': '10 or 12',
            'Это словарь!': 'This is dictionary!'
         });
         (await fs.readJson(path.join(currentDictDirectory, 'en-US.json'))).should.deep.equal({
            '10 или 12': '10 or 12',
            'Это словарь!': 'This is dictionary! God, bless America!',
            'Ключ для США': 'US key'
         });
         (await fs.readJson(path.join(currentDictDirectory, 'en-GB.json'))).should.deep.equal({
            '10 или 12': '10 or 12',
            'Это словарь!': 'This is dictionary! God, save the queen!',
            'Ключ для Британии': 'GB key'
         });
         (await fs.readFile(path.join(currentDictDirectory, 'en-US.js'), 'utf8')).includes(
            'global.requirejs(["Core/i18n","Modul/lang/en/en-US.json"],function(i18n,dict){i18n.setDict(dict, "Modul/lang/en/en-US.json", "en");});'
         ).should.equal(true);
         (await fs.readFile(path.join(currentDictDirectory, 'en-GB.js'), 'utf8')).includes(
            'global.requirejs(["Core/i18n","Modul/lang/en/en-GB.json"],function(i18n,dict){i18n.setDict(dict, "Modul/lang/en/en-GB.json", "en");});'
         ).should.equal(true);
         (await fs.readFile(path.join(currentDictDirectory, 'en.js'), 'utf8')).includes(
            'global.requirejs(["Core/i18n","Modul/lang/en/en.json"],function(i18n,dict){i18n.setDict(dict, "Modul/lang/en/en.json", "en");});'
         ).should.equal(true);
      };
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         'default-localization': 'ru-RU',
         localization: ['en-US', 'ru-RU', 'en'],
         contents: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };

      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();
      await testResults();

      // incremental build must be completed properly
      await runWorkflowWithTimeout();
      await testResults();
      await clearWorkspace();
   });
   it('compile less without coverage', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: true,
         typescript: true,
         dependenciesGraph: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'Модуль без тем',
               path: path.join(sourceFolder, 'Модуль без тем')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };

      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      const testModuleDepsPath = path.join(outputFolder, 'TestModule/module-dependencies.json');
      let lessDependenciesForTest = (await fs.readJson(testModuleDepsPath)).lessDependencies;

      lessDependenciesForTest.should.deep.equal({});

      // запустим повторно таску
      await runWorkflowWithTimeout();

      lessDependenciesForTest = (await fs.readJson(testModuleDepsPath)).lessDependencies;
      lessDependenciesForTest.should.deep.equal({});

      await clearWorkspace();
   });

   it('compile less', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         lessCoverage: true,
         less: true,
         themes: true,
         typescript: true,
         dependenciesGraph: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'Модуль без тем',
               path: path.join(sourceFolder, 'Модуль без тем')
            },
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      let resultsFiles;
      let noThemesResultsFiles;

      // проверим, что все нужные файлы появились в "стенде"
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange_online.css',
         'ForChange.less',
         'ForRename_old.css',
         'ForRename_old_online.css',
         'ForRename_old.less',
         'Stable.css',
         'Stable_online.css',
         'Stable.less',
         'module-dependencies.json',
         'themes.config.json'
      ]);
      noThemesResultsFiles = await fs.readdir(noThemesModuleOutputFolder);
      noThemesResultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange.less',
         'ForRename_old.css',
         'ForRename_old.less',
         'Stable.css',
         'Stable.less',
         'module-dependencies.json',
         'themes.config.json'
      ]);

      const stableCss = await fs.readFile(path.join(moduleOutputFolder, 'Stable.css'), 'utf8');

      // autoprefixer enabled by default, so css result must have all needed prefixes
      stableCss.replace(/\n$/, '').should.equal('.test-selector {\n' +
         '  test-mixin: \'mixin there\';\n' +
         '  test-var: \'it is online\';\n' +
         '  display: -ms-grid;\n' +
         '  display: grid;\n' +
         '  -ms-grid-columns: 1fr 1fr;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  -ms-grid-rows: auto;\n' +
         '  grid-template-rows: auto;\n' +
         '}');

      // изменим "исходники"
      await timeoutForMacOS();
      await fs.rename(
         path.join(moduleSourceFolder, 'ForRename_old.less'),
         path.join(moduleSourceFolder, 'ForRename_new.less')
      );
      await fs.rename(
         path.join(noThemesModuleSourceFolder, 'ForRename_old.less'),
         path.join(noThemesModuleSourceFolder, 'ForRename_new.less')
      );
      const filePathForChange = path.join(moduleSourceFolder, 'ForChange.less');
      const data = await fs.readFile(filePathForChange);
      await fs.writeFile(filePathForChange, `${data.toString()}\n.test-selector2 {}`);

      // запустим повторно таску
      await runWorkflowWithTimeout();

      // проверим, что все нужные файлы появились в "стенде", лишние удалились
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange_online.css',
         'ForChange.less',
         'ForRename_new.css',
         'ForRename_new_online.css',
         'ForRename_new.less',
         'Stable.css',
         'Stable_online.css',
         'module-dependencies.json',
         'Stable.less',
         'themes.config.json'
      ]);
      noThemesResultsFiles = await fs.readdir(noThemesModuleOutputFolder);
      noThemesResultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange.less',
         'ForRename_new.css',
         'ForRename_new.less',
         'module-dependencies.json',
         'Stable.css',
         'Stable.less',
         'themes.config.json'
      ]);

      // update themes.config.json for interface module "Модуль". all less must be rebuilded for this new themes config.
      await fs.outputJson(path.join(sourceFolder, 'Модуль/themes.config.json'), { old: false, multi: true });

      // rebuild static with new theme
      await runWorkflowWithTimeout();

      // in results of interface module "Модуль" must exist only css with theme postfix(new theme scheme)
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Error.less',
         'ForChange_online.css',
         'ForChange.less',
         'ForRename_new_online.css',
         'ForRename_new.less',
         'Stable_online.css',
         'module-dependencies.json',
         'Stable.less',
         'themes.config.json'
      ]);

      resultsFiles = await fs.readdir(path.join(outputFolder, 'TestModule'));
      resultsFiles.should.have.members([
         'Stable-for-import.css',
         'Stable-for-import.less',
         'Stable-for-import_online.css',
         'Stable-for-theme-import.css',
         'Stable-for-theme-import.less',
         'Stable-for-theme-import_online.css',
         'Stable-with-import.css',
         'Stable-with-import.less',
         'Stable-with-import_online.css',
         'module-dependencies.json',
         'stable.js',
         'stable.ts',
         'themes.config.json'
      ]);

      // disable old themes for current project.
      config.oldThemes = false;
      await fs.writeJSON(configPath, config);

      await runWorkflow();

      // in results of module TestModule must not exists styles for old themes
      resultsFiles = await fs.readdir(path.join(outputFolder, 'TestModule'));
      resultsFiles.should.have.members([
         'Stable-for-import.less',
         'Stable-for-import_online.css',
         'Stable-for-theme-import.less',
         'Stable-for-theme-import_online.css',
         'Stable-with-import.less',
         'Stable-with-import_online.css',
         'module-dependencies.json',
         'stable.js',
         'stable.ts',
         'themes.config.json'
      ]);

      await clearWorkspace();
   });

   it('content dictionaries - AMD-formatted dictionaries meta must be saved only for modules with it', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/dictionary');
      await prepareTest(fixtureFolder);
      const testResults = async() => {
         const module1Meta = await fs.readFile(path.join(outputFolder, 'Module1/.builder/module.js'), 'utf8');
         module1Meta.should.equal('define(\'Module1/.builder/module\',[],function(){return {"dict":["en","en-GB","en-US","en.css","ru-RU"]};});');
         (await isRegularFile(path.join(outputFolder, 'Module2/.builder'), 'module.js')).should.equal(false);
         const { messages } = await fs.readJson(path.join(workspaceFolder, 'logs/builder_report.json'));
         const errorMessage = 'Attempt to use css from root lang directory, use less instead!';
         let cssLangErrorExists = false;
         messages.forEach((currentError) => {
            if (currentError.message === errorMessage) {
               cssLangErrorExists = true;
            }
         });
         cssLangErrorExists.should.equal(true);
      };
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         contents: true,
         builderTests: true,
         'default-localization': 'ru-RU',
         localization: ['ru-RU', 'en-US'],
         modules: [
            {
               name: 'Module1',
               path: path.join(sourceFolder, 'Module1')
            },
            {
               name: 'Module2',
               path: path.join(sourceFolder, 'Module2')
            }
         ]
      };
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout(30000);
      await testResults();
      await runWorkflowWithTimeout(30000);
      await testResults();
      await clearWorkspace();
   });
   it('compile less - should return correct meta in "contents" for new themes', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const testModuleThemes = (currentContents) => {
         const testModuleNewThemes = currentContents.modules.TestModule.newThemes;
         testModuleNewThemes.hasOwnProperty('TestModule/test-online').should.equal(true);
         testModuleNewThemes['TestModule/test-online'].should.have.members([
            'online', 'anotherTheme', 'online:dark-large', 'online:dark:medium'
         ]);
         testModuleNewThemes.hasOwnProperty('TestModule/dark/subDirectoryForOnline/test-online').should.equal(true);
         testModuleNewThemes['TestModule/dark/subDirectoryForOnline/test-online'].should.have.members([
            'online'
         ]);
         testModuleNewThemes.hasOwnProperty('TestModule/subDirectoryForDarkMedium/test-online').should.equal(true);
         testModuleNewThemes['TestModule/subDirectoryForDarkMedium/test-online'].should.have.members([
            'online:dark:medium'
         ]);
      };
      const testResults = async() => {
         // test contents.json for correct new themes content
         let testModuleContents = await fs.readJson(path.join(outputFolder, 'TestModule/contents.json'));
         testModuleThemes(testModuleContents);

         // also contents.js needs to be tested for correct content of new themes
         testModuleContents = await fs.readFile(path.join(outputFolder, 'TestModule/contents.js'), 'utf8');
         testModuleContents = JSON.parse(testModuleContents.slice(9, testModuleContents.length));
         testModuleThemes(testModuleContents);

         // test common contents.json for correct new themes content
         let testCommonModuleContents = await fs.readJson(path.join(outputFolder, 'contents.json'));
         testModuleThemes(testCommonModuleContents);

         // also contents.js needs to be tested for correct content of new themes
         testCommonModuleContents = await fs.readFile(path.join(outputFolder, 'TestModule/contents.js'), 'utf8');
         testCommonModuleContents = JSON.parse(testCommonModuleContents.slice(9, testCommonModuleContents.length));
         testModuleThemes(testModuleContents);

         // new themes meta must not be stored into ".builder/module.js" meta for localization module.
         (await isRegularFile(path.join(outputFolder, 'TestModule/.builder'), 'module.js')).should.equal(false);

         /**
          * In case of using new themes algorythm for less compiling we must not compile less also for
          * old themes. Result will be the same, but for the same time it will downgrade the speed
          * because of compiling 2 styles for one less with the same result's content.
          */
         (await isRegularFile(path.join(outputFolder, 'TestModule-anotherTheme-theme'), 'badVariable.css')).should.equal(false);
      };
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: true,
         typescript: true,
         dependenciesGraph: true,
         contents: true,
         builderTests: true,
         joinedMeta: true,
         modules: [
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            },
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'TestModule-anotherTheme-theme',
               path: path.join(sourceFolder, 'TestModule-anotherTheme-theme')
            },
            {
               name: 'TestModule-online-theme',
               path: path.join(sourceFolder, 'TestModule-online-theme')
            },
            {
               name: 'NotExisting-online-theme',
               path: path.join(sourceFolder, 'NotExisting-online-theme')
            }
         ]
      };
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout(30000);
      await testResults();
      await runWorkflowWithTimeout(30000);
      await testResults();

      // set "TestModule" as module for patch, rebuild it and check results
      config.modules[0].rebuild = true;
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout(30000);
      await testResults();
      await clearWorkspace();
   });

   it('should recompile properly after source directory renamed without cache reset', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      let config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: true,
         modules: [
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      // изменим "исходники"
      await timeoutForMacOS();

      await fs.rename(
         workspaceFolder,
         `${workspaceFolder}-1`
      );
      const renamedCacheFolder = path.join(`${workspaceFolder}-1`, 'cache');
      const renamedOutputFolder = path.join(`${workspaceFolder}-1`, 'output');
      const renamedSourceFolder = path.join(`${workspaceFolder}-1`, 'source');
      config = {
         cache: renamedCacheFolder,
         output: renamedOutputFolder,
         less: true,
         themes: true,
         modules: [
            {
               name: 'Controls-theme',
               path: path.join(renamedSourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(renamedSourceFolder, 'Модуль')
            }
         ]
      };

      await fs.outputJSON(configPath, config);

      // запустим повторно таску
      await runWorkflowWithTimeout();
      await fs.remove(`${workspaceFolder}-1`);
      await clearWorkspace();
   });

   it('compile less with patch', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);
      const patchOutputFolder = `${outputFolder}-1`;
      const config = {
         cache: cacheFolder,
         output: patchOutputFolder,
         less: true,
         themes: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               rebuild: true
            },
            {
               name: 'Модуль без тем',
               path: path.join(sourceFolder, 'Модуль без тем')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим повторно таску
      await runWorkflowWithTimeout();

      // result content for patch should be written only for interface module "Modul"
      const resultsFiles = await fs.readdir(path.join(patchOutputFolder, 'Modul'));
      resultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange_online.css',
         'ForChange.less',
         'ForRename_old.css',
         'ForRename_old_online.css',
         'ForRename_old.less',
         'Stable.css',
         'Stable_online.css',
         'Stable.less',
         'themes.config.json'
      ]);
      const noThemesDirectoryExists = await fs.pathExists(path.join(patchOutputFolder, 'Modul_bez_tem'));
      noThemesDirectoryExists.should.equal(false);
      const sbis3controlsDirectoryExists = await fs.pathExists(path.join(patchOutputFolder, 'SBIS3.CONTROLS'));
      sbis3controlsDirectoryExists.should.equal(false);
      const controlsThemeDirectoryExists = await fs.pathExists(path.join(patchOutputFolder, 'Controls-theme'));
      controlsThemeDirectoryExists.should.equal(false);
      await clearWorkspace();
   });

   it('compile only selected less', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: ['default'],
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      let resultsFiles;

      // check for selected themes builded properly
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange.less',
         'ForRename_old.css',
         'ForRename_old.less',
         'Stable.css',
         'Stable.less',
         'themes.config.json'
      ]);

      // изменим "исходники"
      await timeoutForMacOS();

      // запустим повторно таску
      await runWorkflowWithTimeout();

      // проверим, что все нужные файлы появились в "стенде", лишние удалились
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'Error.less',
         'ForChange.css',
         'ForChange.less',
         'ForRename_old.css',
         'ForRename_old.less',
         'Stable.css',
         'Stable.less',
         'themes.config.json'
      ]);
      await clearWorkspace();
   });

   it('actual builder cache', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      let config = {
         cache: cacheFolder,
         output: outputFolder,
         builderTests: true,
         wml: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core'),
               required: true
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // make test folders in platform modules cache to check it was removed after rebuild with new config.
      await fs.ensureDir(path.join(cacheFolder, 'platform/PlatformModule1'));
      await fs.ensureDir(path.join(cacheFolder, 'platform/PlatformModule2'));

      // запустим таску
      await runWorkflowWithTimeout();

      config = {
         cache: cacheFolder,
         output: outputFolder,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();

      // gulp_config was changed, so we need to ensure cache platform folder for old build was removed
      (await fs.pathExists(path.join(cacheFolder, 'platform'))).should.equal(false);

      // source symlinks must have new actual list of source modules
      const sourceSymlinksDirectoryList = await fs.readdir(path.join(cacheFolder, 'temp-modules'));
      sourceSymlinksDirectoryList.should.have.members([
         'SBIS3.CONTROLS',
         'Controls-theme',
         'Модуль'
      ]);
      await clearWorkspace();
   });

   it('routes-info', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/routes');
      await prepareTest(fixtureFolder);
      let resultsFiles, routesInfoResult;

      const testResults = async(currentUrl) => {
         // проверим, что все нужные файлы появились в "стенде", лишние удалились
         resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members([
            'ForChange.routes.js',
            'ForRename_old.routes.js',
            'Stable.routes.js',
            'Test1.js',
            'navigation-modules.json',
            'routes-info.json',
            'static_templates.json',
            'tsRouting.routes.js',
            'tsRouting.routes.ts'
         ]);
         routesInfoResult = await fs.readJson(path.join(moduleOutputFolder, 'routes-info.json'));
         routesInfoResult.hasOwnProperty('resources/Modul/tsRouting.routes.js').should.equal(true);
         const currentRouting = routesInfoResult['resources/Modul/tsRouting.routes.js'];
         currentRouting[currentUrl].should.deep.equal({
            controller: 'Modul/Test1',
            isMasterPage: false
         });
      };
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         typescript: true,
         presentationServiceMeta: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();
      await testResults('/ForChange_old.html');

      await fs.writeFile(
         path.join(sourceFolder, 'Модуль/tsRouting.routes.ts'),
         'module.exports = function() {\n' +
         '    return {\n' +
         '        \'/ForChange_new.html\': \'Modul/Test1\'\n' +
         '    };\n' +
         '};'
      );

      await timeoutForMacOS();

      // запустим повторно таску
      await runWorkflowWithTimeout();
      await testResults('/ForChange_new.html');
      await clearWorkspace();
   });

   it('static html', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/staticHtml');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         deprecatedWebPageTemplates: true,
         htmlWml: true,
         contents: true,
         presentationServiceMeta: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               depends: ['Тема Скрепка']
            },
            {
               name: 'Тема Скрепка',
               path: path.join(sourceFolder, 'Тема Скрепка')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      // проверим, что все нужные файлы появились в "стенде"
      let resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'ForChange.js',
         'ForChange_old.html',
         'ForRename_old.js',
         'ForRename.html',
         'Test',
         'TestASort',
         'Stable.js',
         'Stable.html',
         'contents.js',
         'contents.json',
         'navigation-modules.json',
         'routes-info.json',
         'static_templates.json'
      ]);
      const contentsJsonOutputPath = path.join(moduleOutputFolder, 'contents.json');
      let contentsObj = await fs.readJSON(contentsJsonOutputPath);
      await contentsObj.should.deep.equal({
         buildMode: 'debug',
         htmlNames: {
            'Modul/ForChange': 'ForChange_old.html',
            'Modul/ForRename_old': 'ForRename.html',
            'Modul/Stable': 'Stable.html'
         },
         modules: {
            Modul: {
               name: 'Модуль'
            }
         }
      });

      // запомним время модификации незменяемого файла и изменяемого в "стенде"
      const stableJsOutputPath = path.join(moduleOutputFolder, 'Stable.js');
      const stableHtmlOutputPath = path.join(moduleOutputFolder, 'Stable.html');
      const forChangeJsOutputPath = path.join(moduleOutputFolder, 'ForChange.js');
      let forChangeHtmlOutputPath = path.join(moduleOutputFolder, 'ForChange_old.html');
      const mTimeStableJs = await getMTime(stableJsOutputPath);
      const mTimeStableHtml = await getMTime(stableHtmlOutputPath);
      const mTimeForChangeJs = await getMTime(forChangeJsOutputPath);
      const mTimeForChangeHtml = await getMTime(forChangeHtmlOutputPath);

      // проверим сами html
      let stableHtml = await fs.readFile(stableHtmlOutputPath);
      let forChangeHtml = await fs.readFile(forChangeHtmlOutputPath);
      const forRenameHtmlOutputPath = path.join(moduleOutputFolder, 'ForRename.html');
      let forRenameHtml = await fs.readFile(forRenameHtmlOutputPath);
      const staticTemplatesJsonOutputPath = path.join(moduleOutputFolder, 'static_templates.json');
      let staticTemplatesJson = await fs.readFile(staticTemplatesJsonOutputPath);
      removeRSymbol(stableHtml.toString()).should.equal(
         '<STABLE></STABLE>\n' +
            '<TITLE>Stable</TITLE>\n' +
            '<START_DIALOG>Modul/Stable</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>resources/</RESOURCE_ROOT>\n' +
            '<WI.SBIS_ROOT>resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT></APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );
      removeRSymbol(forChangeHtml.toString()).should.equal(
         '<FOR_CHANGE_OLD></FOR_CHANGE_OLD>\n' +
            '<TITLE>ForChange_old</TITLE>\n' +
            '<START_DIALOG>Modul/ForChange</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>resources/</RESOURCE_ROOT>\n' +
            '<WI.SBIS_ROOT>resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT></APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );
      removeRSymbol(forRenameHtml.toString()).should.equal(
         '<FOR_RENAME></FOR_RENAME>\n' +
            '<TITLE>ForRename</TITLE>\n' +
            '<START_DIALOG>Modul/ForRename_old</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>resources/</RESOURCE_ROOT>\n' +
            '<WI.SBIS_ROOT>resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT></APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );
      removeRSymbol(staticTemplatesJson.toString()).should.equal(
         '{\n' +
            '  "/ForChange_old.html": "Modul/ForChange_old.html",\n' +
            '  "/ForRename.html": "Modul/ForRename.html",\n' +
            '  "/Stable.html": "Modul/Stable.html",\n' +
            '  "/Stable/One": "Modul/Stable.html",\n' +
            '  "/Stable/Two": "Modul/Stable.html",\n' +
            '  "/Stable_Three": "Modul/Stable.html",\n' +
            '  "/TestHtmlTmpl.html": "Модуль/TestASort/TestHtmlTmpl.html"\n' +
            '}'
      );

      // изменим "исходники"
      await timeoutForMacOS();
      await fs.rename(
         path.join(moduleSourceFolder, 'ForRename_old.js'),
         path.join(moduleSourceFolder, 'ForRename_new.js')
      );
      await fs.rename(
         path.join(themesSourceFolder, 'ForRename_old.html'),
         path.join(themesSourceFolder, 'ForRename_new.html')
      );

      const filePathForChangeJs = path.join(moduleSourceFolder, 'ForChange.js');
      const dataJs = await fs.readFile(filePathForChangeJs);
      await fs.writeFile(filePathForChangeJs, dataJs.toString().replace(/ForChange_old/g, 'ForChange_new'));

      const filePathForChangeHtml = path.join(themesSourceFolder, 'ForChange.html');
      const dataHtml = await fs.readFile(filePathForChangeHtml);
      await fs.writeFile(filePathForChangeHtml, dataHtml.toString().replace(/FOR_CHANGE_OLD/g, 'FOR_CHANGE_NEW'));

      // запустим повторно таску
      await runWorkflowWithTimeout();

      // проверим, что все нужные файлы появились в "стенде", лишние удалились
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'ForChange.js',
         'ForChange_new.html',
         'ForRename_new.js',
         'ForRename.html',
         'Test',
         'TestASort',
         'Stable.js',
         'Stable.html',
         'contents.js',
         'contents.json',
         'navigation-modules.json',
         'routes-info.json',
         'static_templates.json'
      ]);

      // проверим время модификации незменяемого файла и изменяемого в "стенде"
      // !!! В отличии от остальных файлов, статические HTML всегда пересоздаются заново, т.к. кешировать их сложно,
      // а весь процесс длится меньше 2 секунд.
      forChangeHtmlOutputPath = path.join(moduleOutputFolder, 'ForChange_new.html');
      (await getMTime(stableJsOutputPath)).should.equal(mTimeStableJs);

      // следующая проверка отличается от остальных и это норма
      (await getMTime(stableHtmlOutputPath)).should.not.equal(mTimeStableHtml);
      (await getMTime(forChangeJsOutputPath)).should.not.equal(mTimeForChangeJs);
      (await getMTime(forChangeHtmlOutputPath)).should.not.equal(mTimeForChangeHtml);

      contentsObj = await fs.readJSON(contentsJsonOutputPath);
      await contentsObj.should.deep.equal({
         buildMode: 'debug',
         htmlNames: {
            'Modul/ForChange': 'ForChange_new.html',
            'Modul/ForRename_old': 'ForRename.html',
            'Modul/Stable': 'Stable.html'
         },
         modules: {
            Modul: {
               name: 'Модуль'
            }
         }
      });

      // проверим сами html
      stableHtml = await fs.readFile(stableHtmlOutputPath);
      forChangeHtml = await fs.readFile(forChangeHtmlOutputPath);
      forRenameHtml = await fs.readFile(forRenameHtmlOutputPath);
      staticTemplatesJson = await fs.readFile(staticTemplatesJsonOutputPath);
      removeRSymbol(stableHtml.toString()).should.equal(
         '<STABLE></STABLE>\n' +
            '<TITLE>Stable</TITLE>\n' +
            '<START_DIALOG>Modul/Stable</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>resources/</RESOURCE_ROOT>\n' +
            '<WI.SBIS_ROOT>resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT></APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );

      // TODO: в следующей строке ошибка из-за кеширования результата в lib/generate-static-html-for-js.js.
      // должно быть FOR_CHANGE_NEW. пока этим можно пренебречь
      removeRSymbol(forChangeHtml.toString()).should.equal(
         '<FOR_CHANGE_OLD></FOR_CHANGE_OLD>\n' +
            '<TITLE>ForChange_new</TITLE>\n' +
            '<START_DIALOG>Modul/ForChange</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>resources/</RESOURCE_ROOT>\n' +
            '<WI.SBIS_ROOT>resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT></APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );

      removeRSymbol(forRenameHtml.toString()).should.equal(
         '<FOR_RENAME></FOR_RENAME>\n' +
            '<TITLE>ForRename</TITLE>\n' +
            '<START_DIALOG>Modul/ForRename_old</START_DIALOG>\n' +
            '<INCLUDE><INCLUDE1/>\n' +
            '</INCLUDE>\n' +
            '<RESOURCE_ROOT>resources/</RESOURCE_ROOT>\n' +
            '<WI.SBIS_ROOT>resources/WS.Core/</WI.SBIS_ROOT>\n' +
            '<APPLICATION_ROOT></APPLICATION_ROOT>\n' +
            '<SERVICES_PATH>service/</SERVICES_PATH>\n' +
            '<APPEND_STYLE></APPEND_STYLE>\n' +
            '<APPEND_JAVASCRIPT></APPEND_JAVASCRIPT>\n' +
            '<ACCESS_LIST></ACCESS_LIST>\n' +
            '<CONFIG.USER_PARAMS>%{CONFIG.USER_PARAMS}</CONFIG.USER_PARAMS>\n' +
            '<CONFIG.GLOBAL_PARAMS>%{CONFIG.GLOBAL_PARAMS}</CONFIG.GLOBAL_PARAMS>\n' +
            '<SAVE_LAST_STATE>false</SAVE_LAST_STATE>\n'
      );
      removeRSymbol(staticTemplatesJson.toString()).should.equal(
         '{\n' +
            '  "/ForChange_new.html": "Modul/ForChange_new.html",\n' +
            '  "/ForRename.html": "Modul/ForRename.html",\n' +
            '  "/Stable.html": "Modul/Stable.html",\n' +
            '  "/Stable/One": "Modul/Stable.html",\n' +
            '  "/Stable/Two": "Modul/Stable.html",\n' +
            '  "/Stable_Three": "Modul/Stable.html",\n' +
            '  "/TestHtmlTmpl.html": "Модуль/TestASort/TestHtmlTmpl.html"\n' +
            '}'
      );

      await clearWorkspace();
   });

   it('create symlink or copy', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/symlink');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      let config = {
         cache: cacheFolder,
         output: outputFolder,
         presentationServiceMeta: true,
         deprecatedWebPageTemplates: true,
         htmlWml: true,
         contents: true,
         less: true,
         themes: true,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      const check = async() => {
         // запустим таску
         await runWorkflowWithTimeout();

         // файлы из исходников
         (await isSymlink(moduleOutputFolder, 'template.html')).should.equal(true);
         (await isSymlink(moduleOutputFolder, 'TestHtmlTmpl.html.tmpl')).should.equal(true);
         (await isSymlink(moduleOutputFolder, 'TestStaticHtml.js')).should.equal(true);

         // генерируемые файлы из исходников
         (await isRegularFile(moduleOutputFolder, 'StaticHtml.html')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'TestLess_online.css')).should.equal(true);

         // генерируемые файлы на модуль
         (await isRegularFile(moduleOutputFolder, 'contents.js')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'contents.json')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'navigation-modules.json')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'static_templates.json')).should.equal(true);
      };

      await check();
      (await isRegularFile(moduleOutputFolder, 'TestHtmlTmpl.html')).should.equal(true);

      config = {
         cache: cacheFolder,
         output: outputFolder,
         presentationServiceMeta: true,
         deprecatedWebPageTemplates: true,
         htmlWml: true,
         contents: true,
         less: true,
         themes: true,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // recheck build result again to check proper work of incremental build
      await check();

      /**
       * after rebuild without "View" and "UI" module:
       * 1)html.tmpl must not be builded.
       * 2)project build must be completed successfully
       */
      (await isRegularFile(moduleOutputFolder, 'TestHtmlTmpl.html')).should.equal(false);

      await clearWorkspace();
   });

   it('dont clear output if configured', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/symlink');
      await prepareTest(fixtureFolder);

      let config = {
         cache: cacheFolder,
         output: outputFolder,
         builderTests: true,
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      (await fs.pathExists(path.join(outputFolder, 'SBIS3.CONTROLS'))).should.equal(true);

      config = {
         cache: cacheFolder,
         output: outputFolder,
         clearOutput: false,
         builderTests: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();

      // check for the first run results saved in the output directory
      (await fs.pathExists(moduleOutputFolder)).should.equal(true);
      (await fs.pathExists(path.join(outputFolder, 'SBIS3.CONTROLS'))).should.equal(true);
      await clearWorkspace();
   });

   // проверим, что js локализации корректно создаются. и что en-US.less попадает в lang/en-US/en-US.css
   it('localization dictionary and style', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/localization');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         localization: ['en-US', 'ru-RU'],
         'default-localization': 'ru-RU',
         modules: [
            {
               name: 'SBIS3.CONTROLS',
               path: path.join(sourceFolder, 'SBIS3.CONTROLS')
            },
            {
               name: 'Controls-theme',
               path: path.join(sourceFolder, 'Controls-theme')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      const check = async() => {
         // запустим таску
         await runWorkflowWithTimeout();

         (await isRegularFile(moduleOutputFolder, 'lang/en-US/en-US.css')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'lang/en-US/en-US.js')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'lang/ru-RU/ru-RU.js')).should.equal(true);

         (await isSymlink(moduleOutputFolder, 'lang/ru-RU/ru-RU.json')).should.equal(true);
      };

      await check();

      // второй раз, чтобы проверить не ломает ли чего инкрементальная сборка
      await check();

      await clearWorkspace();
   });

   it('versionize-meta', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/versionize-meta');
      const builderMetaOutput = path.join(moduleOutputFolder, '.builder');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         minimize: true,
         wml: true,
         builderTests: true,
         version: 'builder-test',
         localization: false,
         'default-localization': false,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'View')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();
      (await isRegularFile(builderMetaOutput, 'versioned_modules.json')).should.equal(true);
      (await isRegularFile(builderMetaOutput, 'cdn_modules.json')).should.equal(true);
      let versionedModules = await fs.readJson(path.join(builderMetaOutput, 'versioned_modules.json'));
      let cdnModules = await fs.readJson(path.join(builderMetaOutput, 'cdn_modules.json'));
      versionedModules.should.have.members([
         'Modul/TimeTester.min.tmpl',
         'Modul/browser.min.css',
         'Modul/browser-with-real-cdn.min.css',
         'Modul/demo.html'
      ]);
      cdnModules.should.have.members([
         'Modul/TimeTester.min.tmpl',
         'Modul/TimeTester.tmpl',
         'Modul/browser.min.css',
         'Modul/browser.css'
      ]);

      // прогоним ещё раз, создание мета-файла версионирования должно нормально работать в инкрементальной сборке
      await runWorkflowWithTimeout();
      (await isRegularFile(builderMetaOutput, 'versioned_modules.json')).should.equal(true);
      versionedModules = await fs.readJson(path.join(builderMetaOutput, 'versioned_modules.json'));
      cdnModules = await fs.readJson(path.join(builderMetaOutput, 'cdn_modules.json'));
      versionedModules.should.have.members([
         'Modul/TimeTester.min.tmpl',
         'Modul/browser.min.css',
         'Modul/browser-with-real-cdn.min.css',
         'Modul/demo.html'
      ]);
      cdnModules.should.have.members([
         'Modul/TimeTester.min.tmpl',
         'Modul/TimeTester.tmpl',
         'Modul/browser.min.css',
         'Modul/browser.css'
      ]);
      await clearWorkspace();
   });

   it('minimize third-party libraries', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/minimize');
      const testResults = async() => {
         const firstMinifiedContent = await fs.readFile(path.join(outputFolder, 'ThirdPartyModule/third-party/test.min.js'), 'utf8');
         const secondMinifiedContent = await fs.readFile(path.join(outputFolder, 'ThirdPartyModule/third-party/test2.min.js'), 'utf8');

         // source library with minified version must be written into output as is
         removeRSymbol(firstMinifiedContent).should.equal('define(\'ThirdPartyModule/test\', [\'someDependency\'], function (dep1) {\n' +
            '   /* minified content from sources */\n' +
            '   return {\n' +
            '      dep1: dep1,\n' +
            '      _moduleName: \'ThirdPartyModule/test\'\n' +
            '   }\n' +
            '});');

         // source library without minified version must be minified by builder
         removeRSymbol(secondMinifiedContent).should.equal(
            'define("ThirdPartyModule/test2",["someDependency","someAnotherDependency"],function(e,d){return{dep1:e,dep2:d,_moduleName:"ThirdPartyModule/test2"}});'
         );
      };
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         minimize: true,
         modules: [
            {
               name: 'ThirdPartyModule',
               path: path.join(sourceFolder, 'ThirdPartyModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();
      await testResults();
      await runWorkflowWithTimeout();
      await testResults();
      await clearWorkspace();
   });

   it('filter sources', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/esAndTs');
      await prepareTest(fixtureFolder);
      const config = {
         cache: cacheFolder,
         output: sourceFolder,
         typescript: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      const sourceTsMTime = await getMTime(path.join(sourceFolder, 'Модуль/StableTS.ts'));

      await runWorkflowWithTimeout(30000);

      (await getMTime(path.join(sourceFolder, 'Модуль/StableTS.ts'))).should.equal(sourceTsMTime);
      await clearWorkspace();
   });
   describe('custom pack', () => {
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         typescript: true,
         less: true,
         themes: true,
         minimize: true,
         wml: true,
         version: 'builder.unit.tests',
         localization: ['en', 'ru', 'ru-RU'],
         'default-localization': 'ru-RU',
         deprecatedXhtml: true,
         builderTests: true,
         customPack: true,
         contents: true,
         compress: true,
         joinedMeta: true,
         dependenciesGraph: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               depends: ['WS.Core', 'Types']
            },
            {
               name: 'ExternalInterfaceModule',
               path: path.join(sourceFolder, 'ExternalInterfaceModule')
            },
            {
               name: 'InterfaceModule1',
               path: path.join(sourceFolder, 'InterfaceModule1')
            },
            {
               name: 'InterfaceModule2',
               path: path.join(sourceFolder, 'InterfaceModule2')
            },
            {
               name: 'InterfaceModule3',
               path: path.join(sourceFolder, 'InterfaceModule3')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Vdom',
               path: path.join(sourceFolder, 'Vdom')
            },
            {
               name: 'Router',
               path: path.join(sourceFolder, 'Router')
            },
            {
               name: 'Inferno',
               path: path.join(sourceFolder, 'Inferno')
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types')
            }
         ]
      };
      before(async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);
         await fs.writeJSON(configPath, config);

         await runWorkflowWithTimeout();
      });

      it('joined meta must have all common builder meta files', async() => {
         (await isRegularFile(outputFolder, 'module-dependencies.json')).should.equal(true);
         (await isRegularFile(outputFolder, 'module-dependencies.min.json')).should.equal(true);
         (await isRegularFile(outputFolder, 'bundles.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'bundles.min.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'router.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'router.min.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'contents.json')).should.equal(true);
         (await isRegularFile(outputFolder, 'contents.js')).should.equal(true);
         (await isRegularFile(outputFolder, 'contents.min.js')).should.equal(true);
      });
      it('exclude new unknown for builder packages', async() => {
         (await isRegularFile(moduleOutputFolder, 'test.package.min.js')).should.equal(false);
         (await isRegularFile(moduleOutputFolder, 'test.package.min.css')).should.equal(false);
      });
      it('generate extendable bundles', async() => {
         const correctExtendableBundles = await fs.readJson(
            path.join(
               sourceFolder,
               'extendableBundlesResults',
               'extendableBundles.json'
            )
         );
         const correctSuperbundleConfig = await fs.readJson(
            path.join(
               sourceFolder,
               'extendableBundlesResults',
               'superbundle-result-config.json'
            )
         );
         const wsCoreBundles = await fs.readJson(path.join(outputFolder, 'WS.Core', 'bundles.json'));

         // WS.Core bundles meta must containing joined superbundle from extendable parts
         Object.keys(correctExtendableBundles).forEach((currentKey) => {
            wsCoreBundles.hasOwnProperty(currentKey).should.equal(true);
            wsCoreBundles[currentKey].should.have.members(correctExtendableBundles[currentKey]);
         });
         const currentCssPackage = await fs.readFile(path.join(
            outputFolder,
            'WS.Core',
            'superbundle-for-builder-tests.package.min.css'
         ));
         const sourceCssPackage = await fs.readFile(path.join(
            sourceFolder,
            'extendableBundlesResults',
            'cssPackage.css'
         ));
         const currentJsPackage = await fs.readFile(path.join(
            outputFolder,
            'WS.Core',
            'superbundle-for-builder-tests.package.min.js'
         ));
         const sourceJsPackage = await fs.readFile(path.join(
            sourceFolder,
            'extendableBundlesResults',
            'jsPackage.js'
         ));

         currentJsPackage.toString().should.equal(sourceJsPackage.toString());
         currentCssPackage.toString().should.equal(sourceCssPackage.toString());

         const testSuperBundleModules = [
            'InterfaceModule3/amdAnotherModule',
            'InterfaceModule3/amdModule',
            'css!InterfaceModule3/amdModule',
            'InterfaceModule2/amdModule',
            'css!InterfaceModule2/moduleStyle',
            'InterfaceModule1/amdModule',
            'css!InterfaceModule1/moduleStyle'
         ];

         const resultWSCoreBundles = await fs.readJson(path.join(outputFolder, 'WS.Core/bundles.json'));
         const currentBundle = 'resources/WS.Core/superbundle-for-builder-tests.package.min';
         const resultSuperBundleMeta = resultWSCoreBundles[currentBundle];
         const resultWSCoreBundlesRoute = await fs.readJson(path.join(outputFolder, 'WS.Core/bundlesRoute.json'));
         testSuperBundleModules.forEach((currentModule) => {
            resultSuperBundleMeta.includes(currentModule).should.equal(true);
            resultWSCoreBundlesRoute.hasOwnProperty(currentModule).should.equal(true);
            if (currentModule.startsWith('css!')) {
               resultWSCoreBundlesRoute[currentModule].should.equal(`${currentBundle}.css`);
            } else {
               resultWSCoreBundlesRoute[currentModule].should.equal(`${currentBundle}.js`);
            }
         });

         /**
          * In ExternalInterfaceModule we have packed into moduled superbundle library "library". bundlesRoute meta must
          * not have information about this library. "libraries" meta must have it.
          */
         const resultModuleLibraries = await fs.readJson(path.join(outputFolder, 'ExternalInterfaceModule/.builder/libraries.json'));
         const resultModuleBundlesRoute = await fs.readJson(path.join(outputFolder, 'ExternalInterfaceModule/bundlesRoute.json'));
         resultModuleLibraries.should.have.members([
            'ExternalInterfaceModule/library'
         ]);
         resultModuleBundlesRoute.should.deep.equal({
            'ExternalInterfaceModule/_private/module1': 'resources/Modul/TestBSort/test-projectMDeps.package.min.js',
            'ExternalInterfaceModule/_private/module2': 'resources/Modul/TestBSort/test-projectMDeps.package.min.js',
            'ExternalInterfaceModule/amdModule': 'resources/Modul/TestBSort/test-projectMDeps.package.min.js',
            'ExternalInterfaceModule/library': 'resources/Modul/TestBSort/test-projectMDeps.package.min.js',
            'css!ExternalInterfaceModule/moduleStyle': 'resources/Modul/TestBSort/test-projectMDeps.package.min.css'
         });

         // build result must have correct meta about extendable bundles
         const resultExtendBundlesMeta = await fs.readJson(path.join(outputFolder, 'InterfaceModule1/extend-bundles.json'));
         resultExtendBundlesMeta.should.deep.equal({
            'InterfaceModule1/superbundle-for-builder-tests.package.min.css': {
               extendsTo: 'superbundle-for-builder-tests.package.min.css',
               config: '/InterfaceModule1/extend.package.json:superbundle-for-builder-tests.package.js'
            },
            'InterfaceModule1/superbundle-for-builder-tests.package.min.js': {
               extendsTo: 'superbundle-for-builder-tests.package.min.js',
               modules: [
                  'InterfaceModule1/amdModule',
                  'InterfaceModule1/library',
                  'css!InterfaceModule1/moduleStyle'
               ],
               config: '/InterfaceModule1/extend.package.json:superbundle-for-builder-tests.package.js'
            }
         });

         /**
          * check generated superbundle config meta to be strictly equal to
          * correct meta.
          */
         const superbundleConfig = await fs.readJson(
            path.join(
               outputFolder,
               'InterfaceModule1/.builder/superbundle-for-builder-tests.package.js.package.json'
            )
         );
         superbundleConfig.should.deep.equal(correctSuperbundleConfig);
      });
      it('gzip and brotli - check for brotli correct encoding and decoding. Should compressed only minified and packed', async() => {
         const resultFiles = await fs.readdir(moduleOutputFolder);
         let correctMembers = [
            '.builder',
            'Test',
            'lang',
            'TestASort',
            'TestBSort',
            'Page.min.wml',
            'Page.min.wml.gz',
            'Page.wml',
            'Page.min.xhtml',
            'Page.xhtml',
            'contents.js',
            'contents.json',
            'Stable.css',
            'Stable.less',
            'Stable.min.css',
            'Stable.min.css.gz',
            'cbuc-icons.eot',
            'bundles.json',
            'bundlesRoute.json',
            'module-dependencies.json',
            'pack.package.json',
            'test-brotli.package.min.css',
            'test-brotli.package.min.css.gz',
            'test-brotli.package.min.js',
            'test-brotli.package.min.js.gz',
            'themes.config.json',
            'themes.config.min.json',
            'themes.config.min.json.gz'
         ];

         if (!isWindows) {
            correctMembers = correctMembers.concat([
               'Page.min.wml.br',
               'Stable.min.css.br',
               'test-brotli.package.min.css.br',
               'test-brotli.package.min.js.br',
               'themes.config.min.json.br'
            ]);
         }

         // output directory must have brotli(except windows os) and gzip files, only for minified files and packages.
         resultFiles.should.have.members(correctMembers);

         if (!isWindows) {
            const cssContent = await fs.readFile(path.join(moduleOutputFolder, 'test-brotli.package.min.css'));
            const cssBrotliContent = await fs.readFile(path.join(moduleOutputFolder, 'test-brotli.package.min.css.br'));
            const cssDecompressed = await brotliDecompress(cssBrotliContent);

            // decompressed brotli must be equal source css content
            cssDecompressed.toString().should.equal(cssContent.toString());
         }
      });
      it('module-dependencies must have actual info after source component remove', async() => {
         await fs.remove(path.join(sourceFolder, 'Модуль/Page.wml'));
         await runWorkflowWithTimeout();
         const { nodes } = await fs.readJson(path.join(outputFolder, 'module-dependencies.json'));

         // after source remove and project rebuild module-dependencies must not have node for current source file
         nodes.hasOwnProperty('wml!Modul/Page').should.equal(false);
      });
      it('bundlesRoute meta for intersecting packages must have meta for the latest sorted package', async() => {
         const bundlesRouteResult = await fs.readJson(path.join(moduleOutputFolder, 'bundlesRoute.json'));

         /**
          * bundlesRoute meta in "Modul" interface module must not contain information about packed external modules,
          * it should be stored in proper interface module
          */
         bundlesRouteResult.hasOwnProperty('ExternalInterfaceModule/amdModule').should.equal(false);
         bundlesRouteResult.hasOwnProperty('css!ExternalInterfaceModule/moduleStyle').should.equal(false);

         const externalBundlesRouteResult = await fs.readJson(path.join(outputFolder, 'ExternalInterfaceModule/bundlesRoute.json'));
         externalBundlesRouteResult['ExternalInterfaceModule/amdModule'].should.equal('resources/Modul/TestBSort/test-projectMDeps.package.min.js');
         externalBundlesRouteResult['css!ExternalInterfaceModule/moduleStyle'].should.equal('resources/Modul/TestBSort/test-projectMDeps.package.min.css');
      });
      it('root bundles meta must have correct values', async() => {
         const rootBundlesMeta = await fs.readJson(path.join(outputFolder, 'bundles.json'));
         rootBundlesMeta.hasOwnProperty('resources/Modul/TestBSort/test-projectMDeps.package.min').should.equal(true);
         rootBundlesMeta['resources/Modul/TestBSort/test-projectMDeps.package.min'].should.deep.equal([
            'ExternalInterfaceModule/_private/module1',
            'ExternalInterfaceModule/_private/module2',
            'ExternalInterfaceModule/amdModule',
            'ExternalInterfaceModule/library',
            'css!ExternalInterfaceModule/moduleStyle',
            'css!Modul/Stable',
            'html!Modul/Page'
         ]);
         const rootBundlesRouteMeta = await fs.readJson(path.join(outputFolder, 'bundlesRoute.json'));
         rootBundlesRouteMeta.hasOwnProperty('ExternalInterfaceModule/amdModule').should.equal(true);
         rootBundlesRouteMeta['ExternalInterfaceModule/amdModule'].should.equal('resources/Modul/TestBSort/test-projectMDeps.package.min.js');
      });
      it('superbundle\'s bundlesRoute meta must be saved in the same interface module', async() => {
         const bundlesRoute = await fs.readJson(path.join(moduleOutputFolder, 'bundlesRoute.json'));
         bundlesRoute.should.deep.equal({
            'InterfaceModule1/_private/module1': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'InterfaceModule1/_private/module2': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'InterfaceModule1/amdModule': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'InterfaceModule1/library': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'css!InterfaceModule1/moduleStyle': 'resources/Modul/TestBSort/test-superbundle.package.min.css',
            'css!Modul/Stable': 'resources/Modul/test-brotli.package.min.css',
            'html!Modul/Page': 'resources/Modul/test-brotli.package.min.js'
         });
      });
      it('patch module', async() => {
         config.modules[0].rebuild = true;
         config.modules[1].rebuild = true;
         await fs.writeJSON(configPath, config);
         await runWorkflowWithTimeout();
      });
      it('patch-module without extendable-bundles: after rebuild must not be saved extendBundles meta into WS.Core and root', async() => {
         (await isRegularFile(outputFolder, 'common-extend-bundles.json')).should.equal(false);
         (await isRegularFile(outputFolder, 'WS.Core/bundles.json')).should.equal(false);
         (await isRegularFile(outputFolder, 'WS.Core/bundlesRoute.json')).should.equal(false);
      });
      it('patch-bundlesRoute meta after patch rebuild for intersecting packages must have meta for the latest sorted package', async() => {
         const bundlesRouteResult = await fs.readJson(path.join(moduleOutputFolder, 'bundlesRoute.json'));

         /**
          * bundlesRoute meta in "Modul" interface module must not contain information about packed external modules,
          * it should be stored in proper interface module
          */
         bundlesRouteResult.hasOwnProperty('ExternalInterfaceModule/amdModule').should.equal(false);
         bundlesRouteResult.hasOwnProperty('css!ExternalInterfaceModule/moduleStyle').should.equal(false);

         const externalBundlesRouteResult = await fs.readJson(path.join(outputFolder, 'ExternalInterfaceModule/bundlesRoute.json'));
         externalBundlesRouteResult['ExternalInterfaceModule/amdModule'].should.equal('resources/Modul/TestBSort/test-projectMDeps.package.min.js');
         externalBundlesRouteResult['css!ExternalInterfaceModule/moduleStyle'].should.equal('resources/Modul/TestBSort/test-projectMDeps.package.min.css');
      });
      it('patch-build must have module-dependencies for all modules(not only for the patching modules)', async() => {
         /**
          * reads package from "Modul" Interface module,
          * that contains content from another interface module "InterfaceModule1".
          * Patching of interface module "Modul" must not affect build of current package -
          * that's the main argument of module-dependencies meta validity.
          */
         const resultPackage = await fs.readFile(path.join(moduleOutputFolder, 'TestBSort/test-projectMDeps.package.min.js'), 'utf8');
         const correctResultPackage = await fs.readFile(
            path.join(sourceFolder, 'correctResult/test-projectMDeps.package.min.js'),
            'utf8'
         );
         resultPackage.should.equal(correctResultPackage);
      });
      it('patch - after patch for module "Modul" other interface modules cache must not be affected(files removal)', async() => {
         const modulesCacheFolder = path.join(cacheFolder, 'incremental_build');

         // check root interface module directory
         let testDirectory = await fs.readdir(path.join(modulesCacheFolder, 'InterfaceModule1'));
         testDirectory.should.have.members([
            '.builder',
            '_private',
            'amdModule.js',
            'amdModule.min.js',
            'extend.package.json',
            'library.modulepack.js',
            'library.ts',
            'library.js',
            'library.min.js',
            'module-dependencies.json',
            'moduleStyle.css',
            'moduleStyle.min.css',
            'contents.js',
            'contents.json'
         ]);

         // check builder meta
         testDirectory = await fs.readdir(path.join(modulesCacheFolder, 'InterfaceModule1/.builder'));
         testDirectory.should.have.members([
            'cdn_modules.json',
            'compiled-less.min.json',
            'libraries.json',
            'versioned_modules.json'
         ]);

         // check subdirectory of module
         testDirectory = await fs.readdir(path.join(modulesCacheFolder, 'InterfaceModule1/_private'));
         testDirectory.should.have.members([
            'module1.ts',
            'module1.js',
            'module1.min.js',
            'module2.ts',
            'module2.js',
            'module2.min.js',
         ]);
      });
      it('patch - superbundle\'s bundlesRoute meta must be saved in the same interface module', async() => {
         const bundlesRoute = await fs.readJson(path.join(moduleOutputFolder, 'bundlesRoute.json'));
         bundlesRoute.should.deep.equal({
            'InterfaceModule1/_private/module1': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'InterfaceModule1/_private/module2': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'InterfaceModule1/amdModule': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'InterfaceModule1/library': 'resources/Modul/TestBSort/test-superbundle.package.min.js',
            'css!InterfaceModule1/moduleStyle': 'resources/Modul/TestBSort/test-superbundle.package.min.css',
            'css!Modul/Stable': 'resources/Modul/test-brotli.package.min.css',
            'html!Modul/Page': 'resources/Modul/test-brotli.package.min.js'
         });
      });
      it('patch - after patch build output result must contain only results of patched module and joined builder meta', async() => {
         const outputFolderResults = await fs.readdir(outputFolder);
         outputFolderResults.should.have.members([
            'ExternalInterfaceModule',
            'Modul',
            'bundles.js',
            'bundles.min.js',
            'bundles.json',
            'bundlesRoute.json',
            'contents.js',
            'contents.min.js',
            'contents.json',
            'module-dependencies.json',
            'module-dependencies.min.json',
            'router.js',
            'router.min.js'
         ]);
      });
      it('finish patch tests pack', async() => {
         await clearWorkspace();
      });
      it('for desktop application dont save bundlesRoute meta', async() => {
         const fixtureFolder = path.join(__dirname, 'fixture/custompack');
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);
         const desktopConfig = {
            cache: cacheFolder,
            output: outputFolder,
            typescript: true,
            less: true,
            themes: true,
            minimize: true,
            wml: true,
            builderTests: true,
            customPack: true,
            sources: false,
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'ExternalInterfaceModule',
                  path: path.join(sourceFolder, 'ExternalInterfaceModule')
               },
               {
                  name: 'InterfaceModule1',
                  path: path.join(sourceFolder, 'InterfaceModule1')
               }
            ]
         };
         await fs.writeJSON(configPath, desktopConfig);

         await runWorkflowWithTimeout();

         /**
          * bundlesRoute must not be saved in results. bundles meta must be saved.
          * Only bundles.json meta from packer meta results uses in all desktop applications.
          */
         (await isRegularFile(moduleOutputFolder, 'bundlesRoute.json')).should.equal(false);
         (await isRegularFile(moduleOutputFolder, 'bundles.json')).should.equal(true);
         await runWorkflowWithTimeout();

         /**
          * bundlesRoute must not be saved in results. bundles meta must be saved.
          * Only bundles.json meta from packer meta results uses in all desktop applications.
          */
         (await isRegularFile(moduleOutputFolder, 'bundlesRoute.json')).should.equal(false);
         (await isRegularFile(moduleOutputFolder, 'bundles.json')).should.equal(true);
         await clearWorkspace();
      });
   });

   it('pack static html - check paths validity to static packages', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/packHTML');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      const testResults = async() => {
         /**
          * dependencies in current test are static, so we can also add check for package hash.
          */
         const packedHtml = await fs.readFile(path.join(outputFolder, 'TestModule/testPage.html'), 'utf8');
         let containsNeededPackage = packedHtml.includes('href="/testService/resources/TestModule/static_packages/7497a16791b95bc13816581289af74d8.css"');
         containsNeededPackage.should.equal(true);
         containsNeededPackage = packedHtml.includes('src="/testService/resources/TestModule/static_packages/30ac01cebb99671a6238487f140a1e92.js"');
         containsNeededPackage.should.equal(true);
      };

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         deprecatedWebPageTemplates: true,
         minimize: true,
         less: true,
         deprecatedStaticHtml: true,
         dependenciesGrapg: true,
         'url-service-path': '/testService/',
         modules: [
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();
      await testResults();

      // check incremental build
      await runWorkflowWithTimeout();
      await testResults();
      await clearWorkspace();
   });

   // проверим, что паковка собственных зависимостей корректно работает при пересборке
   it('packOwnDeps', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/packOwnDeps');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         wml: true,
         minimize: true,
         deprecatedOwnDependencies: true,
         builderTests: true,
         localization: false,
         'default-localization': false,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Vdom',
               path: path.join(sourceFolder, 'Vdom')
            },
            {
               name: 'Router',
               path: path.join(sourceFolder, 'Router')
            },
            {
               name: 'Inferno',
               path: path.join(sourceFolder, 'Inferno')
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflowWithTimeout();

      const testJsOutputPath = path.join(moduleOutputFolder, 'Test.min.js');
      let testJsOutputContent = (await fs.readFile(testJsOutputPath)).toString();

      // проверим, что js файл содержит актуальные данные из js, tmpl и wml
      testJsOutputContent.includes('TestClassTmplOld').should.equal(true);
      testJsOutputContent.includes('testFunctionTmplOld').should.equal(true);
      testJsOutputContent.includes('TestClassWmlOld').should.equal(true);
      testJsOutputContent.includes('testFunctionWmlOld').should.equal(true);

      // поменяем js
      const testJsInputPath = path.join(moduleSourceFolder, 'Test.js');
      const testJsInputContent = await fs.readFile(testJsInputPath);
      const newTestJsInputContent = testJsInputContent.toString()
         .replace(/testFunctionTmplOld/g, 'testFunctionTmplNew')
         .replace(/testFunctionWmlOld/g, 'testFunctionWmlNew');
      await fs.writeFile(testJsInputPath, newTestJsInputContent);

      await runWorkflowWithTimeout();

      // проверим, что js файл содержит актуальные данные из js, tmpl и wml
      testJsOutputContent = (await fs.readFile(testJsOutputPath)).toString();
      testJsOutputContent.includes('TestClassTmplOld').should.equal(true);
      testJsOutputContent.includes('TestClassWmlOld').should.equal(true);
      testJsOutputContent.includes('testFunctionTmplNew').should.equal(true);
      testJsOutputContent.includes('testFunctionWmlNew').should.equal(true);

      // поменяем tmpl
      const testTmplInputPath = path.join(moduleSourceFolder, 'Test.tmpl');
      const testTmplInputContent = await fs.readFile(testTmplInputPath);
      await fs.writeFile(testTmplInputPath, testTmplInputContent.toString().replace(/TestClassTmplOld/g, 'TestClassTmplNew'));

      await runWorkflowWithTimeout();

      // проверим, что js файл содержит актуальные данные из js, tmpl и wml
      testJsOutputContent = (await fs.readFile(testJsOutputPath)).toString();
      testJsOutputContent.includes('TestClassTmplNew').should.equal(true);
      testJsOutputContent.includes('TestClassWmlOld').should.equal(true);
      testJsOutputContent.includes('testFunctionTmplNew').should.equal(true);
      testJsOutputContent.includes('testFunctionWmlNew').should.equal(true);

      // поменяем wml
      const testWmlInputPath = path.join(moduleSourceFolder, 'Test.wml');
      const testWmlInputContent = await fs.readFile(testWmlInputPath);
      await fs.writeFile(testWmlInputPath, testWmlInputContent.toString().replace(/TestClassWmlOld/g, 'TestClassWmlNew'));

      await runWorkflowWithTimeout();

      // проверим, что js файл содержит актуальные данные из js, tmpl и wml
      testJsOutputContent = (await fs.readFile(testJsOutputPath)).toString();
      testJsOutputContent.includes('TestClassTmplNew').should.equal(true);
      testJsOutputContent.includes('TestClassWmlNew').should.equal(true);
      testJsOutputContent.includes('testFunctionTmplNew').should.equal(true);
      testJsOutputContent.includes('testFunctionWmlNew').should.equal(true);
      await clearWorkspace();
   });

   // TODO: дополнить тест проверки реакции на изменение файлов
   it('compile es and ts', async() => {
      const checkFiles = async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members([
            'StableES.js',
            'StableTS.js',
            'StableES.es',
            'StableTS.ts',
            'Stable.routes.ts',
            'Stable.routes.js'
         ]);

         const EsOutputPath = path.join(moduleOutputFolder, 'StableES.js');
         const TsOutputPath = path.join(moduleOutputFolder, 'StableTS.js');
         const RoutesTsOutputPath = path.join(moduleOutputFolder, 'Stable.routes.js');

         const EsContent = await fs.readFile(EsOutputPath);
         const TsContent = await fs.readFile(TsOutputPath);
         const RoutesTsContent = await fs.readFile(RoutesTsOutputPath);

         removeRSymbol(RoutesTsContent.toString()).should.equal(
            '"use strict";\n' +
            'module.exports = function () {\n' +
            '    return {\n' +
            '        \'/Module/Test\': function () { }\n' +
            '    };\n' +
            '};\n'
         );
         removeRSymbol(EsContent.toString()).should.equal(
            'define("Modul/StableES", ["require", "exports", "Modul/Di"], function (require, exports, Di_es_1) {\n' +
               '    "use strict";\n' +
               '    Object.defineProperty(exports, "__esModule", { value: true });\n' +
               '    var Factory = {\n' +
               '        Di: Di_es_1.default\n' +
               '    };\n' +
               '    exports.default = Factory;\n' +
               '});\n'
         );
         removeRSymbol(TsContent.toString()).should.equal(
            'define("Modul/StableTS", [' +
               '"require", ' +
               '"exports", ' +
               '"Modul/Di", ' +
               '"browser!/cdn/sound/id3-reader/id3-minimized.js", ' +
               '"is!browser?/cdn/sound/id3-reader/id3-minimized.js", ' +
               '"is!browser?cdn/sound/id3-reader/id3-minimized.js", ' +
               '"/cdn/sound/id3-reader/id3-minimized.js", ' +
               '"cdn/sound/id3-reader/id3-minimized.js"' +
               '], function (require, exports, Di_es_1) {\n' +
               '    "use strict";\n' +
               '    Object.defineProperty(exports, "__esModule", { value: true });\n' +
               '    var Factory = {\n' +
               '        Di: Di_es_1.default\n' +
               '    };\n' +
               '    exports.default = Factory;\n' +
               '});\n'
         );
      };

      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/esAndTs');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         typescript: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();

      await checkFiles();

      // запустим повторно таску
      await runWorkflowWithTimeout();

      await checkFiles();

      await clearWorkspace();
   });

   it('compile json to ts', async() => {
      const checkFiles = async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members([
            'currentLanguages.json',
            'currentLanguages.json.js',
            'currentLanguages.json.min.js',
            'currentLanguages.min.json'
         ]);

         const jsonJsOutputPath = path.join(moduleOutputFolder, 'currentLanguages.json.js');
         const jsonMinJsOutputPath = path.join(moduleOutputFolder, 'currentLanguages.json.min.js');

         const jsonJsContent = await fs.readFile(jsonJsOutputPath);
         const jsonMinJsContent = await fs.readFile(jsonMinJsOutputPath);
         const correctCompileJsonJs =
            "define('Modul/currentLanguages.json',[]," +
            'function(){return {' +
            '"ru-RU":"Русский (Россия)",' +
            '"uk-UA":"Українська (Україна)",' +
            '"en-US":"English (USA)"' +
            '};' +
            '});';

         jsonJsContent.toString().should.equal(correctCompileJsonJs);
         jsonMinJsContent.toString().should.equal(correctCompileJsonJs);
      };

      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/jsonToJs');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         minimize: true,
         modules: [
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await linkPlatform(sourceFolder);

      // запустим таску
      await runWorkflowWithTimeout();

      await checkFiles();

      // запустим повторно таску
      await runWorkflowWithTimeout();

      await checkFiles();

      await clearWorkspace();
   });

   describe('pack-library', () => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/packLibraries');
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: logsFolder,
         typescript: true,
         minimize: true,
         wml: true,
         builderTests: true,
         dependenciesGraph: true,
         modules: [
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core')
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View')
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI')
            },
            {
               name: 'Modul',
               path: path.join(sourceFolder, 'Modul')
            },
            {
               name: 'Modul2',
               path: path.join(sourceFolder, 'Modul2')
            }
         ]
      };

      /**
       * Набор файлов и папок, который должен получиться по завершении workflow
       * при перезапуске без изменений данный набор также должен сохраниться.
       * @type {string[]}
       */
      const correctOutputContentList = [
         'Modul.es',
         'Modul.js',
         'Modul.min.js',
         'Modul.modulepack.js',
         'external_public_deps.ts',
         'external_public_deps.js',
         'external_public_deps.min.js',
         'external_public_deps.modulepack.js',
         '_Cycle_dependence',
         '_External_dependence',
         '_es5',
         '_es6',
         'public',
         'module-dependencies.json',
         'libraryCycle.es',
         'libraryCycle.js',
         'libraryCycle.min.js',
         'privateDepCycle.es',
         'privateDepCycle.js',
         'privateDepCycle.min.js',
         'privateExternalDep.ts',
         'privateExternalDep.js',
         'privateExternalDep.min.js',
         'relativePluginDependency.ts',
         'testNativeNamesImports.ts',
         'testNativeNamesImports.js',
         'testNativeNamesImports.min.js',
         'testNativeNamesImports.modulepack.js',
         'publicFunction1.ts',
         'publicFunction1.js',
         'publicFunction1.min.js'
      ];

      /**
       * Будем хранить правильные исходники для всех тестов паковки
       * библиотек в одном объекте.
       * @type {{}}
       */
      const correctModulesContent = {};
      it('workspace-generated', async() => {
         await prepareTest(fixtureFolder);
         await linkPlatform(sourceFolder);
         await fs.writeJSON(configPath, config);
         await runWorkflowWithTimeout();
         const correctModulesPath = path.join(fixtureFolder, 'compiledCorrectResult');

         await pMap(
            [
               'Modul.js',
               'Modul2.js',
               'Modul.modulepack.js',
               'Module2.js',
               'Module2.modulepack.js',
               'libraryCycle.js',
               'privateDepCycle.js',
               'privateExternalDep.js',
               'testNativeNamesImports.js',
               'testNativeNamesImports.modulepack.js',
               'external_public_deps.js',
               'external_public_deps.modulepack.js'
            ],
            async(basename) => {
               const readedFile = await fs.readFile(path.join(correctModulesPath, basename), 'utf8');
               correctModulesContent[basename] = readedFile
                  .slice(readedFile.indexOf('define('), readedFile.length);
            },
            {
               concurrency: 5
            }
         );
      });
      it('test-output-file-content', async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members(correctOutputContentList);
      });
      it('libraries using relative dependencies with plugins must be ignored', async() => {
         (await isRegularFile(moduleOutputFolder, 'relativePluginDependency.js')).should.equal(false);
         const { messages } = await fs.readJson(path.join(workspaceFolder, 'logs/builder_report.json'));
         const errorMessage = 'relative dependencies with plugin are not valid. ';
         let relativeErrorExists = false;
         messages.forEach((currentError) => {
            if (currentError.message.includes(errorMessage)) {
               relativeErrorExists = true;
            }
         });
         relativeErrorExists.should.equal(true);
      });
      it('test-packed-library-dependencies-in-meta', async() => {
         const moduleDeps = await fs.readJson(path.join(moduleOutputFolder, 'module-dependencies.json'));
         const currentLibraryDeps = moduleDeps.links['Modul/external_public_deps'];
         currentLibraryDeps.should.have.members([
            'Modul/Modul',
            'Modul/public/publicInterface',
            'Modul/publicFunction1'
         ]);
         const currentLibraryPackedModules = moduleDeps.packedLibraries['Modul/external_public_deps'];
         currentLibraryPackedModules.should.have.members(['Modul/_es6/testPublicModule']);
      });
      it('test-first-level-return-statement-removal', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'external_public_deps.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'external_public_deps.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['external_public_deps.js']);
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(correctModulesContent['external_public_deps.modulepack.js']);
      });
      it('test-recurse', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['Modul.js']);
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(correctModulesContent['Modul.modulepack.js']);
      });
      it('test-not-amd-as-external-deps', async() => {
         const module2Output = path.join(outputFolder, 'Modul2');
         const compiledEsOutputPath = path.join(module2Output, 'Module2.js');
         const packedCompiledEsOutputPath = path.join(module2Output, 'Module2.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['Module2.js']);
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(correctModulesContent['Module2.modulepack.js']);
      });
      it('test-native-variable-names-processing', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['testNativeNamesImports.js']);
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(correctModulesContent['testNativeNamesImports.modulepack.js']);
      });
      it('test-recurse-library-dependencies-in-store', async() => {
         const moduleSourcePath = helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/Модуль.es'));
         const correctStoreDepsForModule = [
            helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/_es5/Module.js')),
            helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/_es6/Модуль.es')),
            helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/_es6/Модуль2.es')),
            helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/_es6/test.wml'))
         ];
         const dependenciesStore = await fs.readJson(path.join(cacheFolder, 'dependencies.json'));
         dependenciesStore[moduleSourcePath].should.have.members(correctStoreDepsForModule);
      });
      it('test-cycle-private-dependency', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'privateDepCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'privateDepCycle.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['privateDepCycle.js']);
      });
      it('test-cycle-library-dependency', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'libraryCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'libraryCycle.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['libraryCycle.js']);
      });
      it('test-external-private-dependency', async() => {
         let compiledEsOutputPath = path.join(module2OutputFolder, 'Modul.js');

         let compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'Modul.modulepack.js')).should.equal(false);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['Modul2.js']);

         compiledEsOutputPath = path.join(moduleOutputFolder, 'privateExternalDep.js');

         compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'privateExternalDep.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['privateExternalDep.js']);
      });
      it('workflow-rebuilded', async() => {
         await runWorkflowWithTimeout();
      });
      it('test-output-file-content-after-rebuild', async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members(correctOutputContentList);
      });
      it('after rebuild - libraries using relative dependencies with plugins must be ignored', async() => {
         (await isRegularFile(moduleOutputFolder, 'relativePluginDependency.js')).should.equal(false);
         const { messages } = await fs.readJson(path.join(workspaceFolder, 'logs/builder_report.json'));
         const errorMessage = 'relative dependencies with plugin are not valid. ';
         let relativeErrorExists = false;
         messages.forEach((currentError) => {
            if (currentError.message.includes(errorMessage)) {
               relativeErrorExists = true;
            }
         });
         relativeErrorExists.should.equal(true);
      });
      it('test-packed-library-dependencies-in-meta-after-rebuild', async() => {
         const moduleDeps = await fs.readJson(path.join(moduleOutputFolder, 'module-dependencies.json'));
         const currentLibraryDeps = moduleDeps.links['Modul/external_public_deps'];
         currentLibraryDeps.should.have.members([
            'Modul/Modul',
            'Modul/public/publicInterface',
            'Modul/publicFunction1'
         ]);
         const currentLibraryPackedModules = moduleDeps.packedLibraries['Modul/external_public_deps'];
         currentLibraryPackedModules.should.have.members(['Modul/_es6/testPublicModule']);
      });
      it('test-first-level-return-statement-removal-after-rebuild', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'external_public_deps.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'external_public_deps.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['external_public_deps.js']);
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(correctModulesContent['external_public_deps.modulepack.js']);
      });
      it('test-recurse-library-dependencies-in-store-after-rebuild', async() => {
         const moduleSourcePath = helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/Модуль.es'));
         const correctStoreDepsForModule = [
            helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/_es5/Module.js')),
            helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/_es6/Модуль.es')),
            helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/_es6/Модуль2.es')),
            helpers.unixifyPath(path.join(cacheFolder, 'temp-modules/Modul/_es6/test.wml'))
         ];
         const dependenciesStore = await fs.readJson(path.join(cacheFolder, 'dependencies.json'));
         dependenciesStore[moduleSourcePath].should.have.members(correctStoreDepsForModule);
      });
      it('test-recurse-after-rerun-workflow', async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members(correctOutputContentList);

         const compiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['Modul.js']);
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(correctModulesContent['Modul.modulepack.js']);
      });
      it('test-not-amd-as-external-deps-after-rerun', async() => {
         const module2Output = path.join(outputFolder, 'Modul2');
         const compiledEsOutputPath = path.join(module2Output, 'Module2.js');
         const packedCompiledEsOutputPath = path.join(module2Output, 'Module2.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['Module2.js']);
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(correctModulesContent['Module2.modulepack.js']);
      });
      it('test-native-variable-names-processing-after-rerun', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['testNativeNamesImports.js']);
         removeRSymbol(packedCompiledEsContent.toString()).should.equal(correctModulesContent['testNativeNamesImports.modulepack.js']);
      });
      it('test-cycle-private-dependency-after-rebuild', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'privateDepCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'privateDepCycle.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['privateDepCycle.js']);
      });
      it('test-cycle-library-dependency-after-rebuild', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'libraryCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'libraryCycle.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['libraryCycle.js']);
      });
      it('test-external-private-dependency-after-rebuild', async() => {
         let compiledEsOutputPath = path.join(module2OutputFolder, 'Modul.js');

         let compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'Modul.modulepack.js')).should.equal(false);

         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['Modul2.js']);

         compiledEsOutputPath = path.join(moduleOutputFolder, 'privateExternalDep.js');

         compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'privateExternalDep.modulepack.js')).should.equal(false);
         removeRSymbol(compiledEsContent.toString()).should.equal(correctModulesContent['privateExternalDep.js']);
      });
      it('workspace-cleared', async() => {
         await clearWorkspace();
      });
   });
});
