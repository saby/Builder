/**
 * Набор базовых констант, используемых в тасках Gulp
 * @author Колбешин Ф.А.
 */
'use strict';
module.exports = {
   metaFolder: '/.builder/',
   oldThemes: [
      'carry',
      'carry_medium',
      'carrynew',
      'carrynew_medium',
      'genie',
      'online',
      'presto',
      'presto_medium',
      'prestonew',
      'prestonew_medium',
      'plugin'
   ],
   requireJsSubstitutions: new Map([
      ['WS.Core/lib', 'Lib'],
      ['WS.Core/lib/Ext', 'Ext'],
      ['WS.Core/core', 'Core'],
      ['WS.Core/transport', 'Transport'],
      ['WS.Core/css', 'WS/css'],
      ['WS.Deprecated', 'Deprecated']
   ]),
   stylesToExcludeFromMinify: [
      /.*\.min\.css$/,
      /[/\\]service[/\\].*/
   ],
   isWindows: process.platform === 'win32'
};
