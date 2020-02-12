'use strict';

const initTest = require('./init-test');

const chai = require('chai'),
   path = require('path'),
   fs = require('fs-extra'),
   lib = require('./lib'),
   helpers = require('../lib/helpers'),
   workerPool = require('workerpool'),
   builderConstants = require('../lib/builder-constants');

const { expect } = chai;

const workspaceFolder = path.join(__dirname, 'workspace'),
   fixtureFolder = path.join(__dirname, 'fixture/build-worker'),
   workerPath = path.join(__dirname, '../gulp/common/worker.js'),
   execInPool = require('../gulp/common/exec-in-pool'),
   modulePath = helpers.prettifyPath(path.join(workspaceFolder, 'AnyModule')),
   sbis3ControlsPath = path.join(workspaceFolder, 'SBIS3.CONTROLS'),
   themes = {
      'online': {
         path: path.join(workspaceFolder, 'SBIS3.CONTROLS/themes/online')
      },
      'presto': {
         path: path.join(workspaceFolder, 'SBIS3.CONTROLS/themes/presto')
      },
      'carry': {
         path: path.join(workspaceFolder, 'SBIS3.CONTROLS/themes/carry')
      }
   };

const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};

const prepareTest = async function() {
   await clearWorkspace();
   await fs.ensureDir(workspaceFolder);
   await fs.copy(fixtureFolder, workspaceFolder);
};

describe('gulp/common/worker.js', () => {
   before(async() => {
      await initTest();
   });

   it('тест с минимально допустимыми входными данными', async() => {
      const pool = workerPool.pool(workerPath);

      try {
         await prepareTest();

         const [, resultParseJsComponent] = await execInPool(pool, 'parseJsComponent', ['', true]);
         Object.keys(resultParseJsComponent).length.should.equal(0);

         const [, resultParseRoutes] = await execInPool(pool, 'parseRoutes', ['', true]);
         Object.keys(resultParseRoutes).length.should.equal(0);

         const filePath = helpers.prettifyPath(path.join(modulePath, 'Empty.less'));
         const text = (await fs.readFile(filePath)).toString();
         const gulpModulesInfo = {
            pathsForImport: [workspaceFolder],
            gulpModulesPaths: {
               'SBIS3.CONTROLS': sbis3ControlsPath
            }
         };
         const lessInfo = {
            filePath,
            modulePath,
            text,
            themes,
            moduleLessConfig: { old: true, multi: false },
            multiThemes: {},
            newThemes: {},
            autoprefixerOptions: builderConstants.defaultAutoprefixerOptions
         };
         const [, resultsBuildLess] = await execInPool(pool, 'buildLess', [
            lessInfo,
            gulpModulesInfo,
            false,
            themes
         ]);
         resultsBuildLess[0].compiled.hasOwnProperty('imports').should.equal(true);
         resultsBuildLess[0].compiled.hasOwnProperty('text').should.equal(true);
         resultsBuildLess[0].compiled.imports.length.should.equal(2);
         resultsBuildLess[0].compiled.text.should.equal('');
      } finally {
         await clearWorkspace();
         await pool.terminate();
      }
   });
   it('тест с обычными входными данными', async() => {
      const pool = workerPool.pool(workerPath);

      try {
         await prepareTest();

         const textForParseJsComponent = 'define("My.Module/Name", function(){});';
         const [, resultParseJsComponent] = await execInPool(pool, 'parseJsComponent', [textForParseJsComponent, true]);
         Object.keys(resultParseJsComponent).length.should.equal(1);
         resultParseJsComponent.componentName.should.equal('My.Module/Name');

         const textForParseRoutes =
            'module.exports = function() {\n' +
            '   return {\n' +
            "      '/test_1.html': 'js!SBIS3.Test1'\n" +
            '   };\n' +
            '};\n';
         const [, resultParseRoutes] = await execInPool(pool, 'parseRoutes', [textForParseRoutes, true]);
         Object.getOwnPropertyNames(resultParseRoutes).length.should.equal(1);
         Object.getOwnPropertyNames(resultParseRoutes['/test_1.html']).length.should.equal(1);
         resultParseRoutes['/test_1.html'].controller.should.equal('js!SBIS3.Test1');

         const filePath = path.join(modulePath, 'Correct.less');
         const text = (await fs.readFile(filePath)).toString();
         const gulpModulesInfo = {
            pathsForImport: [workspaceFolder],
            gulpModulesPaths: {
               'SBIS3.CONTROLS': sbis3ControlsPath
            }
         };
         const lessInfo = {
            filePath,
            modulePath,
            text,
            themes,
            moduleLessConfig: { old: true, multi: false },
            multiThemes: {},
            newThemes: {},
            autoprefixerOptions: builderConstants.defaultAutoprefixerOptions
         };
         const [, resultsBuildLess] = await execInPool(pool, 'buildLess', [
            lessInfo,
            gulpModulesInfo,
            false,
            themes
         ]);
         resultsBuildLess[0].compiled.hasOwnProperty('imports').should.equal(true);
         resultsBuildLess[0].compiled.hasOwnProperty('text').should.equal(true);
         resultsBuildLess[0].compiled.imports.length.should.equal(2);
         resultsBuildLess[0].compiled.text.should.equal(
            ".test-selector {\n  test-mixin: 'mixin there';\n  test-var: 'it is online';\n}\n"
         );
      } finally {
         await clearWorkspace();
         await pool.terminate();
      }
   });
   it('тест корректности возвращаемых ошибок', async() => {
      const pool = workerPool.pool(workerPath);

      try {
         await prepareTest();
         let error;
         [error] = await execInPool(pool, 'parseJsComponent', ['define(']);
         expect(error).to.have.property('message', 'Ошибка при парсинге: Error: Line 1: Unexpected end of input');

         [error] = await execInPool(pool, 'parseRoutes', ['define(']);
         expect(error).to.have.property('message', 'Ошибка при парсинге: Error: Line 1: Unexpected end of input');

         const filePath = helpers.prettifyPath(path.join(modulePath, 'Error.less'));
         const text = (await fs.readFile(filePath)).toString();
         const gulpModulesInfo = {
            pathsForImport: [],
            gulpModulesPaths: {
               'SBIS3.CONTROLS': sbis3ControlsPath
            }
         };
         const lessInfo = {
            filePath,
            modulePath,
            text,
            themes,
            moduleLessConfig: { old: true, multi: false },
            multiThemes: {},
            newThemes: {},
            autoprefixerOptions: builderConstants.defaultAutoprefixerOptions
         };
         const [, lessResult] = await execInPool(pool, 'buildLess', [
            lessInfo,
            gulpModulesInfo,
            false,
            themes
         ]);

         // заменяем слеши, иначе не сравнить на linux и windows одинаково
         const errorMessage = lib.trimLessError(lessResult[0].error.replace(/\\/g, '/'));
         errorMessage.should.equal(" in line 1: 'notExist' wasn't found.");
      } finally {
         await clearWorkspace();
         await pool.terminate();
      }
   });
});
