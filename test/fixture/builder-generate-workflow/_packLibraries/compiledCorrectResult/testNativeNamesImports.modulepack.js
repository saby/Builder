define('Modul/testNativeNamesImports', [
    'require',
    'exports'
], function (require, exports) {
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
        exports['Modul/_es6/fetch'] = true;
        var Modul__es6_fetch;
    var Modul__es6_fetch_func = function () {
        if (!Modul__es6_fetch) {
            Modul__es6_fetch = function () {
                'use strict';
                var exports = {};
                var result = function (require, exports) {
                    'use strict';
                    Object.defineProperty(exports, '__esModule', { value: true });
                    function someTest() {
                        var test1 = 'Тестовое сообщение';
                        return test1;
                    }
                    exports.someTest = someTest;
                }(require, exports);
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
        return Modul__es6_fetch;
    };
    Object.defineProperty(exports, '__esModule', { value: true });
    lazyDefineProperty(exports, 'fetch', 'Modul/testNativeNamesImports:fetch', function () {
        return Modul__es6_fetch_func();
    });
    exports._packedLibrary = true;
    return exports;
});