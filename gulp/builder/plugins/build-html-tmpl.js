/**
 * Плагин для генерации статических html по *.html.tmpl файлам.
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   Vinyl = require('vinyl'),
   path = require('path'),
   transliterate = require('../../../lib/transliterate'),
   helpers = require('../../../lib/helpers'),
   logger = require('../../../lib/logger').logger(),
   execInPool = require('../../common/exec-in-pool');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const componentsPropertiesFilePath = path.join(taskParameters.config.cachePath, 'components-properties.json');

   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (!file.path.endsWith('.html.tmpl')) {
               callback(null, file);
               return;
            }
            if (!taskParameters.config.templateBuilder) {
               logger.warning({
                  message: '"View" or "UI" module doesn\'t exists in current project. "*.html.tmpl" templates will be ignored',
                  moduleInfo,
                  filePath: file.path
               });
               callback(null, file);
               return;
            }

            const relativeTmplPath = path.relative(moduleInfo.path, file.history[0]);
            const relativeTmplPathWithModuleName = helpers.prettifyPath(
               path.join(path.basename(moduleInfo.path), relativeTmplPath)
            );
            const [error, result] = await execInPool(
               taskParameters.pool,
               'buildHtmlTmpl',
               [
                  file.contents.toString(),
                  file.history[0],
                  {
                     multiService: taskParameters.config.multiService,
                     servicesPath: `${taskParameters.config.urlDefaultServicePath}service/`,
                     application: taskParameters.config.applicationForRebase
                  },
                  relativeTmplPathWithModuleName,
                  componentsPropertiesFilePath
               ],
               file.history[0],
               moduleInfo
            );
            if (error) {
               taskParameters.cache.markFileAsFailed(file.history[0]);

               logger.error({
                  message: 'Ошибка при обработке html-tmpl шаблона',
                  error,
                  moduleInfo,
                  filePath: file.history[0]
               });
            } else {
               taskParameters.storePluginTime('build html-tmpl', result.passedTime, true);
               const outputPath = path.join(moduleInfo.output, transliterate(relativeTmplPath)).replace('.tmpl', '');
               taskParameters.cache.addOutputFile(file.history[0], outputPath, moduleInfo);
               this.push(
                  new Vinyl({
                     base: moduleInfo.output,
                     path: outputPath,
                     contents: Buffer.from(result.content),
                     pushToServer: taskParameters.config.staticServer
                  })
               );

               const resultStaticTemplate = relativeTmplPathWithModuleName.replace(
                  '.tmpl',
                  ''
               );
               if (moduleInfo.staticTemplates.hasOwnProperty(path.basename(outputPath))) {
                  moduleInfo.staticTemplates[path.basename(outputPath)].push(resultStaticTemplate);
               } else {
                  moduleInfo.staticTemplates[path.basename(outputPath)] = [resultStaticTemplate];
               }
            }
         } catch (error) {
            logger.error({ error });
         }
         callback(null, file);
      }
   );
};
