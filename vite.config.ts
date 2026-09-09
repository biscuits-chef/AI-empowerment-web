import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * 根据启动环境装配本地开发服务器；后端联调端口可由 VITE_DEV_API_TARGET 显式覆盖。
 */
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: environment.VITE_DEV_API_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
    preview: { port: 4173, strictPort: true },
    build: { sourcemap: false, target: 'es2022' },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/main.tsx', 'src/test/**'],
        thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
      },
    },
  };
});
