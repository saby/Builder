define('Modul/testNativeNamesImports', [
    'require',
    'exports'
], function (require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['Modul/_es6/fetch'] = true;
        var Modul__es6_fetch = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            exports.someTest = void 0;
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
    exports.fetch = void 0;
    exports.fetch = Modul__es6_fetch;
    
    return exports;
});