import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // JSX components count as "used" (no react plugin installed for this).
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]', argsIgnorePattern: '^_' }],
    },
  },
  {
    // Pure-logic tests run in Node.
    files: ['src/lib/**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]
