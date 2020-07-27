define('Modul/testNativeNamesImports', [
    'require',
    'exports'
], function (require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
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
    Object.defineProperty(exports, 'fetch', {
        get: function () {
            var result = Modul__es6_fetch_func();
            if (typeof result === 'function' && !result.prototype.hasOwnProperty('_moduleName')) {
                result.prototype._moduleName = 'Modul/testNativeNamesImports:fetch';
            }
            return result;
        },
        enumerable: true
    });
    return exports;
});