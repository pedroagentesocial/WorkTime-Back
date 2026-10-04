import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const INFRA_PACKAGES = [
  'express',
  'awilix',
  'pino',
  'pino-http',
  'jose',
  'argon2',
  'pg',
  '@prisma/*',
  'zod',
];

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'src/generated/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  prettier,

  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'security/detect-object-injection': 'off',
      'no-restricted-properties': [
        'error',
        {
          property: '$queryRawUnsafe',
          message: 'Usa $queryRaw con template literal (parametrizado).',
        },
        {
          property: '$executeRawUnsafe',
          message: 'Usa $executeRaw con template literal (parametrizado).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Lee la configuración desde Env (src/config/env.ts), no desde process.env.',
        },
      ],
    },
  },

  {
    files: ['src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/application/**',
                '**/infrastructure/**',
                '**/presentation/**',
                '#shared/http/*',
                '#shared/composition/*',
                '#generated/*',
              ],
              message: 'domain no depende de capas externas.',
            },
            {
              group: INFRA_PACKAGES,
              message: 'domain no depende de librerías de infraestructura.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/application/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/infrastructure/**',
                '**/presentation/**',
                '#shared/http/*',
                '#shared/composition/*',
                '#generated/*',
              ],
              message: 'application solo depende de domain y de puertos (interfaces).',
            },
            {
              group: INFRA_PACKAGES,
              message: 'application no depende de librerías de infraestructura; define un puerto.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/config/env.ts', 'prisma.config.ts', 'vitest.config.ts', 'test/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.test.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
