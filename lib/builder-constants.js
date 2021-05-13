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
   },

   // https://docs.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation
   // When using an API to create a directory, the specified path cannot be so long that
   // you cannot append an 8.3 file name (that is, the directory name cannot exceed MAX_PATH minus 12).
   // https://unix.stackexchange.com/questions/32795/what-is-the-maximum-allowed-filename-and-folder-size-with-ecryptfs
   // Linux has a maximum filename length of 255 characters for most filesystems (including EXT4),
   // and a maximum path of 4096 characters.
   MAX_PATH: process.platform === 'win32' ? 248 : 4096
};
