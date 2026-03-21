# CampusPark App

A full-stack campus parking web application for a U.S. university setting.

## Features

- Password-based sign-in and student sign-up
- Live parking space list with zone filtering and status display
- EV charging spaces with labels and an "EV only" filter
- Simulated real-time parking data stream that updates space availability every 30 seconds
- Reservation flow with arrival time, duration, license plate, and phone number
- Validation for time conflicts, past-time reservations, plate format, and phone format
- Reservation management with cancel and JSON export
- Dashboard stats for total spaces, available spaces, and today's reservations
- Admin tools for adding spaces and enabling or disabling spaces

## Tech Stack

- Frontend: `index.html` + `styles.css` + `app.js`
- Backend: `server.js` using native Node.js `http`
- Data store: `data/db.json` for local JSON persistence

## Run Locally

1. Install Node.js 18 or later.
2. In the project directory, run `npm start`.
3. Open `http://localhost:3000` in your browser.

## Prisma Setup

1. Install dependencies: `npm install prisma @prisma/client`
2. Generate the Prisma client: `npm run prisma:generate`
3. Push the schema to Supabase Postgres: `npm run prisma:push`
4. Seed parking data from `parking_data.csv`: `npm run prisma:seed`

## Concurrency Test

After Prisma is connected and the database is seeded, run:

`npm run test:concurrency`

This will force one parking location to `availableSpots = 1` and simulate two users attempting to reserve the last remaining spot at the same time.

## Accounts

- Default admin username: `admin`
- Default admin password: `admin123`
- Student accounts can be created from the frontend using `Student Sign Up`
- Students can reserve, cancel, and export their own reservations
- Admins can also add spaces and enable or disable spaces

## Files

- `index.html`: layout for auth, filters, parking spaces, admin tools, and reservation dialog
- `styles.css`: styling, responsive layout, and component appearance
- `app.js`: frontend state handling and API calls
- `server.js`: backend routes, auth, conflict validation, and static file serving
- `data/db.json`: parking spaces, reservations, sessions, and users

## Main Endpoints

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/logout`
- `GET /api/session`
- `GET /api/spots?zone=all&at=ISO_TIME`
- `POST /api/spots` for admins
- `PATCH /api/spots/:id/toggle` for admins
- `GET /api/bookings/me`
- `POST /api/bookings`
- `DELETE /api/bookings/:id`
- `GET /api/bookings/me/export`
- `GET /api/stats?at=ISO_TIME`
