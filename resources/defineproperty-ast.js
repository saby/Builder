'use strict';

module.exports = {
   type: 'ExpressionStatement',
   expression: {
      type: 'CallExpression',
      callee: {
         type: 'MemberExpression',
         computed: false,
         object: {
            type: 'Identifier',
            name: 'Object'
         },
         property: {
            type: 'Identifier',
            name: 'defineProperty'
         }
      },
      arguments: [
         {
            type: 'Identifier',
            name: 'exports'
         },
         {
            type: 'Literal',
            value: '<name of your property>',
            raw: '"<name of your property>"'
         },
         {
            type: 'ObjectExpression',
            properties: [
               {
                  type: 'Property',
                  key: {
                     type: 'Identifier',
                     name: 'get'
                  },
                  computed: false,
                  value: {
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
                                 name: 'variable'
                              }
                           }
                        ]
                     },
                     generator: false,
                     expression: false,
                     async: false
                  },
                  kind: 'init',
                  method: false,
                  shorthand: false
               },
               {
                  type: 'Property',
                  key: {
                     type: 'Identifier',
                     name: 'enumerable'
                  },
                  computed: false,
                  value: {
                     type: 'Literal',
                     value: true,
                     raw: 'true'
                  },
                  kind: 'init',
                  method: false,
                  shorthand: false
               }
            ]
         }
      ]
   }
};
