'use strict';

const path = require('path'),
   fs = require('fs-extra');

const trimLessError = function(message) {
   const startIndexForTriedBlock = message.indexOf(' Tried - ');
   if (startIndexForTriedBlock !== -1) {
      return message.slice(0, startIndexForTriedBlock);
   }
   return message;
};

const timeout = function(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
};

// в файловой системе HFS Plus точность хранения даты равняется 1 секунде
// из-за этого тесты могуть падать непредсказуемым образом, и при этом для пользователя проблем не будет
const timeoutForMacOS = async function() {
   if (process.platform === 'darwin') {
      await timeout(1000);
   }
};

const getMTime = async function(filePath) {
   return (await fs.lstat(filePath)).mtime.getTime();
};

const removeRSymbol = function(str) {
   return str.replace(/\r/g, '');
};

const isSymlink = async(folder, filePath) => {
   const fullPath = path.join(folder, filePath);
   if (!(await fs.pathExists(fullPath))) {
      return false;
   }
   const stat = await fs.lstat(fullPath);
   return stat.isSymbolicLink();
};

const isRegularFile = async(folder, filePath) => {
   const fullPath = path.join(folder, filePath);
   if (!(await fs.pathExists(fullPath))) {
      return false;
   }
   const stat = await fs.lstat(fullPath);
   return !stat.isSymbolicLink() && stat.isFile();
};

function linkPlatform(sourceFolder) {
   const nodeModulesPath = path.join(__dirname, '../node_modules');
   return Promise.all([
      fs.symlink(path.join(nodeModulesPath, 'sbis3-ws/WS.Core'), path.join(sourceFolder, 'WS.Core'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'sbis3-ws/View'), path.join(sourceFolder, 'View'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'sbis3-ws/Vdom'), path.join(sourceFolder, 'Vdom'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'Router/Router'), path.join(sourceFolder, 'Router'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'sbis3-ws/Inferno'), path.join(sourceFolder, 'Inferno'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'saby-types/Types'), path.join(sourceFolder, 'Types'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'sbis3-controls/Controls'), path.join(sourceFolder, 'Controls'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'ws-data/WS.Data'), path.join(sourceFolder, 'WS.Data'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'rmi/src/client/Env'), path.join(sourceFolder, 'Env'), 'dir'),
      fs.symlink(path.join(nodeModulesPath, 'rmi/src/client/Browser'), path.join(sourceFolder, 'Browser'), 'dir')
   ]);
}

module.exports = {
   trimLessError,
   timeoutForMacOS,
   getMTime,
   removeRSymbol,
   isSymlink,
   isRegularFile,
   linkPlatform
};
