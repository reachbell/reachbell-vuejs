import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: [
    { file: 'dist/index.cjs', format: 'cjs', sourcemap: true, exports: 'named' },
    { file: 'dist/index.mjs', format: 'esm', sourcemap: true },
  ],
  // vue + @reachbell/sdk come from the consumer's bundle.
  external: ['vue', '@reachbell/sdk'],
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: 'dist',
      rootDir: 'src',
      sourceMap: true,
    }),
  ],
};
