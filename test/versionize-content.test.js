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
const { promiseWithTimeout, TimeoutError } = require('../lib/promise-with-timeout');
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
      // mac sometimes needs more than 60 seconds to build test project
      result = await promiseWithTimeout(runWorkflow(), 600000);
   } catch (err) {
      result = err;
   }
   if (result instanceof TimeoutError) {
      true.should.equal(false);
   }
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
         'someCache',
         false,
         ['SBIS3.CONTROLS']
      );
      const moduleInfoWithSpace = new ModuleInfo(
         'MyModule with space',
         'some responsible',
         'someRoot/MyModule with space',
         'someCache',
         false,
         false,
         ['View', 'SBIS3.CONTROLS', 'WS3Page']
      );
      const wscoreModuleInfo = new ModuleInfo(
         'WS.Core',
         'some responsible',
         'someRoot/WS.Core',
         'someCache',
         false,
         false,
         []
      );

      let base = path.join(__dirname, 'someRoot/MyModule');
      let filePath = path.join(__dirname, 'someRoot/MyModule/namespace1/style.css');
      let currentFile = {
         contents: 'background-image:url(/resources/SBIS3.CONTROLS/default-theme/img/ajax-loader-16x16-wheel.gif)',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('background-image:url(/resources/SBIS3.CONTROLS/default-theme/img/ajax-loader-16x16-wheel.gif?x_module=%{MODULE_VERSION_STUB=MyModule})');
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
      result.newText.should.equal('url(\'../default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_module=%{MODULE_VERSION_STUB=MyModule}\')');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // bad relative link should return versioned module, but with error
      currentFile = {
         contents: 'url(\'../../../../default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.errors.should.equal(true);

      // woff и woff2 должны правильно зарезолвиться
      currentFile = {
         contents: 'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_module=%{MODULE_VERSION_STUB=MyModule2}\')');
      result.errors.should.equal(true);
      currentFile.versioned.should.equal(true);

      // WS.Core styles should be ignored from dependencies check
      currentFile = {
         contents: 'url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, wscoreModuleInfo);
      result.newText.should.equal('url(\'../../MyModule2/default-theme/fonts/cbuc-icons/cbuc-icons.woff?x_module=%{MODULE_VERSION_STUB=MyModule2}\')');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?#iefix\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?x_module=%{MODULE_VERSION_STUB=MyModule}#iefix\')');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?test123\')',
         path: filePath,
         base
      };
      result = versionizeContent.versionizeStyles(currentFile, currentModuleInfo);
      result.newText.should.equal('url(\'fonts/TensorFont/1.0.3/TensorFont/TensorFont.eot?x_module=%{MODULE_VERSION_STUB=MyModule}#test123\')');
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

      base = path.join(__dirname, 'someRoot/MyModule with space');
      filePath = path.join(__dirname, 'someRoot/MyModule with space/namespace1/style.css');
      currentFile = {
         contents: 'background: url(img/Point.png)',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeStyles(currentFile, moduleInfoWithSpace);
      result.newText.should.equal('background: url(img/Point.png?x_module=%{MODULE_VERSION_STUB=MyModule_with_space})');
      result.errors.should.equal(false);
   });

   it('versionize templates content', () => {
      const currentModuleInfo = new ModuleInfo(
         'MyModule',
         'some responsible',
         'someRoot/MyModule',
         'someCache/MyModule',
         false,
         false,
         ['View', 'SBIS3.CONTROLS', 'WS3Page']
      );
      const wscoreModuleInfo = new ModuleInfo(
         'WS.Core',
         'some responsible',
         'someRoot/WS.Core',
         'someCache',
         false,
         false,
         []
      );

      const base = path.join(__dirname, 'someRoot/MyModule');
      const filePath = path.join(__dirname, 'someRoot/MyModule/namespace1/template.tmpl');
      let result;

      const versionedMinLink = 'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.min.js?x_module=%{MODULE_VERSION_STUB=View}">';
      let cdnSource = 'src="/cdn/jquery/3.3.1/jquery-min.js">';
      let currentFile = {
         contents: cdnSource,
         base,
         path: filePath
      };

      // проверим, чтобы игнорировался cdn для js
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
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
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal(cdnSource);
      result.errors.should.equal(false);
      false.should.equal(!!currentFile.versioned);

      // проверим, чтобы не добавлялся лишний суффикс min
      currentFile = {
         contents: 'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.min.js">',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.errors.should.equal(false);
      result.newText.should.equal(versionedMinLink);

      currentFile = {
         contents: 'src="{{item.get(image) || resourceRoot + \'SBIS3.CONTROLS/themes/online/img/defaultItem.png\'}}">',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('src="{{item.get(image) || resourceRoot + \'SBIS3.CONTROLS/themes/online/img/defaultItem.png?x_module=%{MODULE_VERSION_STUB=SBIS3.CONTROLS}\'}}">');
      result.errors.should.equal(false);

      // check for correct module in both resourceRoot
      currentFile = {
         contents: 'href="%{RESOURCE_ROOT}PrestoOrder/resources/font/Presto-icons.css"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('href="%{RESOURCE_ROOT}PrestoOrder/resources/font/Presto-icons.min.css?x_module=%{MODULE_VERSION_STUB=PrestoOrder}"');
      result.errors.should.equal(true);

      // WS.Core template should be ignored from dependencies check
      currentFile = {
         contents: 'href="%{RESOURCE_ROOT}PrestoOrder/resources/font/Presto-icons.css"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, wscoreModuleInfo, true);
      result.newText.should.equal('href="%{RESOURCE_ROOT}PrestoOrder/resources/font/Presto-icons.min.css?x_module=%{MODULE_VERSION_STUB=PrestoOrder}"');
      result.errors.should.equal(false);

      currentFile = {
         contents: '<link rel="stylesheet" href="demo-files/demo.css">',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('<link rel="stylesheet" href="demo-files/demo.min.css?x_module=%{MODULE_VERSION_STUB=MyModule}">');
      result.errors.should.equal(false);

      // в данном случае в объекте-файле должна записаться информация о версионировании
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'src="/materials/resources/SBIS3.CONTROLS/themes/online/online.css"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('src="/materials/resources/SBIS3.CONTROLS/themes/online/online.min.css?x_module=%{MODULE_VERSION_STUB=SBIS3.CONTROLS}"');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'src="/previewer/95/resources/Applications/Card/images/default-image.png"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('src="/previewer/95/resources/Applications/Card/images/default-image.png?x_module=%{MODULE_VERSION_STUB=Applications}"');
      result.errors.should.equal(true);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'src="/previewer/resources/Applications/Card/images/default-image.png"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('src="/previewer/resources/Applications/Card/images/default-image.png?x_module=%{MODULE_VERSION_STUB=Applications}"');
      result.errors.should.equal(true);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: 'src="../build/pdf.min.js"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('src="../build/pdf.min.js?x_module=%{MODULE_VERSION_STUB=MyModule}"');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // проверим, чтобы добавлялся суффикс min, если он отсутствует
      currentFile = {
         contents: 'src="{{ _options.resourceRoot }}View/Runner/Vdom/third-party/boomerang-1.568.0.js">',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal(versionedMinLink);
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // проверим версионирование рядовых шрифтов
      currentFile = {
         contents: '<link href="{{resourceRoot}}Controls-default-theme/fonts/cbuc-icons/cbuc-icons.woff2"/>',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('<link href="{{resourceRoot}}Controls-default-theme/fonts/cbuc-icons/cbuc-icons.woff2?x_module=%{MODULE_VERSION_STUB=Controls-default-theme}"/>');
      result.errors.should.equal(true);
      currentFile.versioned.should.equal(true);

      currentFile = {
         contents: '<link href="{{=it.resourceRoot}}WS3Page/Templates/css/graytheme.css"/>',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('<link href="{{=it.resourceRoot}}WS3Page/Templates/css/graytheme.min.css?x_module=%{MODULE_VERSION_STUB=WS3Page}"/>');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // проверим что под регулярку не попадают свойства обьектов
      const testSpanFromTemplate = '<span class="edo-TaskCol-date-number-mark-dot icon-16 icon-{{item[\'colorMarkState\'].icon}}"';
      currentFile = {
         contents: testSpanFromTemplate
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal(testSpanFromTemplate);
      result.errors.should.equal(false);
      false.should.equal(!!currentFile.versioned);

      // check an existence of "buildNumber" placeholder in "contents" url for multi-service application
      currentFile = {
         contents: 'src="/materials/resources/contents.js"',
         base,
         path: filePath
      };
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, true, 'test-version');
      result.newText.should.equal('src="/materials/resources/contents.min.js?x_module=%{BUILD_NUMBER}"');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);

      // there should be a strict build number to be written into "contents" url for single-service application
      result = versionizeContent.versionizeTemplates(currentFile, currentModuleInfo, false, 'test-version');
      result.newText.should.equal('src="/materials/resources/contents.min.js?x_module=test-version"');
      result.errors.should.equal(false);
      currentFile.versioned.should.equal(true);
   });

   it('should versionize only compiled and minified files', async() => {
      const fixtureFolder = path.join(__dirname, 'fixture/versionize-finish');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {

         // eslint-disable-next-line id-match
         cld_name: 'builder-tests',
         cache: cacheFolder,
         output: outputFolder,
         wml: true,
         minimize: true,
         version: 'test',
         'multi-service': true,
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
            }
         ]
      };
      await fs.writeJSON(configPath, config);

      // запустим таску
      await runWorkflowWithTimeout();
      (await isRegularFile(outputFolder, 'Modul/Page.wml')).should.equal(true);
      (await isRegularFile(outputFolder, 'Modul/Page.min.wml')).should.equal(true);
      const templateSourceContent = (await fs.readFile(path.join(outputFolder, 'Modul/Page.wml'))).toString();
      const templateCompiledContent = (await fs.readFile(path.join(outputFolder, 'Modul/Page.min.wml'))).toString();

      // проверим, что в исходниках ссылки остались прежними, а в скомпилированном появилась версия и суффикс min
      const templateSourceNotChanged = templateSourceContent.includes('contents.js"') &&
         templateSourceContent.includes('require-min.js"') &&
         templateSourceContent.includes('bundles.js"') &&
         templateSourceContent.includes('src="{{item.get(image) ? item.get(image) : \'/resources/SBIS3.CONTROLS/themes/online/img/defaultFolder.png\'}}" />');
      templateSourceNotChanged.should.equal(true);
      const templateCompiledChanged = templateCompiledContent.includes('contents.min.js?x_module=%{BUILD_NUMBER}') &&
         templateCompiledContent.includes('config.min.js?x_module=%{MODULE_VERSION_STUB=WS.Core}"') &&
         templateCompiledContent.includes('"/cdn/requirejs/2.3.5-p3/require-min.js"');
      templateCompiledChanged.should.equal(true);

      const styleSourceContent = (await fs.readFile(path.join(outputFolder, 'Modul/cbuc-icons.css'))).toString();
      const styleCompiledContent = (await fs.readFile(path.join(outputFolder, 'Modul/cbuc-icons.min.css'))).toString();

      // проверим, что в исходниках ссылки остались прежними, а в скомпилированном появилась версия и суффикс min
      const styleSourceNotChanged = styleSourceContent.includes("url('cbuc-icons/cbuc-icons.eot#iefix')") &&
         styleSourceContent.includes("url('cbuc-icons/cbuc-icons.woff2')");
      styleSourceNotChanged.should.equal(true);
      const styleCompiledChanged = styleCompiledContent.includes('url(cbuc-icons/cbuc-icons.eot?x_module=%{MODULE_VERSION_STUB=Modul}#iefix)') &&
         styleCompiledContent.includes('url(cbuc-icons/cbuc-icons.woff2?x_module=%{MODULE_VERSION_STUB=Modul})');
      styleCompiledChanged.should.equal(true);
      await clearWorkspace();
   });
});
