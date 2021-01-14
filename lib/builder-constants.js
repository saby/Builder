/**
 * Набор базовых констант, используемых в тасках Gulp
 * @author Kolbeshin F.A.
 */
'use strict';

const browsersList = [
   'Chrome>=49',
   'Firefox>=36',
   'ie>=11',
   'iOS>=12',
   'Opera>=36',
   'Safari>=6.0',
   'Edge>=12'
];
module.exports = {
   metaFolder: '/.builder/',
   oldThemes: [
      'carry',
      'carry_medium',
      'carrynew',
      'carrynew_medium',
      'online',
      'presto',
      'presto_medium',
      'prestonew',
      'prestonew_medium',
      'plugin'
   ],
   defaultAutoprefixerOptions: { grid: true, browsers: browsersList, remove: false },
   requireJsSubstitutions: new Map([
      ['WS.Core/lib', 'Lib'],
      ['WS.Core/lib/Ext', 'Ext'],
      ['WS.Core/core', 'Core'],
      ['WS.Core/transport', 'Transport'],
      ['WS.Core/css', 'WS/css'],
      ['WS.Deprecated', 'Deprecated'],
      ['WS.Core/ext/requirejs/plugins', '']
   ]),
   stylesToExcludeFromMinify: [
      /.*\.min\.css$/,
      /[/\\]service[/\\].*/
   ],
   isWindows: process.platform === 'win32'
};
