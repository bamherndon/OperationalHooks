// eslint.config.cjs
const eslintJs = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    // Ignore build artifacts, deps, zip, and the JS helper script
    ignores: ['dist/**', 'node_modules/**', 'lambda.zip', 'scripts/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      // Tell ESLint about Node globals like console, process, etc.
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Base JS recommended rules
      ...eslintJs.configs.recommended.rules,
      // TS recommended rules
      ...tsPlugin.configs.recommended.rules,
      // Your tweaks
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      // Just in case: don't nag about undefined vars when globals covers them
      'no-undef': 'off',
    },
  },
];
