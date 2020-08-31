'use strict';

const conditionalComments = /<!--(\[[\s\S]*?])-->/gi,
   conditionalCommentsReplacements = /<!-#\/CC#(\d+)#->/gi,
   wsExpertComments = /<!--WS-EXPERT([\s\S]+?)WS-EXPERT-->/g,
   wsExpertCommentsReplacements = /<!-#\/WEC#(\d+)#->/gi,
   htmlComments = /<!--(?:[^[/][\s\S]*?)?-->/gi,
   possibleComments = /\/\/.*[\r\n]*/g,
   mnComments = /\s?\/\*[\s\S]*?\*+\/+?\s?/g,
   compressSymbols = / {|{ | }|} | =|= | ;|; |, | ,| \)|\) |\( | \(/g;

/**
 * Удалить условный комментарий
 * @param {String} markup - разметка
 * @param {Array} store - хранилище для комментариев
 * @returns {String}
 */
function removeConditionalComments(markup, store) {
   return markup.replace(conditionalComments, (str, commentContent) => {
      store.push(commentContent);
      return `<!-#/CC#${store.length - 1}#->`;
   });
}

/**
 * Восстановить условынй комментарий
 * @param {String} markup - разметка
 * @param {Array} store - хранилище для комментариев
 * @returns {String}
 */
function restoreConditionalComments(markup, store) {
   return markup.replace(conditionalCommentsReplacements, (str, commentID) => `<!--${store[+commentID]}-->`);
}

/**
 * Удалить WS-EXPERT комментарий
 * @param {String} markup - разметка
 * @param {Array} store - хранилище для комментариев
 * @returns {String}
 */
function removeWsExpertComments(markup, store) {
   return markup.replace(wsExpertComments, (str, commentContent) => {
      store.push(commentContent);
      return `<!-#/WEC#${store.length - 1}#->`;
   });
}

/**
 * Восстановить WS-EXPERT комментарий
 * @param {String} markup - разметка
 * @param {Array} store - хранилище для комментариев
 * @returns {String}
 */
function restoreWsExpertComments(markup, store) {
   return markup.replace(
      wsExpertCommentsReplacements,
      (str, commentID) => `<!--WS-EXPERT${store[+commentID]}WS-EXPERT-->`
   );
}

function minifyDOM(text) {
   let newText = text;
   newText = newText.replace(/[\n\r]\s*/g, ' ');
   newText = newText.replace(/>\s+</g, '> <');
   return newText;
}

function saveSlashes(data) {
   // Пройдет по скрипту и сохранит все вхождения двойных слешей, заключенных в кавычки
   const correctDoubleSlashes = /".*(\/{2}.*?".*?[\r\n]*)/g,
      correctSlashes = /'.*(\/{2}.*?'.*?[\r\n]*)/g,
      savedSlahes = [];

   data.replace(correctDoubleSlashes, (str, p1) => {
      savedSlahes.push(p1);
      return str;
   });

   data.replace(correctSlashes, (str, p1) => {
      savedSlahes.push(p1);
      return str;
   });

   return savedSlahes;
}

function minifyScript(text) {
   let newText = text;
   const slashes = saveSlashes(newText);

   /**
    * Найдет все вхождения двойных слешей и сравнит с сохраненным массивом
    * Если найденное вхождение совпадет с одним из сохраненных, то пропустим его.
    * Остальные вхождения примем за комментарий и удалим. Так же удалим многострочные комментарии и переводы строк
    */
   newText = newText.replace(possibleComments, (str) => {
      let isNotComment;
      slashes.forEach((item) => {
         if (str.indexOf(item) !== -1) {
            isNotComment = true;
         }
      });
      if (isNotComment) {
         return str;
      }
      return '';
   });
   newText = newText.replace(mnComments, '');
   newText = newText.replace(/\s{2,}/g, ' ');
   newText = newText.replace(compressSymbols, str => str.replace(/ /, ''));
   return newText;
}

function minify(text) {
   let newText = text;
   const ccStore = [],
      weStore = [];

   // WS-EXPERT не трогаем, там все живет своей жизнью
   newText = removeWsExpertComments(newText, weStore);

   // Условные комментарии тоже оставим, там тоже своя жизнь
   newText = removeConditionalComments(newText, ccStore);

   // Почистим комментарии
   newText = newText.replace(htmlComments, '');

   const scriptWord = '<script',
      endScriptWord = '</script>';

   let startScr = newText.indexOf(scriptWord),
      endScr,
      out = '';

   while (startScr !== -1) {
      out += minifyDOM(newText.substr(0, startScr));
      newText = newText.substr(startScr, newText.length);

      // Найдем теперь первый > - это закрыли тег script
      endScr = newText.indexOf('>');
      out += newText.substr(0, endScr);
      newText = newText.substr(endScr, newText.length);

      // Найдем теперь закрвыющий тег script
      endScr = newText.indexOf(endScriptWord);

      // Минифицируем скрипт
      out += minifyScript(newText.substr(0, endScr));

      // Пошли дальше
      newText = newText.substr(endScr, newText.length);
      startScr = newText.indexOf(scriptWord);
   }
   out += minifyDOM(newText.substr(0, newText.length));

   out = restoreConditionalComments(out, ccStore);
   out = restoreWsExpertComments(out, weStore);
   return out;
}

module.exports = minify;
