define('Modul2/Module2', [
    'require',
    'exports',
    'Modul2/_private/notAmd'
], function (require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['Modul2/_private/Module1'] = true;
        var Modul2__private_Module1 = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            var MyClass = function () {
                function MyClass(test1, test2) {
                    this.test1 = test1;
                    this.test2 = test2;
                }
                Object.defineProperty(MyClass.prototype, 'classArray', {
                    get: function () {
                        return this.test2;
                    },
                    set: function (value) {
                        this.test2 = value;
                    },
                    enumerable: false,
                    configurable: true
                });
                return MyClass;
            }();
            exports.default = MyClass;
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
        exports['Modul2/_private/withNotAmdImport'] = true;
        var Modul2__private_withNotAmdImport = function () {
        'use strict';
        var exports = {};
        var result = function (require, exports, Module1_1) {
            'use strict';
            Object.defineProperty(exports, '__esModule', { value: true });
            exports.default = Module1_1.default;
        }(require, exports, Modul2__private_Module1, typeof Modul2__private_notAmd === 'undefined' ? null : Modul2__private_notAmd);
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
        var Module_es6 = Modul2__private_withNotAmdImport;
    exports.default = Module_es6;
    
    return exports;
});