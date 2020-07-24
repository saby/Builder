/**
 * AST-tree object that matches this code:
 * <code of your promise>.catch(function(err) { require.onError(err); });
 */
'use strict';

module.exports = {
   type: 'CallExpression',
   callee: {
      type: 'MemberExpression',
      computed: false,
      object: '<code of your promise>',
      property: {
         type: 'Identifier',
         name: 'catch'
      }
   },
   arguments: [{
      type: 'FunctionExpression',
      id: null,
      params: [{
         type: 'Identifier',
         name: 'err'
      }],
      body: {
         type: 'BlockStatement',
         body: [{
            type: 'ExpressionStatement',
            expression: {
               type: 'CallExpression',
               callee: {
                  type: 'MemberExpression',
                  computed: false,
                  object: {
                     type: 'Identifier',
                     name: 'requirejs'
                  },
                  property: {
                     type: 'Identifier',
                     name: 'onError'
                  }
               },
               arguments: [{
                  type: 'Identifier',
                  name: 'err'
               }]
            }
         }]
      },
      generator: false,
      expression: false,
      async: false
   }]
};
