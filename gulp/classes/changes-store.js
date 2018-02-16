'use strict';

const path = require('path'),
   fs = require('fs-extra');


/*
структура стора:
{
   modulePath: {
      exist = true; <- может не быть
      files: {
         filePath:{
            lastModified: '12:12:12';
            exist = true; <- может не быть
         }
      }
   }
}
exist не сохранаяется в файл
*/

class buildCacheInfo{
   constructor(){
      this.runningParameters = {};
   }
}

const demo = {

   //в случае изменений параметров запуска проще кеш сбросить, чем потом ошибки на стенде ловить. не сбрасываем только кеш json
   'runningParameters': {},

   //если поменялась версия билдера, могло помянятся решительно всё. и кеш json в том числе
   'versionOfBuilder': '3.18.330-123',

   //время начала предыдущей сборки. нам не нужно хранить дату изменения каждого файла
   'timeLastBuild': 123123,

   //чтобы не копировать лишнее
   'inputPaths': {
      'path': {
         depends: []
      }
   },

   //чтобы знать что удалить
   'outputPaths': []
};

class ChangesStore {
   constructor(dir) {
      this.filePath = path.join(dir, 'changes.json');
      this.store = {};

   }

   async load() {
      if (await fs.pathExists(this.filePath)) {
         this.store = await fs.readJSON(this.filePath);
      }
   }

   async save() {
      const dir = path.dirname(this.filePath);
      await fs.ensureDir(dir);

      //this.store ещё может быть в работе. и нам не нужна информация о несуществующих сущностях
      const tmpStore = {};
      for (const modulePath in this.store) {
         if (!this.store.hasOwnProperty(modulePath)) {
            continue;
         }
         if (this.store[modulePath].exist) {
            tmpStore[modulePath] = {files: {}};
            const files = this.store[modulePath].files;
            for (const filePath in files) {
               if (!files.hasOwnProperty(filePath)) {
                  continue;
               }
               if (files[filePath].exist) {
                  tmpStore[modulePath].files[filePath] = {
                     time: files[filePath].time
                  };
               }

            }
         }
      }
      await fs.writeJSON(this.filePath, tmpStore);
   }
}

module.exports = ChangesStore;
