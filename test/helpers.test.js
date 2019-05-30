'use strict';

const initTest = require('./init-test');

const helpers = require('../lib/helpers');
const libPackHelpers = require('../lib/pack/helpers/librarypack');

describe('helpers', () => {
   before(async() => {
      await initTest();
   });

   it('getFirstDirInRelativePath', () => {
      helpers.getFirstDirInRelativePath('/Test1/test2/').should.equal('Test1');
      helpers.getFirstDirInRelativePath('Test1/test1').should.equal('Test1');
      helpers.getFirstDirInRelativePath('\\Test1\\test2').should.equal('Test1');
      helpers.getFirstDirInRelativePath('').should.equal('');
      helpers.getFirstDirInRelativePath('/../test2/').should.equal('..');
      helpers.getFirstDirInRelativePath('./test2/').should.equal('.');
   });

   it('prettifyPath', () => {
      const isWin = process.platform === 'win32';

      helpers.prettifyPath('').should.equal('');

      helpers.prettifyPath('\\').should.equal('/');
      helpers.prettifyPath('/').should.equal('/');

      helpers.prettifyPath('\\simple\\').should.equal('/simple/');
      helpers.prettifyPath('/simple/').should.equal('/simple/');

      // на windows пути, которые начинаются с \\, являются сетевыми и требуют особой обработки
      helpers
         .prettifyPath('\\\\simple\\\\file.less')
         .should.equal(isWin ? '\\\\simple\\file.less' : '/simple/file.less');
      helpers.prettifyPath('\\\\simple/file.less').should.equal(isWin ? '\\\\simple\\file.less' : '/simple/file.less');

      // jinnee-utility может передавать не правильно сетевые пути до файлов. нужно обработать
      helpers.prettifyPath('//simple\\\\file.less').should.equal(isWin ? '\\\\simple\\file.less' : '/simple/file.less');

      helpers.prettifyPath('C:\\/dir\\/').should.equal('C:/dir/');
      helpers.prettifyPath('./../Dir').should.equal('../Dir');
   });

   it('joinContents', () => {
      const firstModuleContents = {
         availableLanguage: {
            'en-US': 'English',
            'ru-RU': 'Русский'
         },
         buildMode: 'debug',
         buildnumber: 'test-1',
         defaultLanguage: 'ru-RU',
         htmlNames: {
            'MyModule/MyController': 'MyTestPage.html'
         },
         modules: {
            'WS.Core': {
               dict: [
                  'en-US',
                  'ru-RU'
               ]
            }
         }
      };
      const secondModuleContents = {
         availableLanguage: {
            'en-US': 'English',
            'ru-RU': 'Русский'
         },
         buildMode: 'debug',
         buildnumber: 'test-1',
         defaultLanguage: 'ru-RU',
         htmlNames: {},
         modules: { Controls: {} }
      };
      const commonContents = {};
      helpers.joinContents(commonContents, firstModuleContents);
      helpers.joinContents(commonContents, secondModuleContents);
      commonContents.buildnumber.should.equal('test-1');
      commonContents.buildMode.should.equal('debug');
      commonContents.defaultLanguage.should.equal('ru-RU');
      commonContents.htmlNames.hasOwnProperty('MyModule/MyController').should.equal(true);
      commonContents.htmlNames['MyModule/MyController'].should.equal('MyTestPage.html');
      commonContents.availableLanguage.hasOwnProperty('en-US').should.equal(true);
      commonContents.availableLanguage['en-US'].should.equal('English');
      commonContents.availableLanguage.hasOwnProperty('ru-RU').should.equal(true);
      commonContents.availableLanguage['ru-RU'].should.equal('Русский');
      commonContents.modules.hasOwnProperty('Controls').should.equal(true);
      helpers.isEqualObjectFirstLevel(commonContents.modules.Controls, {}).should.equal(true);
      commonContents.modules.hasOwnProperty('WS.Core').should.equal(true);
      commonContents.modules['WS.Core'].hasOwnProperty('dict').should.equal(true);
      commonContents.modules['WS.Core'].dict.should.include.members([
         'en-US',
         'ru-RU'
      ]);
   });
});

describe('library pack helpers', () => {
   before(async() => {
      await initTest();
   });

   it('check private module for library in nix', () => {
      let dependency = 'Test/_private/module';
      let result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(true);

      dependency = 'Test/public/_module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = 'Controls/_module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = 'Test/public/module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = '_Test/public/module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);
   });

   it('check private module for library in windows', () => {
      let dependency = 'Test\\_private\\module';
      let result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(true);

      dependency = 'Test\\public\\_module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = 'Controls\\_module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = 'Test\\public\\module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);

      dependency = '_Test\\public\\module';
      result = libPackHelpers.isPrivate(dependency);
      result.should.be.equal(false);
   });
});
