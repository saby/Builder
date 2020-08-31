/**
 * Плагин для паковки в HTML.
 * Берёт корневой элемент и все зависимости пакует.
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   domHelpers = require('../../../packer/lib/dom-helpers'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers'),
   packHtml = require('../../../packer/tasks/lib/pack-html'),
   execInPool = require('../../common/exec-in-pool');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @param {DepGraph} gd граф зависмостей
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo, gd) {
   const prettyOutput = helpers.prettifyPath(taskParameters.config.rawConfig.output);
   return through.obj(async function onTransform(file, encoding, callback) {
      try {
         if (file.extname !== '.html') {
            callback(null, file);
            return;
         }

         const [error, minText] = await execInPool(taskParameters.pool, 'minifyHtml', [file.contents.toString()]);
         if (error) {
            logger.error({
               message: 'Ошибка при минификации html',
               error,
               moduleInfo,
               filePath: file.path
            });
         } else if (
            helpers.prettifyPath(path.dirname(path.dirname(file.path))) !== prettyOutput
         ) {
            // если файл лежит не в корне модуля, то это скорее всего шаблон html.
            // используется в сервисе представлений для построения страниц на роутинге.
            // паковка тут не нужна, а минимизация нужна.
            file.contents = Buffer.from(minText);
         } else {
            let dom = domHelpers.domify(minText);

            // sets application root as builder cache, for proper html packing in patch build
            const root = taskParameters.config.cachePath ? `${taskParameters.config.cachePath}/incremental_build` : path.dirname(taskParameters.config.rawConfig.output),
               buildNumber = taskParameters.config.multiService ? `%{MODULE_VERSION_STUB=${path.basename(moduleInfo.output)}}` : taskParameters.config.version,
               replacePath = !taskParameters.config.multiService;

            dom = await packHtml.packageSingleHtml(
               taskParameters,
               file.path,
               dom,
               root,
               `${path.basename(moduleInfo.output)}/static_packages`,
               gd,
               taskParameters.config.urlServicePath,
               buildNumber,
               replacePath,
               taskParameters.config.rawConfig.output,
               taskParameters.config.localizations
            );

            file.contents = Buffer.from(domHelpers.stringify(dom));
         }
      } catch (error) {
         logger.error({
            message: 'Ошибка при паковке html',
            error,
            moduleInfo,
            filePath: file.path
         });
      }
      callback(null, file);
   });
};
