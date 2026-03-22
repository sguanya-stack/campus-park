# CampusPark

CampusPark is a full-stack parking reservation platform built around the Seattle South Lake Union urban campus ecosystem. It is designed as an O2O parking experience: users discover nearby garages online, reserve a spot, navigate to the physical location, check in with a paper ticket, and complete settlement when exiting.

This project is built with Vanilla JS on the frontend and a Node.js + Prisma + PostgreSQL backend, and is deployed on Render.

## Highlights

- User-first parking discovery flow with a split-screen search layout
- Separate user, reservations, login, and admin experiences
- Live parking inventory with search, zone filters, and EV-only filtering
- Google Maps integration path for location preview and navigation
- Reservation lifecycle with real-world status transitions:
  `PENDING -> ACTIVE -> COMPLETED`
- Ticket digitization via 6-digit paper ticket check-in
- Checkout settlement with parking duration and final amount
- Admin-facing operations view for inventory and activity
- Traffic simulation with `node-cron` to make demo inventory feel realistic
- PWA shell with `manifest.json` and `service-worker.js`

## Product Flow

### Normal user

1. Open the discover page
2. Browse parking results on the left and map on the right
3. Filter by zone, arrival time, duration, and EV availability
4. Reserve a spot
5. Navigate to the garage
6. Check in with the physical ticket code
7. View reservations in `My Reservations`
8. Check out and settle when leaving

### Admin

Admins sign in separately and can access an admin console with inventory and operational stats without cluttering the normal user flow.

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js HTTP server
- ORM: Prisma
- Database: PostgreSQL
- Scheduling: `node-cron`
- Deployment: Render
- Maps: Google Maps JavaScript API + Geocoding API

## Project Structure

- [index.html](/Users/Zhuanz/Desktop/app/index.html): app shell, route views, dialogs, and templates
- [styles.css](/Users/Zhuanz/Desktop/app/styles.css): UI system, responsive layout, glassmorphism styling
- [app.js](/Users/Zhuanz/Desktop/app/app.js): frontend state, routing, rendering, booking flows, map logic
- [server.js](/Users/Zhuanz/Desktop/app/server.js): API routes, auth, reservations, traffic simulation, static serving
- [prisma/schema.prisma](/Users/Zhuanz/Desktop/app/prisma/schema.prisma): database schema
- [prisma/seed.js](/Users/Zhuanz/Desktop/app/prisma/seed.js): seed script for parking data
- [manifest.json](/Users/Zhuanz/Desktop/app/manifest.json): PWA metadata
- [service-worker.js](/Users/Zhuanz/Desktop/app/service-worker.js): PWA service worker

## Main Features

### 1. Parking discovery

- Search by landmark or address
- Filter by zone
- Choose arrival time and duration
- Toggle EV-only results
- Compare availability and price directly in result cards

### 2. Reservations

- Create a reservation for a parking spot
- Validate reservation conflicts
- View current and past reservations
- Cancel bookings
- Export reservation data

### 3. Ticket digitization

Users can convert a physical paper garage ticket into a digital state transition:

- `POST /api/check-in`
- Accepts a 6-digit ticket code
- Moves reservation status from `PENDING` to `ACTIVE`
- Stores `ticketCode`
- Records `checkInTime`

### 4. Checkout settlement

- `POST /api/check-out`
- Validates active booking
- Calculates final amount
- Records `checkOutTime`
- Moves reservation status to `COMPLETED`

### 5. Traffic simulation

The app includes a cron-driven occupancy simulator so demo inventory does not look static.

- Runs every 15 minutes
- Uses Seattle local time
- Simulates rush-hour pressure
- Applies jitter for more organic availability changes
- Caps occupancy for demo-friendly availability

### 6. Navigation and O2O handoff

- Google Maps directions deep-linking from the selected parking spot
- Intended to bridge online discovery to offline arrival

### 7. PWA support

- Installable app shell
- Manifest and service worker support
- Mobile home-screen installation flow

## Routes

- `/` - Discover parking
- `/login` - Sign in / sign up
- `/reservations` - My reservations
- `/admin` - Admin console

## Core API Endpoints

### Auth

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/logout`
- `GET /api/session`

### Parking

- `GET /api/spots`
- `GET /api/recommend`
- `POST /api/spots`
- `PATCH /api/spots/:id/toggle`

### Reservations

- `GET /api/bookings/me`
- `GET /api/bookings/me/export`
- `POST /api/bookings`
- `DELETE /api/bookings/:id`
- `POST /api/check-in`
- `POST /api/check-out`

### Stats

- `GET /api/stats`

## Reservation Status Model

The Prisma schema includes:

- `PENDING`
- `ACTIVE`
- `COMPLETED`
- `CONFIRMED`
- `CANCELLED`
- `EXPIRED`

`Reservation` also stores:

- `ticketCode`
- `checkInTime`
- `checkOutTime`
- `finalAmount`

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file with your PostgreSQL connection:

```env
DATABASE_URL="postgresql://..."
```

If you are using Supabase with Render, a pooled connection string is recommended.

### 3. Generate Prisma client

```bash
npm run prisma:generate
```

### 4. Push schema

```bash
npm run prisma:push
```

### 5. Seed data

```bash
npm run prisma:seed
```

### 6. Start the app

```bash
npm start
```

Then open:

```txt
http://localhost:3000
```

## Google Maps Setup

To enable the real map instead of the visual fallback layer:

1. Create a Google Cloud project
2. Enable:
   - Maps JavaScript API
   - Geocoding API
3. Create an API key
4. Add HTTP referrer restrictions
5. Put the key into [index.html](/Users/Zhuanz/Desktop/app/index.html):

```html
<meta name="google-maps-api-key" content="YOUR_GOOGLE_MAPS_API_KEY" />
```

Recommended referrers:

- `https://campus-park.onrender.com/*`
- `http://localhost:*/*`

## Deployment Notes

This project is intended for Render deployment.

Recommended production checklist:

- Set `DATABASE_URL`
- Run Prisma generate during build
- Ensure schema is pushed before using new reservation fields
- Add Google Maps API key if map rendering is enabled
- Add PWA icons:
  - `icon-192.png`
  - `icon-512.png`

## Default Admin Account

- Username: `admin`
- Password: `admin123`

## Concurrency Test

To run the reservation concurrency test:

```bash
npm run test:concurrency
```

## Portfolio Positioning

CampusPark is intentionally scoped as a practical urban-campus parking product rather than a generic dashboard. The focus is on:

- decision-first user experience
- O2O service flow
- operational realism
- deployable full-stack architecture

## Future Improvements

- Move Google Maps API key injection to server-side env configuration
- Add stronger admin analytics and trend charts
- Add better mobile bottom-sheet interactions
- Replace geocoding-on-render with stored coordinates in the database
- Add usage telemetry and search analytics
