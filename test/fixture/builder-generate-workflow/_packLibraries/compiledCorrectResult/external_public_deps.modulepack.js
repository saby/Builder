define('Modul/external_public_deps', [
    'Modul/public/publicInterface',
    'require',
    'exports',
    'Modul/Modul',
    'Modul/publicFunction1'
], function (removeArrayDuplicates, require, exports, Module_1, testFunction_1) {
        exports['Modul/_es6/testPublicModule'] = true;
        var Modul__es6_testPublicModule = function () {
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
        var testFunction_2 = Modul__es6_testPublicModule;
        var exports = {
        default: Module_1,
        simpleArrayFunction: testFunction_1,
        removeArrayDuplicates: testFunction_2
    };
    return exports;
});