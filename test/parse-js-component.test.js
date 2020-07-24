'use strict';

const initTest = require('./init-test');

const chai = require('chai'),
   parseJsComponent = require('../lib/parse-js-component');

const { expect } = chai;
const fs = require('fs-extra');
const path = require('path');
const removeRSymbol = function(str) {
   return str.replace(/\r/g, '');
};
const runUglifyJs = require('../lib/run-uglify-js');

describe('parse js component', () => {
   before(async() => {
      await initTest();
   });
   it('empty file', () => {
      const result = parseJsComponent('', true);
      Object.getOwnPropertyNames(result).length.should.equal(0);
   });
   it('file with error', () => {
      expect(() => {
         parseJsComponent('define(', true);
      }).to.throw('Line 1: Unexpected end of input');
   });
   it('empty module name', () => {
      const result = parseJsComponent('define(function(){});', true);
      Object.getOwnPropertyNames(result).length.should.equal(0);
   });
   it('normal module name', () => {
      const result = parseJsComponent('define("My.Module/Name", function(){});', true);
      Object.getOwnPropertyNames(result).length.should.equal(1);
      result.componentName.should.equal('My.Module/Name', true);
      result.hasOwnProperty('isNavigation').should.equal(false);
   });
   it('declare object webpage', () => {
      const result = parseJsComponent(
         'define("My.Module/Name", function(){' +
            'let module;' +
            'module.webPage = {' +
            '   htmlTemplate: "\\\\Тема Скрепка\\\\Шаблоны\\\\empty-template.html",' +
            '   title: "TestTitle",' +
            '   outFileName: "ca_stub",' +
            '   trash:"trash"' +
            '};' +
            'return module;});', true
      );
      Object.getOwnPropertyNames(result).length.should.equal(2);
      result.componentName.should.equal('My.Module/Name');
      result.hasOwnProperty('isNavigation').should.equal(false);
      const { webPage } = result;
      Object.getOwnPropertyNames(webPage).length.should.equal(3);
      webPage.htmlTemplate.should.equal('\\Тема Скрепка\\Шаблоны\\empty-template.html');
      webPage.outFileName.should.equal('ca_stub');
   });

   it('declare title and web page', () => {
      const result = parseJsComponent(
         'define("My.Module/Name", function(){' +
            'let module;' +
            'module.webPage = {' +
            '   htmlTemplate: "\\\\Тема Скрепка\\\\Шаблоны\\\\empty-template.html",' +
            '   outFileName: "ca_stub",' +
            '   trash:"trash"' +
            '};' +
            'module.title = "TestTitle";' +
            'return module;});', true
      );
      Object.getOwnPropertyNames(result).length.should.equal(2);
      result.componentName.should.equal('My.Module/Name');
      result.hasOwnProperty('isNavigation').should.equal(false);
      const { webPage } = result;
      Object.getOwnPropertyNames(webPage).length.should.equal(3);
      webPage.htmlTemplate.should.equal('\\Тема Скрепка\\Шаблоны\\empty-template.html');
      webPage.title.should.equal('TestTitle');
      webPage.outFileName.should.equal('ca_stub');
   });

   it('declare tricky web page', () => {
      const result = parseJsComponent(
         'define("My.Module/Name", function(){' +
            'let module;' +
            'module.webPage = {};' +
            'module.webPage.htmlTemplate = "\\\\Тема Скрепка\\\\Шаблоны\\\\empty-template.html";' +
            'module.webPage.title = "Пожалуйста, подождите...";' +
            'module.webPage.outFileName = "ca_stub";' +
            'return module;});', true
      );
      Object.getOwnPropertyNames(result).length.should.equal(2);
      result.componentName.should.equal('My.Module/Name');
      result.hasOwnProperty('isNavigation').should.equal(false);
      const { webPage } = result;

      // теоритически это должно работать. но мы сознательно это не поддерживаем сейчас, поэтому webPage - пустой
      Object.getOwnPropertyNames(webPage).length.should.equal(0);
   });

   it('declare webpage with custom urls', () => {
      const result = parseJsComponent(
         'define("My.Module/Name", function(){' +
            'let module;' +
            'module.webPage = {' +
            '   htmlTemplate: "\\\\Тема Скрепка\\\\Шаблоны\\\\empty-template.html",' +
            '   title: "TestTitle",' +
            '   outFileName: "ca_stub",' +
            '   trash:"trash",' +
            '   urls: ["url/one", "/urlTwo"]' +
            '};' +
            'return module;});', true
      );
      Object.getOwnPropertyNames(result).length.should.equal(2);
      result.componentName.should.equal('My.Module/Name');
      result.hasOwnProperty('isNavigation').should.equal(false);
      const { webPage } = result;
      Object.getOwnPropertyNames(webPage).length.should.equal(4);
      webPage.htmlTemplate.should.equal('\\Тема Скрепка\\Шаблоны\\empty-template.html');
      webPage.outFileName.should.equal('ca_stub');
      webPage.urls.length.should.equal(2);
      webPage.urls.should.have.members(['url/one', '/urlTwo']);
   });

   it('declare dependencies module', () => {
      const result = parseJsComponent('define("My.Module/Name", ["My.Dep/Name1", "My.Dep/Name2"], function(){});', true);
      Object.getOwnPropertyNames(result).length.should.equal(3);
      result.componentDep.should.have.members(['My.Dep/Name1', 'My.Dep/Name2']);
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(false);
   });
   it('declare dependencies module, empty name', () => {
      const result = parseJsComponent('define(["My.Dep/Name1", "My.Dep/Name2"], function(){});', true);
      Object.getOwnPropertyNames(result).length.should.equal(1);
      result.componentDep.should.have.members(['My.Dep/Name1', 'My.Dep/Name2']);
      result.hasOwnProperty('isNavigation').should.equal(false);
   });
   it('declare empty dependencies module', () => {
      const result = parseJsComponent('define("My.Module/Name", [], function(){});', true);
      Object.getOwnPropertyNames(result).length.should.equal(3);
      result.componentDep.should.have.members([]);
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(false);
   });
   it('declare empty dependencies module №2', () => {
      const result = parseJsComponent('define("My.Module/Name", function(){});', true);
      Object.getOwnPropertyNames(result).length.should.equal(1);
      result.hasOwnProperty('isNavigation').should.equal(false);
   });
   it('declare navigation', () => {
      let result = parseJsComponent('define("My.Module/Name", ["js!SBIS3.NavigationController"], function(){});');
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(true);

      result = parseJsComponent('define("My.Module/Name", ["optional!js!SBIS3.NavigationController"], function(){});');
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(true);

      result = parseJsComponent('define("My.Module/Name", ["Navigation/NavigationController"], function(){});');
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(true);

      result = parseJsComponent(
         'define("My.Module/Name", ["optional!Navigation/NavigationController"], function(){});'
      );
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(true);
   });

   describe('typescript dynamic import checker', () => {
      const moduleDirectory = path.join(__dirname, 'fixture/parse-js-component/typescript-dynamic-imports/TestModule');
      const testCommonCase = async(fileName) => {
         const text = await fs.readFile(`${moduleDirectory}/${fileName}`);
         const result = parseJsComponent(removeRSymbol(text.toString()));
         result.hasOwnProperty('patchedText').should.equal(false);
      };
      describe('should be patched in case of using require and not having it\'s own catch errors callback', () => {
         it('promise as new expession', async() => {
            const text = await fs.readFile(path.join(moduleDirectory, 'myModule.js'));
            const result = parseJsComponent(removeRSymbol(text.toString()));
            result.patchedText.should.equal("define('TestModule/myModule', [\n" +
               "    'require',\n" +
               "    'exports'\n" +
               '], function (require, exports) {\n' +
               "    'use strict';\n" +
               '    (new Promise(function (resolve_1, reject_1) {\n' +
               "        require(['module'], resolve_1, reject_1);\n" +
               '    }).then(function () {\n' +
               "        return 'first one';\n" +
               '    }).then(function () {\n' +
               "        return 'another one';\n" +
               '    }).catch(function (err) {\n' +
               '        requirejs.onError(err);\n' +
               '    }))\n' +
               '});');
            const minifiedResult = runUglifyJs('virtual.js', result.patchedText);
            minifiedResult.code.should.equal('define("TestModule/myModule",["require","exports"],function(r,e){"use strict";new Promise(function(e,n){r(["module"],e,n)}).then(function(){return"first one"}).then(function(){return"another one"}).catch(function(e){requirejs.onError(e)})});');
         });

         it('nested promises as new expession', async() => {
            const text = await fs.readFile(path.join(moduleDirectory, 'nestedDynamicImports.js'));
            const result = parseJsComponent(removeRSymbol(text.toString()));
            result.patchedText.should.equal('define(\'TestModule/test\', [\n' +
               '    \'require\',\n' +
               '    \'exports\'\n' +
               '], function (require, exports) {\n' +
               '    \'use strict\';\n' +
               '    (new Promise(function (resolve_1, reject_1) {\n' +
               '        require([\'someModuleName\'], resolve_1, reject_1);\n' +
               '    }).then(function (component) {\n' +
               '        (new Promise(function (resolve_2, reject_2) {\n' +
               '            require([\'Core/IoC\'], resolve_2, reject_2);\n' +
               '        }).then(function (IoC) {\n' +
               '            (new Promise(function (resolve_3, reject_3) {\n' +
               '                require([\'someAnotherNestedModuleName\'], resolve_3, reject_3);\n' +
               '            }).then(function (someAnotherNestedModuleName) {\n' +
               '                console.log(\'someAnotherNestedModuleName: \' + someAnotherNestedModuleName);\n' +
               '            }).catch(function (err) {\n' +
               '                requirejs.onError(err);\n' +
               '            }))\n' +
               '            IoC.resolve(\'ILogger\').error(\'EngineUser/Panel\', \'someError\');\n' +
               '        }).catch(function (err) {\n' +
               '            requirejs.onError(err);\n' +
               '        }))\n' +
               '    }).catch(function (err) {\n' +
               '        requirejs.onError(err);\n' +
               '    }))\n' +
               '});');
            const minifiedResult = runUglifyJs('virtual.js', result.patchedText);
            minifiedResult.code.should.equal('define("TestModule/test",["require","exports"],function(n,e){"use strict";new Promise(function(e,o){n(["someModuleName"],e,o)}).then(function(e){new Promise(function(e,o){n(["Core/IoC"],e,o)}).then(function(e){new Promise(function(e,o){n(["someAnotherNestedModuleName"],e,o)}).then(function(e){console.log("someAnotherNestedModuleName: "+e)}).catch(function(e){requirejs.onError(e)}),e.resolve("ILogger").error("EngineUser/Panel","someError")}).catch(function(e){requirejs.onError(e)})}).catch(function(e){requirejs.onError(e)})});');
         });
      });
      it('declared promise in variable should be ignored', async() => {
         await testCommonCase('declaredInVariable.js');
      });
      it('returned promise should be ignored', async() => {
         await testCommonCase('returnedPromise.js');
      });
      it('some random promise new expression without require should be ignored', async() => {
         await testCommonCase('someAnotherPromise.js');
      });
      it('new promise expression with custom catch callback should be ignored', async() => {
         await testCommonCase('withCustomCatch.js');
      });
   });
});
