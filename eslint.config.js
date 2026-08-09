//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',

      // No escape hatches
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'as',
          objectLiteralTypeAssertions: 'never',
        },
      ],
    },
  },
  {
    // Boundaries that are easy to breach by accident and expensive when broken.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/index.ts', '#/db/index.ts'],
              message:
                'Import createScopedDb from db/scoped.ts so queries are filtered by userId. Only db/scoped/*, db/system.ts and auth/server.ts may reach getDb directly.',
            },
            {
              // Only the `env` export — DurableObject/WorkerEntrypoint are fine.
              group: ['cloudflare:workers'],
              importNames: ['env'],
              message:
                'Read bindings via getEnv() from server/env.ts rather than importing env directly, so there is one place that owns Workers env access.',
            },
            {
              group: ['@temporalio/*'],
              message:
                'The edge Worker must never import @temporalio/* — talk to the Node worker over the HTTP gateway (server/video.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    // The db layer itself, and Better Auth's adapter, need the raw client.
    files: [
      'src/db/index.ts',
      'src/db/scoped/*.ts',
      'src/db/system.ts',
      'src/auth/server.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // env.ts is the single place allowed to touch the Workers env directly.
    files: ['src/server/env.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // The Temporal worker/workflows are the Node side — @temporalio lives here.
    files: ['src/temporal/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    ignores: ['eslint.config.js', 'prettier.config.js'],
  },
]
