/**
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   transliterate = require('../../../lib/transliterate'),
   Vinyl = require('vinyl'),
   logger = require('../../../lib/logger').logger();
const { optimize, extendDefaultPlugins } = require('svgo');
const path = require('path');

// allowed icon name template
const ICON_NAME_REGEX = /^icon-[A-Za-z0-9]+$/;

const postProcessSVG = (ast, params) => {
   if (ast.name === 'svg') {
      ast.name = 'symbol';
      ast.attributes.id = params.fileName;
   }
   delete ast.attributes.xmlns;
};

function getSvgoOptions(fileName) {
   return {
      plugins: extendDefaultPlugins([
         {
            name: 'cleanupIDs',
            active: false
         },
         {
            name: 'removeStyleElement',
            active: true
         },
         {
            name: 'processSvgIcon',
            type: 'perItem',
            params: {
               fileName,
            },
            fn: postProcessSVG
         },
         {
            name: 'removeAttrs',
            active: true,
            params: {
               attrs: ['version', 'style', 'fill', 'xml.*']
            }
         },
         {
            name: 'mergePaths',
            active: false
         }
      ])
   };
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const packagesToBuild = [];
   return through.obj(
      function onTransform(file, encoding, callback) {
         try {
            if (!file.contents) {
               callback();
               return;
            }

            if (file.extname !== '.svg') {
               callback(null, file);
               return;
            }

            // throw an error if svg icon name isn't matching our allowed pattern
            if (!ICON_NAME_REGEX.test(file.stem)) {
               logger.error({
                  message: `Svg name "${file.stem}" is forbidden. Use a name matching the pattern /^icon-[A-Za-z0-9]+$/`,
                  filePath: file.history[0],
                  moduleInfo
               });
               taskParameters.cache.markFileAsFailed(file.history[0]);
               callback(null, file);
               return;
            }

            let relativeFilePath = path.relative(moduleInfo.path, file.history[0]);
            relativeFilePath = path.join(
               path.basename(moduleInfo.path),
               relativeFilePath
            );
            const outputPath = path.join(moduleInfo.output, transliterate(relativeFilePath));
            const nameParts = relativeFilePath.split(path.sep);
            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], outputPath, moduleInfo);

               // add package artifact to output meta of current svg to remove it with a garbage
               // collector if all of current package members are removed from sources
               taskParameters.cache.addOutputFile(
                  file.history[0],
                  path.join(moduleInfo.output, `${nameParts[1]}.svg`),
                  moduleInfo
               );
               callback(null, file);
               return;
            }
            if (nameParts.length >= 3) {
               packagesToBuild.push(nameParts[1]);
            }

            moduleInfo.cache.storeSvgContent(relativeFilePath, file.contents.toString());
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: "Builder's error during processing svg image",
               error,
               moduleInfo,
               filePath: file.history[0]
            });
         }
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         const currentPackagesMeta = moduleInfo.cache.getCurrentSvgPackagesMeta();
         const lastPackagesMeta = moduleInfo.cache.getLastSvgPackagesMeta();
         Object.keys(currentPackagesMeta).forEach((currentPackage) => {
            if (
               packagesToBuild.includes(currentPackage) ||
               (lastPackagesMeta[currentPackage] &&
               lastPackagesMeta[currentPackage].length !== currentPackagesMeta[currentPackage].length)
            ) {
               const currentResult = ['<svg xmlns="http://www.w3.org/2000/svg">'];
               const currentPackageDependencies = [];
               const packageName = `${path.basename(moduleInfo.output)}/${currentPackage}.svg`;
               currentPackagesMeta[currentPackage].forEach((currentSvg) => {
                  currentPackageDependencies.push(currentSvg.path);
                  const optimizedSvg = optimize(currentSvg.content, getSvgoOptions(path.basename(currentSvg.path, '.svg')));
                  currentResult.push(optimizedSvg.data);

                  // add package artifact to output meta of current svg to remove it with a garbage
                  // collector if all of current package members are removed from sources
                  taskParameters.cache.addOutputFile(currentSvg.path, packageName, moduleInfo);
               });
               currentResult.push('</svg>');
               this.push(
                  new Vinyl({
                     path: `${currentPackage}.svg`,
                     contents: Buffer.from(currentResult.join('')),
                     moduleInfo
                  })
               );
            }
         });
         callback();
      }
   );
};
