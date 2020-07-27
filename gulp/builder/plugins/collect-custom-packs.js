/**
 * Плагин для кастомной паковки. Ищет файлы *.package.json, в зависимости от наличия опции level и её значения
 * делит конфигурации для кастомной паковки на приоритетные и обычные.
 * @author Kolbeshin F.A.
 */

'use strict';

const
   path = require('path'),
   through = require('through2'),
   packHelpers = require('../../../lib/pack/helpers/custompack'),
   helpers = require('../../../lib/helpers'),
   logger = require('../../../lib/logger').logger();

/**
 * Объявление плагина
 * @param {Object} configs все конфигурации для кастомной паковки
 * @param {string} root корень развернутого приложения
 * @returns {stream}
 */
module.exports = function collectPackageJson(moduleInfo, applicationRoot, configs, bundlesList) {
   const { commonBundles, superBundles } = configs;
   return through.obj(
      function onTransform(file, encoding, callback) {
         let currentPackageJson;
         try {
            currentPackageJson = JSON.parse(file.contents);

            /**
             * set application root as builder cache to get all configs for custom packages.
             * Needed by superbundles configs, that uses another packages for packing.
              */
            const prettyApplicationRoot = helpers.unixifyPath(path.dirname(moduleInfo.output));
            const configPath = helpers.unixifyPath(file.path).replace(prettyApplicationRoot, '');
            const configsArray = packHelpers.getConfigsFromPackageJson(
               configPath,
               currentPackageJson,
               moduleInfo
            ).filter(currentConfig => configs.extendBundles || !currentConfig.extendsTo);

            configsArray.forEach((currentConfig) => {
               const isPrivatePackage = currentConfig.includeCore && !currentConfig.platformPackage;

               /**
                * custom packages has 2 types of the output path set:
                * 1)extendsTo - sets the path to save current extendable custom package - join with another packages
                * with the same output path to get joined superbundle.
                * 2)output - sets the current interface module output path(relative by current package config path)
                */
               const currentConfigOutput = currentConfig.output ? currentConfig.output : currentConfig.extendsTo;
               const normalizedConfigOutput = `${currentConfigOutput.replace(/\.js$/, '')}.min`;
               let currentBundlePath;

               /**
                * for normal bundles bundle path is relative by config path
                * for extendable bundles path to extends is relative by the
                * project's root
                */
               if (currentConfig.output) {
                  currentBundlePath = helpers.unixifyPath(path.join(
                     'resources',
                     currentConfigOutput.search(/\.js$/) !== -1 ? path.dirname(configPath) : '',
                     normalizedConfigOutput
                  ));
               } else {
                  currentBundlePath = helpers.unixifyPath(path.join(
                     'resources',
                     normalizedConfigOutput
                  ));
               }

               if (!currentConfig.output) {
                  currentConfig.output = currentConfig.extendsTo;
               }
               if (bundlesList.has(currentBundlePath) || isPrivatePackage) {
                  if (currentConfig.hasOwnProperty('includePackages') && currentConfig.includePackages.length > 0) {
                     superBundles.push(currentConfig);
                  } else {
                     commonBundles[helpers.unixifyPath(
                        path.join(path.dirname(file.path), currentConfig.output)
                     )] = currentConfig;
                  }
               } else {
                  logger.warning({
                     message: `Attempt to generate new custom package ${normalizedConfigOutput}. Custom packing is deprecated! Use libraries instead!`,
                     filePath: file.path,
                     moduleInfo
                  });
               }
            });
         } catch (err) {
            logger.error({
               message: 'Ошибка парсинга конфигурации для кастомного пакета',
               filePath: file.path,
               error: err
            });
         }
         callback();
      }
   );
};
