define('Modul/external_public_deps', [
    'Modul/public/publicInterface',
    'require',
    'exports',
    'Modul/Modul',
    'Modul/publicFunction1'
], function (removeArrayDuplicates, require, exports, Module_1, testFunction_1) {
        exports['Modul/_es6/testPublicModule'] = true;
        var Modul__es6_testPublicModule;
    var Modul__es6_testPublicModule_func = function () {
        if (!Modul__es6_testPublicModule) {
            Modul__es6_testPublicModule = function () {
                'use strict';
                var exports = {};
                var result = function (require, exports, removeArrayDuplicates) {
                    'use strict';
                    return removeArrayDuplicates;
                }(require, exports, removeArrayDuplicates);
                if (result instanceof Function) {
                    return result;
                } else if (result && Object.getPrototypeOf(result) !== Object.prototype) {
                    return result;
                } else {
                    for (var property in result) {
                        if (result.hasOwnProperty(property)) {
                            exports[property] = result[property];
                        }
                    }
                }
                return exports;
            }();
        }
        return Modul__es6_testPublicModule;
    };
        function lazyDefineProperty(scope, name, moduleName, factory) {
        Object.defineProperty(scope, name, {
            get: function () {
                var e = factory();
                if ('function' === typeof e && e.prototype && !e.prototype.hasOwnProperty('_moduleName'))
                    e.prototype._moduleName = moduleName;
                return e;
            },
            enumerable: true
        });
    }
        var exports = {
        default: Module_1,
        simpleArrayFunction: testFunction_1,
        removeArrayDuplicates: Modul__es6_testPublicModule_func()
    };
    exports._packedLibrary = true;
    return exports;
});