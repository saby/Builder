/**
 * Плагин для компиляции less.
 * @author Бегунов Ал. В.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   pMap = require('p-map'),
   helpers = require('../../../lib/helpers'),
   Vinyl = require('vinyl'),
   fs = require('fs-extra'),
   { buildLess } = require('../../../lib/build-less');

/**
 * Получаем путь до скомпиленного css в конечной директории относительно
 * корня приложения.
 * @param {Object} moduleInfo - базовая информация об Интерфейсном модуле
 * @param {String} prettyFilePath - отформатированный путь до css-файла.
 * @returns {*}
 */
function getRelativeOutput(moduleInfo, prettyFilePath) {
   const { moduleName, prettyModuleOutput } = moduleInfo;
   const relativePath = path.relative(prettyModuleOutput, prettyFilePath);
   return path.join(moduleName, relativePath).replace(/\.css$/, '.min.css');
}

/**
 * В случае отсутствия в Интерфейсном модуле конфигурации темизации less
 * файлов, генерируем базовую конфигурацию:
 * 1) Генерируем все less-ки Интерфейсного модуля по старой схеме темизации
 * 2) Не билдим все less-ки Интерфейсного модуля по новой схеме темизации
 */
function setDefaultLessConfiguration() {
   return {
      old: true,
      multi: false
   };
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @param {string[]} pathsForImport пути, в которыи less будет искать импорты. нужно для работы межмодульных импортов.
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo, gulpModulesInfo) {
   const getOutput = function(file, replacingExt) {
      const relativePath = path.relative(moduleInfo.path, file.history[0]).replace(/\.less$/, replacingExt);
      return path.join(moduleInfo.output, transliterate(relativePath));
   };
   const moduleLess = [];
   const allThemes = taskParameters.cache.currentStore.styleThemes;
   let applicationRoot = '';

   /**
    * если приложение требует в пути до статики прописать resources, будем
    * прописывать. В противном случае будем работать с путями в линках прямо от корня.
    */
   if (taskParameters.config.resourcesUrl) {
      applicationRoot = '/resources/';
   }

   /**
    * Нам надо проверять через наличие /service/ в названии сервиса, так мы сможем
    * отличить служебный сервис от названия сервиса, по которому просится статика приложения
    */
   if (!taskParameters.config.urlServicePath.includes('/service')) {
      applicationRoot = helpers.unixifyPath(
         path.join(taskParameters.config.urlServicePath, applicationRoot)
      );
   }
   const applicationRootParams = {
      applicationRoot,
      isMultiService: taskParameters.config.multiService,
      resourcesUrl: taskParameters.config.resourcesUrl
   };
   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         try {
            let isLangCss = false;

            if (moduleInfo.contents.availableLanguage) {
               const avlLang = Object.keys(moduleInfo.contents.availableLanguage);
               isLangCss = avlLang.includes(file.basename.replace('.less', ''));
               file.isLangCss = isLangCss;
            }

            if (!file.path.endsWith('.less')) {
               callback(null, file);
               return;
            }

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], getOutput(file, '.css'), moduleInfo);

               if (!isLangCss) {
                  Object.keys(allThemes).forEach((key) => {
                     taskParameters.cache.addOutputFile(file.history[0], getOutput(file, `_${key}.css`), moduleInfo);
                  });
               }

               callback(null, file);
               return;
            }
            moduleLess.push(file);
            callback(null);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: 'Ошибка builder\'а при сборе less-файлов',
               error,
               moduleInfo,
               filePath: file.history[0]
            });
         }
      },

      /* @this Stream */
      async function onFlush(callback) {
         let moduleLessConfig = taskParameters.cache.getModuleLessConfiguration(moduleInfo.name);
         if (!moduleLessConfig) {
            moduleLessConfig = setDefaultLessConfiguration();
         }
         const
            moduleName = path.basename(moduleInfo.output),
            prettyModuleOutput = helpers.prettifyPath(moduleInfo.output),
            needSaveImportLogs = taskParameters.config.logFolder && moduleLessConfig.importsLogger;

         let compiledLess = [];

         /**
          * если уже существует мета-файл по результатам предыдущей сборки, необходимо
          * прочитать его и дополнить новыми скомпилированными стилями.
          */
         if (await fs.pathExists(path.join(moduleInfo.output, '.builder/compiled-less.min.json'))) {
            compiledLess = await fs.readJson(path.join(moduleInfo.output, '.builder/compiled-less.min.json'));
         }

         /**
          * Если разработчиком в конфигурации less задан параметр для логгирования импортов для
          * компилируемого less, создаём json-лог и пишем его в директорию логов с названием соответствующего
          * Интерфейсного модуля. Если такой лог уже существует, предварительно вычитываем его и меняем набор
          * импортов изменённых less(для инкрементальной сборки).
          */
         let lessImportsLogs = {}, lessImportsLogsPath;
         if (needSaveImportLogs) {
            lessImportsLogsPath = path.join(taskParameters.config.logFolder, `less-imports-for-${moduleName}.json`);
            if (await fs.pathExists(lessImportsLogsPath)) {
               lessImportsLogs = await fs.readJson(lessImportsLogsPath);
            }
         }

         await pMap(
            moduleLess,
            async(currentLessFile) => {
               try {
                  const lessInfo = {
                     filePath: currentLessFile.history[0],
                     modulePath: moduleInfo.path,
                     text: currentLessFile.contents.toString(),
                     themes: taskParameters.config.themes,
                     moduleLessConfig
                  };
                  const results = await buildLess(
                     {
                        pool: taskParameters.pool,
                        fileSourcePath: currentLessFile.history[0],
                        moduleInfo
                     },
                     lessInfo,
                     gulpModulesInfo,
                     currentLessFile.isLangCss,
                     allThemes,
                     applicationRootParams
                  );
                  for (const result of results) {
                     if (result.ignoreMessage) {
                        logger.debug(result.ignoreMessage);
                     } else if (result.error) {
                        const errorObject = {
                           message: `Ошибка компиляции less: ${result.error}`,
                           filePath: currentLessFile.history[0],
                           moduleInfo
                        };
                        logger.error(errorObject);
                        taskParameters.cache.markFileAsFailed(currentLessFile.history[0]);
                     } else {
                        const { compiled } = result;
                        const outputPath = getOutput(currentLessFile, compiled.defaultTheme ? '.css' : `_${compiled.nameTheme}.css`);

                        /**
                         * Мета-данные о скомпилированных less нужны только во время
                         * выполнения кастомной паковки
                         */
                        if (taskParameters.config.customPack) {
                           const relativeOutput = helpers.unixifyPath(
                              getRelativeOutput(
                                 { moduleName, prettyModuleOutput },
                                 helpers.unixifyPath(outputPath)
                              )
                           );
                           compiledLess.push(relativeOutput);
                        }
                        taskParameters.cache.addOutputFile(currentLessFile.history[0], outputPath, moduleInfo);
                        taskParameters.cache.addDependencies(currentLessFile.history[0], compiled.imports);

                        const newFile = currentLessFile.clone();
                        newFile.contents = Buffer.from(compiled.text);
                        newFile.path = outputPath;
                        newFile.base = moduleInfo.output;
                        this.push(newFile);

                        if (needSaveImportLogs) {
                           lessImportsLogs[outputPath] = {
                              importedByBuilder: compiled.importedByBuilder,
                              allImports: compiled.imports
                           };
                        }
                     }
                  }
               } catch (error) {
                  taskParameters.cache.markFileAsFailed(currentLessFile.history[0]);
                  logger.error({
                     message: 'Ошибка builder\'а при компиляции less',
                     error,
                     moduleInfo,
                     filePath: currentLessFile.history[0]
                  });
               }
               this.push(currentLessFile);
            },
            {
               concurrency: 20
            }
         );
         if (taskParameters.config.customPack) {
            const jsonFile = new Vinyl({
               path: '.builder/compiled-less.min.json',
               contents: Buffer.from(JSON.stringify(compiledLess.sort(), null, 2)),
               moduleInfo
            });
            this.push(jsonFile);
         }

         if (needSaveImportLogs) {
            await fs.outputJson(lessImportsLogsPath, lessImportsLogs);
         }
         callback();
      }
   );
};
