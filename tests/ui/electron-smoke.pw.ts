import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('opens the UI without renderer errors', async () => {
  const rootDir = path.resolve(__dirname, '../..');
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'crewtimer-video-review-'),
  );
  const errors: string[] = [];
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...launchEnv } =
    process.env;

  const electronApp = await electron.launch({
    args: [path.join(rootDir, 'release/app'), `--user-data-dir=${userDataDir}`],
    cwd: rootDir,
    env: {
      ...launchEnv,
      NODE_ENV: 'production',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  try {
    const window =
      electronApp.windows().find((page) => !page.url().startsWith('devtools:')) ??
      (await electronApp.waitForEvent('window', {
        predicate: (page) => !page.url().startsWith('devtools:'),
      }));
    window.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(`console.error: ${message.text()}`);
      }
    });
    window.on('pageerror', (error) => {
      errors.push(`pageerror: ${error.stack ?? error.message}`);
    });
    window.on('requestfailed', (request) => {
      errors.push(
        `requestfailed: ${request.url()} (${request.failure()?.errorText})`,
      );
    });

    await window.reload({ waitUntil: 'domcontentloaded' });
    await window.waitForTimeout(2_000);

    expect(errors, errors.join('\n')).toEqual([]);
    await expect(window.locator('#root')).not.toBeEmpty();
  } finally {
    await electronApp.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
