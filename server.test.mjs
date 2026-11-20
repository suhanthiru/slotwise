import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from './server.mjs';

test('validates dates, enforces exclusive bookings, persists results and cancels', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'slotwise-'));
  const apps = [];
  const close = (app) => new Promise((resolve) => app.close(resolve));
  t.after(async () => {
    for (const app of apps) if (app.listening) await close(app);
    await rm(folder, { recursive: true, force: true });
  });
  const database = join(folder, 'bookings.sqlite');
  async function listen() {
    const app = createApp({ database }).listen(0, '127.0.0.1');
    apps.push(app);
    await once(app, 'listening');
    return { app, origin: `http://127.0.0.1:${app.address().port}` };
  }
  const first = await listen();
  const day = '2030-03-05';
  assert.equal((await fetch(`${first.origin}/api/schedule?day=2030-02-31`)).status, 400);
  const create = () => fetch(`${first.origin}/api/bookings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resource: 'electronics', day, hour: 9, label: 'Team Finch' }),
  });
  const responses = await Promise.all([create(), create()]);
  assert.deepEqual(responses.map((res) => res.status).sort(), [201, 409]);
  const booking = await responses.find((res) => res.status === 201).json();
  await close(first.app);
  const second = await listen();
  const schedule = () => fetch(`${second.origin}/api/schedule?day=${day}`).then((response) => response.json());
  assert.deepEqual((await schedule()).bookings, [booking]);
  assert.equal((await fetch(`${second.origin}/api/bookings/${booking.id}`, { method: 'DELETE' })).status, 204);
  assert.deepEqual((await schedule()).bookings, []);
});
