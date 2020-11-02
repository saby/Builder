'use strict';

module.exports = {
   type: 'ExpressionStatement',
   expression: {
      type: 'CallExpression',
      callee: {
         type: 'Identifier',
         name: 'lazyDefineProperty'
      },
      arguments: [
         {
            type: 'Identifier',
            name: 'exports'
         },
         {
            type: 'Literal',
            value: 'default',
            raw: '"default"'
         },
         {
            type: 'Literal',
            value: 'Library:component',
            raw: '"Library:component"'
         },
         {
            type: 'FunctionExpression',
            id: null,
            params: [],
            body: {
               type: 'BlockStatement',
               body: [
                  {
                     type: 'ReturnStatement',
                     argument: {
                        type: 'Identifier',
                        name: 'factory'
                     }
                  }
               ]
            },
            generator: false,
            expression: false,
            async: false
         }
      ]
   }
};
