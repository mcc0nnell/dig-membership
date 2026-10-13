import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',
 testMatch:'*.spec.mjs',
 retries:0,
 workers:1,
 reporter:'list',
 use:{...devices['Desktop Chrome'],headless:true,actionTimeout:10000},
 timeout:30000
});
