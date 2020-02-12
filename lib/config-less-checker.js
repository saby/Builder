'use strict';

const isGlob = require('is-glob');

/**
 * Проверяем на корректность задания в пользовательской конфигурации
 * less параметра "compatibility"
 * @param{Object} config - пользовательская конфигурация less
 */
function checkCompatibilityOption(config) {
   if (config.compatibility) {
      switch (typeof config.compatibility) {
         case 'object':
            if (!(config.compatibility instanceof Object)) {
               throw new Error('Неверно задано свойство compatibility в конфигурации less. ' +
                  'Убедитесь, что оно задано как boolean или объект с описанием паттернов и тегов совместимости!');
            }
            Object.keys(config.compatibility).forEach((pattern) => {
               /**
                * проверим паттерн на соответствие glob-стандартам.
                */
               if (!isGlob(pattern)) {
                  throw new Error('заданный в свойстве compatibility паттерн не удовлетворяет' +
                     ` glob-стандартам: "${pattern}". Проверьте правильность описания данного паттерна. `);
               }

               /**
                * Убедимся, что для паттерна описан массив тегов совместимости
                */
               if (!(config.compatibility[pattern] instanceof Array)) {
                  throw new Error(`compatibility: Для паттерна ${pattern} должен быть задан массив тегов совместимости!`);
               } else if (config.compatibility[pattern].length === 0) {
                  throw new Error(`compatibility: Для паттерна ${pattern} заданный массив тегов совместимости не должен быть пустым!`);
               }
            });
            break;
         default:
            break;
      }
   } else {
      config.compatibility = true;
   }
}

/**
 * Проверяем на корректность задания в пользовательской конфигурации
 * less основных параметров:
 * 1)old - старая схема темизации less - вшивается тема по умолчанию.
 * 2)multi - новая схема темизации less - каждая тема собирается с текущей less
 * по отдельности, получаемый css-файл имеет соответствующий постфикс темы.
 * @param{Object} config - пользовательская конфигурация less текущего Интерфейсного модуля
 * @param{String} optionName - анализируемая опция пользовательской конфигурации
 */
function checkMainOptions(config, optionName) {
   if (config.hasOwnProperty(optionName)) {
      switch (typeof config[optionName]) {
         case 'string':
            if (!isGlob(config[optionName])) {
               throw new Error(`паттерн для опции ${optionName} в конфигурации по темизации задан ` +
                  `не по стандартам glob-паттернов. Проверьте правильность описания паттерна: "${config[optionName]}".`);
            }
            break;
         case 'object':
            if (config[optionName].include) {
               if (!(config[optionName].include instanceof Array)) {
                  throw new Error(`theme type - ${optionName} - include option: должен быть задан массив паттернов!`);
               } else if (config[optionName].include.length === 0) {
                  throw new Error(`theme type - ${optionName} - include option: массив паттернов не может быть пустым!`);
               }
               config[optionName].include.forEach((pattern) => {
                  if (!isGlob(pattern)) {
                     throw new Error(`один из паттернов для опции ${optionName} в конфигурации по темизации задан ` +
                        `не по стандартам glob-паттернов. Проверьте правильность описания паттерна: "${pattern}".`);
                  }
               });
            } else {
               config[optionName].include = ['**/*.less'];
            }
            if (config[optionName].exclude) {
               // Убедимся, что в exclude описан массив паттернов
               if (!(config[optionName].exclude instanceof Array)) {
                  throw new Error(`theme type - ${optionName} - exclude option: должен быть задан массив паттернов!`);
               } else if (config[optionName].exclude.length === 0) {
                  throw new Error(`theme type - ${optionName} - exclude option: массив паттернов не может быть пустым!`);
               }
               config[optionName].exclude.forEach((pattern) => {
                  if (!isGlob(pattern)) {
                     throw new Error(`один из паттернов для опции ${optionName} в конфигурации по темизации задан ` +
                        `не по стандартам glob-паттернов. Проверьте правильность описания паттерна: "${pattern}".`);
                  }
               });
            } else {
               config[optionName].exclude = [];
            }

            /**
             * for old theme type get variables from SBIS3.CONTROLS by default(old online theme).
             * Or use import of new default theme if selected
             */
            if (optionName === 'old') {
               config[optionName].variables = 'SBIS3.CONTROLS';
            }
            break;
         default:
            break;
      }
   } else {
      config[optionName] = optionName === 'old';
   }
}

function checkOptions(config) {
   checkMainOptions(config, 'old');
   checkMainOptions(config, 'multi');
   checkCompatibilityOption(config);
}

module.exports = {
   checkOptions
};
