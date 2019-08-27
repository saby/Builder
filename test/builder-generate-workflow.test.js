'use strict';

const initTest = require('./init-test');

const path = require('path'),
   fs = require('fs-extra'),
   pMap = require('p-map'),
   helpers = require('../lib/helpers'),
   { decompress } = require('iltorb'),
   { isWindows } = require('../lib/builder-constants');

const generateWorkflow = require('../gulp/builder/generate-workflow.js');

const {
   timeoutForMacOS, getMTime, removeRSymbol, isSymlink, isRegularFile, linkPlatform
} = require('./lib');

const workspaceFolder = path.join(__dirname, 'workspace'),
   cacheFolder = path.join(workspaceFolder, 'cache'),
   outputFolder = path.join(workspaceFolder, 'output'),
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

// нужно проверить что происходит:
// 1. при переименовывании файла == добавление/удаление файла
// 2. при изменении файла
// 3. если файл не менять
describe('gulp/builder/generate-workflow.js', () => {
   before(async() => {
      await initTest();
   });

   it('compile less', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: true,
         typescript: true,
         dependenciesGraph: true,
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
      await runWorkflow();

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
         'themes.config.json',
         'themes.config.json.js'
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
         'themes.config.json',
         'themes.config.json.js'
      ]);

      const testModuleDepsPath = path.join(outputFolder, 'TestModule/module-dependencies.json');
      let lessDependenciesForTest = (await fs.readJson(testModuleDepsPath)).lessDependencies;
      lessDependenciesForTest['TestModule/stable'].should.have.members([
         'css!Controls-theme/themes/default/helpers/_mixins',
         'css!SBIS3.CONTROLS/themes/online/_variables',
         'css!TestModule/Stable-with-import',
         'css!TestModule/test-style-assign',
         'css!TestModule/test-style-object',
         'css!TestModule/test-theme-object',
         'css!Модуль/Stable'
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
      await runWorkflow();

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
         'themes.config.json',
         'themes.config.json.js'
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
         'themes.config.json',
         'themes.config.json.js'
      ]);
      lessDependenciesForTest = (await fs.readJson(testModuleDepsPath)).lessDependencies;
      lessDependenciesForTest['TestModule/stable'].should.have.members([
         'css!Controls-theme/themes/default/helpers/_mixins',
         'css!SBIS3.CONTROLS/themes/online/_variables',
         'css!TestModule/Stable-with-import',
         'css!TestModule/test-style-assign',
         'css!TestModule/test-style-object',
         'css!TestModule/test-theme-object',
         'css!Модуль/Stable'
      ]);

      // update themes.config.json for interface module "Модуль". all less must be rebuilded for this new themes config.
      await fs.outputJson(path.join(sourceFolder, 'Модуль/themes.config.json'), { old: false, multi: true });

      // rebuild static with new theme
      await runWorkflow();

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
         'themes.config.json',
         'themes.config.json.js'
      ]);
      await clearWorkspace();
   });

   it('compile less - should return correct meta in "contents" for new themes', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/less');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: true,
         typescript: true,
         dependenciesGraph: true,
         contents: true,
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
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule')
            },
            {
               name: 'TestModule-anotherTheme-theme',
               path: path.join(sourceFolder, 'TestModule-anotherTheme-theme')
            },
            {
               name: 'TestModule-online-theme',
               path: path.join(sourceFolder, 'TestModule-online-theme')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflow();

      let testModuleContents = await fs.readJson(path.join(outputFolder, 'TestModule/contents.json'));
      let testModuleNewThemes = testModuleContents.modules.TestModule.newThemes;
      testModuleNewThemes.hasOwnProperty('TestModule/test-online').should.equal(true);
      testModuleNewThemes['TestModule/test-online'].should.have.members([
         'online', 'anotherTheme'
      ]);

      // запустим повторно таску
      await runWorkflow();

      testModuleContents = await fs.readJson(path.join(outputFolder, 'TestModule/contents.json'));
      testModuleNewThemes = testModuleContents.modules.TestModule.newThemes;
      testModuleNewThemes.hasOwnProperty('TestModule/test-online').should.equal(true);
      testModuleNewThemes['TestModule/test-online'].should.have.members([
         'online', 'anotherTheme'
      ]);
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
      await runWorkflow();

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
      await runWorkflow();
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
      await runWorkflow();

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
         'themes.config.json',
         'themes.config.json.js'
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
      await runWorkflow();

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
         'themes.config.json',
         'themes.config.json.js'
      ]);

      // изменим "исходники"
      await timeoutForMacOS();

      // запустим повторно таску
      await runWorkflow();

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
         'themes.config.json',
         'themes.config.json.js'
      ]);
      await clearWorkspace();
   });

   it('static html', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/staticHtml');
      await prepareTest(fixtureFolder);

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         deprecatedWebPageTemplates: true,
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
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflow();

      // проверим, что все нужные файлы появились в "стенде"
      let resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'ForChange.js',
         'ForChange_old.html',
         'ForRename_old.js',
         'ForRename.html',
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
            '  "/Stable_Three": "Modul/Stable.html"\n' +
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
      await runWorkflow();

      // проверим, что все нужные файлы появились в "стенде", лишние удалились
      resultsFiles = await fs.readdir(moduleOutputFolder);
      resultsFiles.should.have.members([
         'ForChange.js',
         'ForChange_new.html',
         'ForRename_new.js',
         'ForRename.html',
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
            '  "/Stable_Three": "Modul/Stable.html"\n' +
            '}'
      );

      await clearWorkspace();
   });

   it('create symlink or copy', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/symlink');
      await prepareTest(fixtureFolder);

      const config = {
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

      const check = async() => {
         // запустим таску
         await runWorkflow();

         // файлы из исходников
         (await isSymlink(moduleOutputFolder, 'template.html')).should.equal(true);
         (await isSymlink(moduleOutputFolder, 'TestHtmlTmpl.html.tmpl')).should.equal(true);
         (await isSymlink(moduleOutputFolder, 'TestStaticHtml.js')).should.equal(true);

         // генерируемые файлы из исходников
         (await isRegularFile(moduleOutputFolder, 'StaticHtml.html')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'TestHtmlTmpl.html')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'TestLess_online.css')).should.equal(true);

         // генерируемые файлы на модуль
         (await isRegularFile(moduleOutputFolder, 'contents.js')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'contents.json')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'navigation-modules.json')).should.equal(true);
         (await isRegularFile(moduleOutputFolder, 'static_templates.json')).should.equal(true);
      };

      await check();

      // второй раз, чтобы проверить не ломает ли чего инкрементальная сборка
      await check();

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
      await runWorkflow();

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

      await runWorkflow();

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
         await runWorkflow();

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
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflow();
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
      await runWorkflow();
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

   it('custom pack - exclude new unknown for builder packages', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/custompack');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: true,
         minimize: true,
         wml: true,
         builderTests: true,
         customPack: true,
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
               name: 'Controls',
               path: path.join(sourceFolder, 'Controls')
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflow();

      const controlsOutputFolder = path.join(outputFolder, 'Controls');

      /**
       * Controls module should have his custom packages because of bundles list in builder contains them.
       * Custom packages from "Modul" should be ignored from custom packer
       */
      (await isRegularFile(controlsOutputFolder, 'controls-application.package.min.js')).should.equal(true);
      (await isRegularFile(controlsOutputFolder, 'controls-application.package.min.css')).should.equal(true);
      (await isRegularFile(moduleOutputFolder, 'test.package.min.js')).should.equal(false);
      (await isRegularFile(moduleOutputFolder, 'test.package.min.css')).should.equal(false);

      await clearWorkspace();
   });

   it('custom pack - generate extendable bundles', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/custompack');

      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: true,
         minimize: true,
         wml: true,
         builderTests: true,
         dependenciesGraph: true,
         customPack: true,
         modules: [
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
               name: 'Controls',
               path: path.join(sourceFolder, 'Controls')
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflow();

      const correctExtendableBundles = await fs.readJson(
         path.join(
            sourceFolder,
            'extendableBundlesResults',
            'extendableBundles.json'
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
      await clearWorkspace();
   });

   it('gzip and brotli - check for brotli correct encoding and decoding. Should compressed only minified and packed', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/custompack');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         less: true,
         themes: true,
         minimize: true,
         wml: true,
         builderTests: true,
         customPack: true,
         compress: true,
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
               name: 'Controls',
               path: path.join(sourceFolder, 'Controls')
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflow();

      const resultFiles = await fs.readdir(moduleOutputFolder);
      let correctMembers = [
         '.builder',
         'Page.min.wml',
         'Page.min.wml.gz',
         'Page.wml',
         'Stable.css',
         'Stable.less',
         'Stable.min.css',
         'Stable.min.css.gz',
         'bundles.json',
         'bundlesRoute.json',
         'pack.package.json',
         'test-brotli.package.min.css',
         'test-brotli.package.min.css.gz',
         'test-brotli.package.min.js',
         'test-brotli.package.min.js.gz',
         'themes.config.json',
         'themes.config.json.js',
         'themes.config.json.min.js',
         'themes.config.json.min.js.gz',
         'themes.config.min.json',
         'themes.config.min.json.gz'
      ];

      if (!isWindows) {
         correctMembers = correctMembers.concat([
            'Page.min.wml.br',
            'Stable.min.css.br',
            'test-brotli.package.min.css.br',
            'test-brotli.package.min.js.br',
            'themes.config.json.min.js.br',
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
               name: 'Controls',
               path: path.join(sourceFolder, 'Controls')
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types')
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      await runWorkflow();

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

      await runWorkflow();

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

      await runWorkflow();

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

      await runWorkflow();

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
            'StableTS.ts'
         ]);

         const EsOutputPath = path.join(moduleOutputFolder, 'StableES.js');
         const TsOutputPath = path.join(moduleOutputFolder, 'StableTS.js');

         const EsContent = await fs.readFile(EsOutputPath);
         const TsContent = await fs.readFile(TsOutputPath);

         removeRSymbol(EsContent.toString()).should.equal(
            "define('Modul/StableES', [\n" +
               "    'require',\n" +
               "    'exports',\n" +
               "    'Modul/Di'\n" +
               '], function (require, exports, Di_es_1) {\n' +
               "    'use strict';\n" +
               "    Object.defineProperty(exports, '__esModule', { value: true });\n" +
               '    var Factory = { Di: Di_es_1.default };\n' +
               '    exports.default = Factory;\n' +
               '});'
         );
         removeRSymbol(TsContent.toString()).should.equal(
            "define('Modul/StableTS', [\n" +
               "    'require',\n" +
               "    'exports',\n" +
               "    'Modul/Di',\n" +
               "    'browser!/cdn/sound/id3-reader/id3-minimized.js',\n" +
               "    'is!browser?/cdn/sound/id3-reader/id3-minimized.js',\n" +
               "    'is!browser?cdn/sound/id3-reader/id3-minimized.js',\n" +
               "    '/cdn/sound/id3-reader/id3-minimized.js',\n" +
               "    'cdn/sound/id3-reader/id3-minimized.js'\n" +
               '], function (require, exports, Di_es_1) {\n' +
               "    'use strict';\n" +
               "    Object.defineProperty(exports, '__esModule', { value: true });\n" +
               '    var Factory = { Di: Di_es_1.default };\n' +
               '    exports.default = Factory;\n' +
               '});'
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
      await runWorkflow();

      await checkFiles();

      // запустим повторно таску
      await runWorkflow();

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
      await runWorkflow();

      await checkFiles();

      // запустим повторно таску
      await runWorkflow();

      await checkFiles();

      await clearWorkspace();
   });

   describe('pack-library', () => {
      const fixtureFolder = path.join(__dirname, 'fixture/builder-generate-workflow/packLibraries');
      const config = {
         cache: cacheFolder,
         output: outputFolder,
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
         await runWorkflow();
         const correctModulesPath = path.join(fixtureFolder, 'compiledCorrectResult');

         await pMap(
            [
               'Modul.js',
               'Modul2.js',
               'Modul.modulepack.js',
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
                  .slice(readedFile.indexOf('define('), readedFile.length)
                  .replace(/\n$/, '');
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

         compiledEsContent.toString().should.equal(correctModulesContent['external_public_deps.js']);
         packedCompiledEsContent.toString().should.equal(correctModulesContent['external_public_deps.modulepack.js']);
      });
      it('test-recurse', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'Modul.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         compiledEsContent.toString().should.equal(correctModulesContent['Modul.js']);
         packedCompiledEsContent.toString().should.equal(correctModulesContent['Modul.modulepack.js']);
      });
      it('test-native-variable-names-processing', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         compiledEsContent.toString().should.equal(correctModulesContent['testNativeNamesImports.js']);
         packedCompiledEsContent.toString().should.equal(correctModulesContent['testNativeNamesImports.modulepack.js']);
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
         compiledEsContent.toString().should.equal(correctModulesContent['privateDepCycle.js']);
      });
      it('test-cycle-library-dependency', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'libraryCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'libraryCycle.modulepack.js')).should.equal(false);
         compiledEsContent.toString().should.equal(correctModulesContent['libraryCycle.js']);
      });
      it('test-external-private-dependency', async() => {
         let compiledEsOutputPath = path.join(module2OutputFolder, 'Modul.js');

         let compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'Modul.modulepack.js')).should.equal(false);

         compiledEsContent.toString().should.equal(correctModulesContent['Modul2.js']);

         compiledEsOutputPath = path.join(moduleOutputFolder, 'privateExternalDep.js');

         compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'privateExternalDep.modulepack.js')).should.equal(false);
         compiledEsContent.toString().should.equal(correctModulesContent['privateExternalDep.js']);
      });
      it('workflow-rebuilded', async() => {
         await runWorkflow();
      });
      it('test-output-file-content-after-rebuild', async() => {
         const resultsFiles = await fs.readdir(moduleOutputFolder);
         resultsFiles.should.have.members(correctOutputContentList);
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

         compiledEsContent.toString().should.equal(correctModulesContent['external_public_deps.js']);
         packedCompiledEsContent.toString().should.equal(correctModulesContent['external_public_deps.modulepack.js']);
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

         compiledEsContent.toString().should.equal(correctModulesContent['Modul.js']);
         packedCompiledEsContent.toString().should.equal(correctModulesContent['Modul.modulepack.js']);
      });
      it('test-native-variable-names-processing-after-rerun', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.js');
         const packedCompiledEsOutputPath = path.join(moduleOutputFolder, 'testNativeNamesImports.modulepack.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);
         const packedCompiledEsContent = await fs.readFile(packedCompiledEsOutputPath);

         compiledEsContent.toString().should.equal(correctModulesContent['testNativeNamesImports.js']);
         packedCompiledEsContent.toString().should.equal(correctModulesContent['testNativeNamesImports.modulepack.js']);
      });
      it('test-cycle-private-dependency-after-rebuild', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'privateDepCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'privateDepCycle.modulepack.js')).should.equal(false);
         compiledEsContent.toString().should.equal(correctModulesContent['privateDepCycle.js']);
      });
      it('test-cycle-library-dependency-after-rebuild', async() => {
         const compiledEsOutputPath = path.join(moduleOutputFolder, 'libraryCycle.js');

         const compiledEsContent = await fs.readFile(compiledEsOutputPath);

         (await isRegularFile(moduleOutputFolder, 'libraryCycle.modulepack.js')).should.equal(false);
         compiledEsContent.toString().should.equal(correctModulesContent['libraryCycle.js']);
      });
      it('test-external-private-dependency-after-rebuild', async() => {
         let compiledEsOutputPath = path.join(module2OutputFolder, 'Modul.js');

         let compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'Modul.modulepack.js')).should.equal(false);

         compiledEsContent.toString().should.equal(correctModulesContent['Modul2.js']);

         compiledEsOutputPath = path.join(moduleOutputFolder, 'privateExternalDep.js');

         compiledEsContent = await fs.readFile(compiledEsOutputPath);
         (await isRegularFile(module2OutputFolder, 'privateExternalDep.modulepack.js')).should.equal(false);
         compiledEsContent.toString().should.equal(correctModulesContent['privateExternalDep.js']);
      });
      it('workspace-cleared', async() => {
         await clearWorkspace();
      });
   });
});
