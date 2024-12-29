import globals from 'globals';
import js from '@eslint/js';

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        languageOptions: {
            ecmaVersion: 2023,
            globals: globals.node,
        },
    },
    js.configs.recommended,
];
