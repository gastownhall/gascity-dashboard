import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { agentsRouter } from '../src/routes/agents.js';

const AGENTS_BASE = '/api/city/test-city/agents';

interface AppHandle {
  url: string;
  close: () => Promise<void>;
}

async function buildApp(): Promise<AppHandle> {
  const app = express();
  app.use(AGENTS_BASE, agentsRouter('/home/test/gas-city'));

  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

describe('dashboard agent prime route retirement', { concurrency: false }, () => {
  let h: AppHandle | undefined;

  afterEach(async () => {
    if (h !== undefined) await h.close();
    h = undefined;
  });

  test('agent prime is no longer exposed by the dashboard agents router', async () => {
    h = await buildApp();

    const res = await fetch(`${h.url}${AGENTS_BASE}/mayor/prime`);

    assert.equal(res.status, 404);
  });
});
