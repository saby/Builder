'use strict';

const initTest = require('./init-test');
const { parseCurrentModuleName, getThemeModifier } = require('../gulp/builder/generate-task/collect-style-themes');
const { getMultiThemesList, checkForNewThemeType } = require('../gulp/builder/plugins/compile-less');
const { defaultAutoprefixerOptions } = require('../lib/builder-constants');
const
   path = require('path'),
   lib = require('./lib'),
   helpers = require('../lib/helpers'),
   { resolveThemeName } = require('../lib/less/build-less'),
   {
      getThemeImport,
      getCurrentImports,
      processLessFile
   } = require('../lib/less/helpers');

const workspaceFolder = helpers.prettifyPath(path.join(__dirname, 'fixture/build-less')),
   pathsForImport = [workspaceFolder],
   themes = {
      'online': path.join(workspaceFolder, 'SBIS3.CONTROLS/themes/online'),
      'presto': path.join(workspaceFolder, 'SBIS3.CONTROLS/themes/presto'),
      'carry': path.join(workspaceFolder, 'SBIS3.CONTROLS/themes/carry')
   };

const defaultModuleThemeObject = {
   name: 'online',
   path: themes.online,
   isDefault: true
};

describe('build less', () => {
   before(async() => {
      await initTest();
   });

   const gulpModulesInfo = {
      pathsForImport,
      gulpModulesPaths: {
         'SBIS3.CONTROLS': path.join(workspaceFolder, 'SBIS3.CONTROLS')
      }
   };
   it('empty less', async() => {
      const filePath = helpers.prettifyPath(path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less'));
      const text = '';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal('');
   });
   it('theme less', async() => {
      const filePath = helpers.prettifyPath(path.join(workspaceFolder, 'SBIS3.CONTROLS/themes/online/online.less'));
      const text = '';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo, {});

      // compiled theme less must not have any imports
      result.imports.length.should.equal(0);
      result.text.should.equal('');
   });
   it('less with hex-rgba', async() => {
      const filePath = helpers.prettifyPath(path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less'));
      const text = '.test { box-shadow: 0 4px 24px #d2e2f3e0; }';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal('.test {\n' +
         '  box-shadow: 0 4px 24px #d2e2f3e0;\n' +
         '}\n');
   });
   it('less with defau`lt theme', async() => {
      const filePath = path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less');
      const text = '.test-selector {\ntest-mixin: @test-mixin;test-var: @test-var;}';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal(".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is online';\n}\n");
   });
   it('less with grids: correctly added prefixes', async() => {
      const filePath = path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less');
      const text = '.test-prefixes {\n' +
         '      display: grid;\n' +
         '      grid-template-columns: 1fr 1fr;\n' +
         '      grid-template-rows: auto;\n' +
         '}';
      const result = await processLessFile(
         text,
         filePath,
         defaultModuleThemeObject,
         gulpModulesInfo,
         defaultAutoprefixerOptions
      );
      result.imports.length.should.equal(2);
      result.text.should.equal(
         '.test-prefixes {\n' +
         '  display: -ms-grid;\n' +
         '  display: grid;\n' +
         '  -ms-grid-columns: 1fr 1fr;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  -ms-grid-rows: auto;\n' +
         '  grid-template-rows: auto;\n' +
         '}\n'
      );
   });
   it('less with grids: without prefixes if autoprefixer disabled', async() => {
      const filePath = path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less');
      const text = '.test-prefixes {\n' +
         '      display: grid;\n' +
         '      grid-template-columns: 1fr 1fr;\n' +
         '      grid-template-rows: auto;\n' +
         '}';
      const result = await processLessFile(text, filePath, defaultModuleThemeObject, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal(
         '.test-prefixes {\n' +
         '  display: grid;\n' +
         '  grid-template-columns: 1fr 1fr;\n' +
         '  grid-template-rows: auto;\n' +
         '}\n'
      );
   });
   it('less from retail', async() => {
      const retailModulePath = helpers.prettifyPath(path.join(workspaceFolder, 'Retail'));
      const filePath = helpers.prettifyPath(path.join(retailModulePath, 'bla/bla/long/path/test.less'));
      const text = '.test-selector {\ntest-mixin: @test-mixin;test-var: @test-var;}';
      const themeName = resolveThemeName(filePath, retailModulePath);
      const result = await processLessFile(text, filePath, {
         name: themeName,
         path: themes[themeName]
      }, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal(".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is carry';\n}\n");
   });
   it('less from retail with presto theme', async() => {
      const retailModulePath = helpers.prettifyPath(path.join(workspaceFolder, 'Retail'));
      const filePath = helpers.prettifyPath(path.join(retailModulePath, 'themes/presto/test.less'));
      const text = '.test-selector {\ntest-mixin: @test-mixin;test-var: @test-var;}';
      const themeName = resolveThemeName(filePath, retailModulePath);
      const result = await processLessFile(text, filePath, {
         name: 'presto',
         path: themes[themeName]
      }, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal(".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is presto';\n}\n");
   });
   it('Button less from SBIS3.CONTROLS', async() => {
      const filePath = helpers.prettifyPath(path.join(workspaceFolder, 'SBIS3.CONTROLS/Button/Button.less'));
      const text = '.test-selector {\ntest-mixin: @test-mixin;test-var: @test-var;}';
      const themeName = resolveThemeName(filePath, filePath);
      const result = await processLessFile(text, filePath, {
         name: themeName,
         path: themes[themeName]
      }, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal(".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is online';\n}\n");
   });

   // важно отобразить корректно строку в которой ошибка
   it('less with import error', async() => {
      const filePath = helpers.prettifyPath(path.join(workspaceFolder, 'AnyModule/bla/bla/long/path/test.less'));
      const text = '@import "notExist";';
      const themeName = resolveThemeName(filePath, filePath);
      const result = await processLessFile(text, filePath, {
         name: themeName,
         path: themes[themeName]
      }, gulpModulesInfo);
      const errorMessage = result.error.replace(/\\/g, '/');
      return lib
         .trimLessError(errorMessage)
         .should.equal(" in line 1: 'notExist' wasn't found.");
   });

   it('less from WS.Deprecated', async() => {
      const filePath = path.join(workspaceFolder, 'WS.Deprecated/Controls/TabControl/TabControl.less');
      const text = '.test-selector {\ntest-mixin: @test-mixin;test-var: @test-var;}';
      const themeName = resolveThemeName(filePath, filePath);
      const result = await processLessFile(text, filePath, {
         name: themeName,
         path: themes[themeName]
      }, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal(
         ".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is online';\n}\n"
      );
   });

   it('get correct variables import', () => {
      let result = getThemeImport({
         name: 'online',
         path: 'SBIS3.CONTROLS/themes/online'
      });
      result.should.equal('@import \'SBIS3.CONTROLS/themes/online/_variables\';');
      result = getThemeImport({
         name: 'carry'
      });
      result.should.equal('');
   });

   it("get correct base info for new theme's interface module", () => {
      const modulesList = new Set(['Controls', 'Controls-myModule']);
      let result = parseCurrentModuleName(modulesList, ['Controls', 'online']);
      result.themeName.should.equal('online');
      result.moduleName.should.equal('Controls');
      result = parseCurrentModuleName(modulesList, ['Controls', 'myModule', 'online', 'default']);
      result.themeName.should.equal('online-default');
      result.moduleName.should.equal('Controls-myModule');
   });
   it('get correct theme modifier for current path', () => {
      const root = 'path/to/root/';
      const rootThemePath = 'path/to/root/_theme.less';
      const darkMThemePath = 'path/to/root/dark/medium/_theme.less';
      const darkLThemePath = 'path/to/root/dark-large/_theme.less';
      let result = getThemeModifier(root, rootThemePath);
      result.should.equal('');
      result = getThemeModifier(root, darkMThemePath);
      result.should.equal('dark/medium');
      result = getThemeModifier(root, darkLThemePath);
      result.should.equal('dark-large');
   });
   it('get correct list of multi themes', () => {
      const multiThemes = {
         myTheme: {
            path: 'path/to/myTheme'
         },
         myAnotherTheme: {
            path: 'path/to/myAnotherTheme'
         }
      };
      const allThemes = {
         'TestModule-online-theme': {
            type: 'new',
            moduleName: 'TestModule',
            themeName: 'online'
         },
         ...multiThemes
      };
      const result = getMultiThemesList(allThemes, true);
      result.should.deep.equal(multiThemes);
   });
   it('check theme for new type', () => {
      const multiTheme = {
         path: 'path/to/myTheme'
      };
      const newTheme = {
         type: 'new',
         moduleName: 'TestModule',
         themeName: 'online'
      };
      checkForNewThemeType(multiTheme).should.equal(false);
      checkForNewThemeType(newTheme).should.equal(true);
   });
   describe('get correct imports for current less', () => {
      const oldTheme = {
         path: 'path/to/default',
         name: 'default',
         isDefault: true
      };
      const multiTheme = {
         path: 'path/to/myTheme',
         name: 'myTheme'
      };
      const oldThemeWithoutPath = {
         name: 'default',
         isDefault: true
      };
      const newTheme = {
         type: 'new',
         moduleName: 'TestModule',
         themeName: 'online'
      };
      it('old theme - for theme less building should return empty array', () => {
         const result = getCurrentImports('path/to/default/default.less', oldTheme, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(0);
      });
      it('old theme - for theme with path should return correct imports list', () => {
         const result = getCurrentImports('path/to/some/less.less', oldTheme, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(3);
         result.should.have.members([
            '@import \'path/to/default/default\';',
            '@import \'SBIS3.CONTROLS/themes/_mixins\';',
            '@themeName: default;'
         ]);
      });
      it('old theme - for theme without path should return correct imports list without errors', () => {
         const result = getCurrentImports('path/to/some/less.less', oldThemeWithoutPath, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(2);
         result.should.have.members([
            '@import \'SBIS3.CONTROLS/themes/_mixins\';',
            '@themeName: default;'
         ]);
      });
      it('multi theme - should return correct imports list', () => {
         const result = getCurrentImports('path/to/some/less.less', multiTheme, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(3);
         result.should.have.members([
            '@import \'path/to/myTheme/myTheme\';',
            '@import \'SBIS3.CONTROLS/themes/_mixins\';',
            '@themeName: myTheme;'
         ]);
      });
      it('new theme - should return empty array', () => {
         const result = getCurrentImports('path/to/some/less.less', newTheme, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(0);
      });
   });
});
