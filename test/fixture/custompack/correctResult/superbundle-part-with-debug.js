(function(){define('css!InterfaceModule1/moduleStyle',['css!superbundle-for-builder-tests.package'],'');define('css!InterfaceModule1/amdModule',['css!superbundle-for-builder-tests.package'],'');})();
define("InterfaceModule1/library", ["require", "exports", "InterfaceModule1/_private/module1", "InterfaceModule1/_private/module2"], function (require, exports, module1_1, module2_1) {
    'use strict';
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.test = exports.Module2 = exports.Module1 = void 0;
    Object.defineProperty(exports, "Module1", { enumerable: true, get: function () { return module1_1.default; } });
    Object.defineProperty(exports, "Module2", { enumerable: true, get: function () { return module2_1.default; } });
    function test() {
        return 'test';
    }
    exports.test = test;
});

/* eslint-disable */
define('InterfaceModule1/amdModule', ['css!InterfaceModule1/amdModule'], function() {
   return {
      _moduleName: 'InterfaceModule1/amdModule'
   };
});
