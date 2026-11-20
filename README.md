# Slotwise

Slotwise is a makerspace booking app for reserving electronics, fabrication and media equipment. A React and TypeScript schedule shows open slots, supports keyboard navigation and calls a Node.js REST API. SQLite stores reservations and uses a unique constraint to prevent two requests from booking the same resource and hour.

## Run locally

Use Node.js 24 or newer.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4173. Pick an available slot, enter a reservation name and confirm. Select the resulting reservation to cancel it. The schedule uses UTC and all slots last one hour. Set the optional `SLOTWISE_DB` environment variable to change the database path.

For live frontend edits, start the API with `npm start`, then run `npm run dev` in another terminal. Vite proxies API calls to port 4173.

## API

| Method and path | Behavior |
| --- | --- |
| `GET /api/schedule?day=2027-01-03` | List equipment, supported UTC hours and reservations for a date |
| `POST /api/bookings` | Reserve a slot using a JSON body with `resource`, `day`, `hour` and `label`. Returns 409 when occupied. |
| `DELETE /api/bookings/{id}` | Cancel a reservation |

The service binds to loopback and uses a shared demo schedule. It has no user accounts or network deployment configuration.

## Tests

Run `npm test` for HTTP integration coverage of invalid dates, overlapping requests, database persistence and cancellation. Run `npm run build` for TypeScript checking and the production build.
