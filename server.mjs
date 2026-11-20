import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const resources = [
  { id: 'electronics', name: 'Electronics Bench', category: 'Electronics', location: 'Room 101', equipment: 'Oscilloscope, soldering station' },
  { id: 'fabrication', name: 'Fabrication Bay', category: 'Fabrication', location: 'Room 104', equipment: '3D printer, hand tools' },
  { id: 'media', name: 'Media Suite', category: 'Media', location: 'Room 212', equipment: 'Microphone, video lighting' },
];
const hours = Array.from({ length: 8 }, (_, index) => index + 9);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (day) => datePattern.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
const json = (response, status, value) => response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value));
const error = (response, status, message) => json(response, status, { error: message });

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= 2048) chunks.push(chunk);
  }
  if (size > 2048) throw new Error('Request body exceeds 2 KB.');
  return JSON.parse(Buffer.concat(chunks).toString());
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function createApp({ database = ':memory:', publicDir = 'dist' } = {}) {
  const db = new DatabaseSync(database);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, resource TEXT NOT NULL, day TEXT NOT NULL,
      hour INTEGER NOT NULL, label TEXT NOT NULL, UNIQUE(resource, day, hour)
    ) STRICT;
  `);
  const list = db.prepare('SELECT id, resource, hour, label FROM bookings WHERE day = ? ORDER BY hour, resource');
  const insert = db.prepare('INSERT INTO bookings VALUES (?, ?, ?, ?, ?) ON CONFLICT(resource, day, hour) DO NOTHING');
  const remove = db.prepare('DELETE FROM bookings WHERE id = ?');
  const root = resolve(publicDir);
  const server = createServer(async (request, response) => {
    try {
      const { pathname, searchParams } = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && pathname === '/api/schedule') {
        const day = searchParams.get('day') ?? '';
        if (!validDay(day)) return error(response, 400, 'Use a valid date in YYYY-MM-DD format.');
        return json(response, 200, { resources, hours, bookings: list.all(day) });
      }
      if (request.method === 'POST' && pathname === '/api/bookings') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
          return error(response, 415, 'Send an application/json request.');
        }
        let body;
        try { body = await readJson(request); }
        catch { return error(response, 400, 'Send a valid JSON reservation under 2 KB.'); }
        const { resource, day, hour, label } = body ?? {};
        const name = typeof label === 'string' ? label.trim() : '';
        if (!resources.some(({ id }) => id === resource) || typeof day !== 'string' || !validDay(day) || !hours.includes(hour) || !name || name.length > 60) {
          return error(response, 400, 'Choose a resource, date and start time, and enter a name of 1–60 characters.');
        }
        const id = randomUUID();
        if (!insert.run(id, resource, day, hour, name).changes) return error(response, 409, 'This slot has already been reserved.');
        return json(response, 201, { id, resource, hour, label: name });
      }
      const bookingId = /^\/api\/bookings\/([\da-f-]{36})$/.exec(pathname)?.[1];
      if (request.method === 'DELETE' && bookingId) {
        return remove.run(bookingId).changes ? response.writeHead(204).end() : error(response, 404, 'Reservation not found.');
      }
      if (pathname.startsWith('/api/') || request.method !== 'GET') return error(response, 404, 'Route not found.');
      const filename = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!filename.startsWith(`${root}${sep}`)) return error(response, 404, 'File not found.');
      const info = await stat(filename).catch(() => null);
      if (!info?.isFile()) return error(response, 404, 'File not found. Run npm run build to build the client.');
      response.writeHead(200, { 'content-type': types[extname(filename)] ?? 'application/octet-stream', 'content-length': info.size });
      createReadStream(filename).on('error', (err) => response.destroy(err)).pipe(response);
    } catch (err) {
      console.error(err);
      if (!response.headersSent) return error(response, 500, 'The schedule is temporarily unavailable.');
      response.destroy();
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  createApp({ database: process.env.SLOTWISE_DB ?? 'slotwise.sqlite' }).listen(port, '127.0.0.1', () => {
    console.log(`Slotwise is listening at http://127.0.0.1:${port}`);
  });
}
