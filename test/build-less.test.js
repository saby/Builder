'use strict';

const initTest = require('./init-test');
const { parseCurrentModuleName, getThemeModifier } = require('../gulp/builder/generate-task/collect-style-themes');
const { defaultAutoprefixerOptions } = require('../lib/builder-constants');
const
   path = require('path'),
   lib = require('./lib'),
   helpers = require('../lib/helpers'),
   { resolveThemeName } = require('../lib/less/build-less'),
   {
      getCurrentImports,
      processLessFile
   } = require('../lib/less/helpers');

const workspaceFolder = helpers.prettifyPath(path.join(__dirname, 'fixture/build-less')),
   pathsForImport = [workspaceFolder],
   themes = {
      'online': {
         path: 'SBIS3.CONTROLS/themes/online',
         moduleName: 'SBIS3.CONTROLS'
      },
      'presto': {
         path: 'SBIS3.CONTROLS/themes/presto',
         name: 'presto',
         moduleName: 'SBIS3.CONTROLS'

      },
      'carry': {
         path: 'SBIS3.CONTROLS/themes/carry',
         name: 'carry',
         moduleName: 'SBIS3.CONTROLS'
      }
   };

const defaultModuleThemeObject = {
   name: 'online',
   path: themes.online.path,
   moduleName: themes.online.moduleName
};

describe('build less', () => {
   before(async() => {
      await initTest();
   });

   const gulpModulesInfo = {
      pathsForImport,
      gulpModulesPaths: {
         'SBIS3.CONTROLS': path.join(workspaceFolder, 'SBIS3.CONTROLS'),
         'Controls-default-theme': path.join(workspaceFolder, 'Controls-default-theme')
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
         path: themes[themeName].path,
         moduleName: themes[themeName].moduleName
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
         name: themeName,
         path: themes[themeName].path,
         moduleName: themes[themeName].moduleName
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
         path: themes[themeName].path,
         moduleName: themes[themeName].moduleName
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
         path: themes[themeName].path,
         moduleName: themes[themeName].moduleName
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
         path: themes[themeName].path,
         moduleName: themes[themeName].moduleName
      }, gulpModulesInfo);
      result.imports.length.should.equal(2);
      result.text.should.equal(
         ".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is online';\n}\n"
      );
   });

   it('less from CloudControls', async() => {
      const filePath = path.join(workspaceFolder, 'CloudControls/myLess.less');
      const text = ".test-selector {\ntest-mixin: 'mixin there';test-var: 'it is regular less';}";
      const result = await processLessFile(text, filePath, null, gulpModulesInfo);
      result.imports.length.should.equal(0);
      result.text.should.equal(
         ".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is regular less';\n}\n"
      );
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
   describe('get correct imports for current less', () => {
      const oldTheme = {
         path: 'path/to/default',
         name: 'default',
         isDefault: true
      };
      const oldThemeWithCustomVariables = {
         path: 'path/to/online',
         name: 'online',
         isDefault: true,
         variablesFromLessConfig: 'Controls-default-theme'
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
            '@import \'Controls-default-theme/_theme\';',
            '@import "SBIS3.CONTROLS/themes/_mixins";',
            '@themeName: default;'
         ]);
      });
      it('old theme - for theme with custom variables', () => {
         /**
          * old theme - for theme with custom variables from 'controls-default-theme'
          * should return controls-default-theme variables in imports instead of variables of current theme.
          * Actual for old theme compiling in projects, that have 2 default themes - online(old theme in SBIS3.CONTROLS)
          * and default(Controls-default-theme)
          */
         const result = getCurrentImports('path/to/some/less.less', oldThemeWithCustomVariables, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(3);
         result.should.have.members([
            '@import \'Controls-default-theme/_theme\';',
            '@import "SBIS3.CONTROLS/themes/_mixins";',
            '@themeName: online;'
         ]);
      });
      it('new theme - should return empty array', () => {
         const result = getCurrentImports('path/to/some/less.less', newTheme, gulpModulesInfo.gulpModulesPaths);
         result.length.should.equal(0);
      });
   });
});
