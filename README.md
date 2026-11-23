# MentorLagbe Server

## Setup

1. Install the server dependencies with `npm install`.
2. Add the environment variables you have configured to the server's `.env` file.
3. Start the development server with `npm run dev`, or start it with `npm start`.
4. Run the server tests with `npm test`.

The API listens on port `5000` by default. Set `PORT` to use another valid port.
`CORS_ORIGINS` is a comma-separated list of website origins, including protocol
but no path. Local development defaults to the two localhost origins on port
`3000`. Production must explicitly set `CORS_ORIGINS`.

Do not commit `.env` or put real credentials in this README.

## Current server functionality

- Express starts with `npm run dev` and `npm start`.
- `GET /` keeps the existing server status response.
- `GET /health` reports whether the HTTP application is running.
- CORS allows requests without an `Origin` header and requests from configured
  origins. Other origins receive a JSON `403` response.
- Unknown routes return JSON `404` responses, and malformed JSON returns JSON
  `400` responses.

The health endpoint checks the HTTP process only. MongoDB connectivity, domain
API routes, Better Auth/JWT API authorization, Stripe payment processing, and
seed data have not been implemented in this server yet.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port; defaults to `5000`. |
| `NODE_ENV` | No | Set to `production` for production behavior. |
| `CORS_ORIGINS` | Production | Comma-separated allowed website origins. Local development defaults to localhost port `3000`. |
