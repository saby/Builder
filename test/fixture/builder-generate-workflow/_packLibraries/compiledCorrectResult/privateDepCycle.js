/* eslint-disable */

/**
 * Корректный скомпиленный вариант библиотеки, зависимости
 * которой вызывают цикличность друг с другом. При прогоне
 * тестов данному файлу должны соответствовать как
 * скомпиленный модуль, так и его запакованный результат.
 */

define("Modul/privateDepCycle", ["require", "exports", "Modul/_es5/Module", "Modul/_Cycle_dependence/from_private"], function (require, exports, Module_js_1, from_private_es_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Test = void 0;
    exports.Test = from_private_es_1.default;
    exports.default = Module_js_1.default;
});
