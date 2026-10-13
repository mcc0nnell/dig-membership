import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'.',
 testMatch:'offline.browser.spec.mjs',
 use:{...devices['Desktop Chrome'],headless:true},
 timeout:30000,workers:1,retries:0,reporter:'list'
});
