'use strict';

const path = require('path');
const initTest = require('./init-test');
const versionizeContent = require('../lib/versionize-content');
const fs = require('fs-extra');
const workspaceFolder = path.join(__dirname, 'workspace');
const cacheFolder = path.join(workspaceFolder, 'cache');
const outputFolder = path.join(workspaceFolder, 'output');
const sourceFolder = path.join(workspaceFolder, 'source');
const configPath = path.join(workspaceFolder, 'config.json');
const ModuleInfo = require('../gulp/builder/classes/module-info');
const generateWorkflow = require('../gulp/builder/generate-workflow.js');
const {
   isRegularFile, linkPlatform
} = require('./lib');

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

describe('versionize-content', () => {
   before(async() => {
      await initTest();
   });

   it('versionize style content', () => {
      let result;
      const currentModuleInfo = new ModuleInfo(
         'MyModule',
         'some responsible',
         'someRoot/MyModule',
         'someCache/MyModule',
         false,
         ['SBIS3.CONTROLS']);
      const base = path.join(__dirname, 'someRoot/MyModule');
      const filePath = path.join(__dirname, 'someRoot/MyModule/namespace1/style.css');
      let currentFile = {
         contents: 'background-image:url(/resources/SBIS3.CONTROLS/default-theme/img/ajax-loader-16x16-wheel.gif)',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('background-image:url(/resources/SBIS3.CONTROLS/default-theme/img/ajax-loader-16x16-wheel.gif?x_version=%{MODULE_VERSION_STUB=MyModule})');
      result.errors.should.equal(false);

      // проверим, что информация о версионировании прокидывается в файл
      currentFile.versioned.should.equal(true);

      // woff и woff2 должны правильно зарезолвиться
      currentFile = {
         contents: 'url(\'../default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('url(\'../default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_version=%{MODULE_VERSION_STUB=MyModule}\')');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // woff и woff2 должны правильно зарезолвиться
      currentFile = {
         contents: 'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_version=%{MODULE_VERSION_STUB=MyModule2}\')');
      result.errors.should.equal(true);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?#iefix\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?x_version=%{MODULE_VERSION_STUB=MyModule}#iefix\')');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?test123\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?x_version=%{MODULE_VERSION_STUB=MyModule}#test123\')');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // Проверим, чтобы игнорировался cdn
      const cdnData = 'src: url(\'/cdn/fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?#iefix\') format(\'embedded-opentype\')';
      currentFile = {
         contents: cdnData,
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal(cdnData);
      result.errors.should.equal(false);

      // Проверим, чтобы проигнорированный версионированием файл содержал правильную инфу о версии
      false.should.equal(!!currentFile.versioned);
   });

   it('versionize templates content', () => {
      const currentModuleInfo = new ModuleInfo(
         'MyModule',
         'some responsible',
         'someRoot/MyModule',
         'someCache/MyModule',
         false,
         ['View', 'SBIS3.CONTROLS']
      );
      const base = path.join(__dirname, 'someRoot/MyModule');
      const filePath = path.join(__dirname, 'someRoot/MyModule/namespace1/template.tmpl');
      let result;

      const versionedMinLink = 'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.min.js?x_version=%{MODULE_VERSION_STUB=View}">';
      let cdnSource = 'src="/cdn/jquery/3.3.1/jquery-min.js">';
      let currentFile = {
         contents: cdnSource,
         base,
         path: filePath
      };

      // проверим, чтобы игнорировался cdn для js
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.newText.should.equal(cdnSource);
      result.errors.should.equal(false);

      // проверим, чтобы не было информации о версионировании в объекте-файле
      false.should.equal(!!currentFile.versioned);

      cdnSource = '<link rel="preload" as="font" href="/cdn/fonts/TensorFont/1.0.3/TensorFontBold/TensorFontBold.woff2" type="font/woff2"/>';
      currentFile = {
         contents: cdnSource,
         base,
         path: filePath
      };

      // проверим, чтобы игнорировался cdn для шрифтов
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.newText.should.equal(cdnSource);
      result.errors.should.equal(false);
      false.should.equal(!!currentFile.versioned);

      // проверим, чтобы не добавлялся лишний суффикс min
      currentFile = {
         contents: 'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.min.js">',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.errors.should.equal(false);
      result.newText.should.equal(versionedMinLink);

      currentFile = {
         contents: 'src="{{item.get(image) || resourceRoot + \'SBIS3.CONTROLS/themes/online/img/defaultItem.png\'}}">',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.newText.should.equal('src="{{item.get(image) || resourceRoot + \'SBIS3.CONTROLS/themes/online/img/defaultItem.png?x_version=%{MODULE_VERSION_STUB=SBIS3.CONTROLS}\'}}">');
      result.errors.should.equal(false);

      // в данном случае в объекте-файле должна записаться информация о версионировании
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'src="/materials/resources/SBIS3.CONTROLS/themes/online/online.css"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.newText.should.equal('src="/materials/resources/SBIS3.CONTROLS/themes/online/online.min.css?x_version=%{MODULE_VERSION_STUB=SBIS3.CONTROLS}"');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'src="/materials/resources/contents.js"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.newText.should.equal('src="/materials/resources/contents.min.js?x_version=%{MODULE_VERSION_STUB=MyModule}"');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // проверим, чтобы добавлялся суффикс min, если он отсутствует
      currentFile = {
         contents: 'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.js">',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.newText.should.equal(versionedMinLink);
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // проверим версионирование рядовых шрифтов
      currentFile = {
         contents: '<link href="{{resourceRoot}}Controls-theme/themes/default/fonts/cbuc-icons/cbuc-icons.woff2"/>',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.newText.should.equal('<link href="{{resourceRoot}}Controls-theme/themes/default/fonts/cbuc-icons/cbuc-icons.woff2?x_version=%{MODULE_VERSION_STUB=Controls-theme}"/>');
      result.errors.should.equal(true);
      currentFile.versioned.should.equal(true);

      // проверим что под регулярку не попадают свойства обьектов
      const testSpanFromTemplate = '<span class="edo-TaskCol-date-number-mark-dot icon-16 icon-{{item[\'colorMarkState\'].icon}}"';
      currentFile = {
         contents: testSpanFromTemplate
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo);
      result.newText.should.equal(testSpanFromTemplate);
      result.errors.should.equal(false);
      false.should.equal(!!currentFile.versioned);
   });

   it('should versionize only compiled and minified files', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/versionize-finish');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         wml: true,
         minimize: true,
         version: 'test',
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
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflow();
      (await isRegularFile(outputFolder, 'Modul/Page.wml')).should.equal(true);
      (await isRegularFile(outputFolder, 'Modul/Page.min.wml')).should.equal(true);
      const sourceContent = (await fs.readFile(path.join(outputFolder, 'Modul/Page.wml'))).toString();
      const compiledContent = (await fs.readFile(path.join(outputFolder, 'Modul/Page.min.wml'))).toString();

      // проверим, что в исходниках ссылки остались прежними, а в скомпилированном появилась версия и суффикс min
      const sourceNotChanged = sourceContent.includes('contents.js') &&
         sourceContent.includes('require-min.js') &&
         sourceContent.includes('bundles.js');
      sourceNotChanged.should.equal(true);
      const compiledChanged = compiledContent.includes('contents.min.js?x_version=%{MODULE_VERSION_STUB=Modul}') &&
         compiledContent.includes('bundles.min.js?x_version=%{MODULE_VERSION_STUB=WS.Core}') &&
         compiledContent.includes('require-min.js') &&
         !compiledContent.includes('require-min.js?x_version=%{MODULE_VERSION_STUB=Modul}');
      compiledChanged.should.equal(true);
   });
});
