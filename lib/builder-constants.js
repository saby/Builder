/**
 * Набор базовых констант, используемых в тасках Gulp
 * @author Kolbeshin F.A.
 */
'use strict';

const browsersList = [
   'Chrome>=49',
   'Firefox>=36',
   'ie>=10',
   'iOS>=12',
   'Opera>=36',
   'Safari>=12.0',
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
   isWindows: process.platform === 'win32',
   defaultCssVariablesOptions: {

      // this options allows us to build default value for css class and
      // save dynamic variable definition
      preserve: true,

      // don't save variables that was paste in during current less file
      // build to avoid generating of useless css code in each compiled
      // less file
      preserveInjectedVariables: false
   }
};
