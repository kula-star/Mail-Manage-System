# Mail Address Management System

A local MongoDB-backed address book for organizing contacts, tracking replies, and reviewing activity.

## Requirements

- Node.js 20.19+ or 22.12+
- MongoDB Community Server running locally on `mongodb://127.0.0.1:27017`, or another MongoDB URI

## Run locally

1. Install MongoDB Community Server and start the MongoDB service.
2. Copy `.env.example` to `.env`. Replace `JWT_SECRET` with a long random secret; set `MONGODB_URI` if MongoDB is listening elsewhere.
3. Install dependencies and run the API and frontend together:

```powershell
npm.cmd install
npm.cmd run dev
```

The `dev` command starts both the API (port 3001) and Vite (normally port 5173). Open the Vite URL printed in the terminal. Create an account using the signup code configured by `SIGNUP_CODE` (default: `goldluck`). The API connects to the local MongoDB database `mail_manage_system` by default. `npm.cmd run dev:frontend` starts only Vite and cannot handle signup or data requests by itself.

## Features

- Server-side signup/sign-in with bcrypt password hashes and JWT-authenticated API requests.
- MongoDB storage for users, addresses, countries, and activity history.
- Add addresses manually or import a CSV with `email` and `country` columns; duplicates are skipped and reported.
- Add/remove country names from the Address Book. A country assigned to a contact cannot be removed until its contacts are moved or deleted.
- Export an inclusive 1-based address range to a CSV containing email values only, without a header or country column.
- Sort the address and history tables by their column headers, and export selected addresses to email-only CSV.
- Choose 10, 25, 50, 100, or all rows per page in the address and history tables.
- Remove all addresses for the signed-in account after confirmation; the action is recorded once in history.
- Show the full date and time on address-added and activity-history records.
- Mark addresses as replied; review country changes, manual adds, CSV import summaries, removals, outputs, and replies in history. Clear history without deleting addresses.
- Paginate address and history tables with Previous/Next controls or direct page-number entry.
- Choose daily, weekly, or monthly overview activity charts.
- CSV imports map unrecognized countries to `Other` and create one summary history entry with row, added, duplicate, and invalid-email counts.
- Filter history by date/country and view country distribution charts.

## Address API

The API tab documents and tests the unauthenticated endpoint `POST /v1/addmailaddress`. Send `email`, optional `country`, and `ownerEmail` as JSON or multipart form-data. `ownerEmail` may be omitted only when the database contains exactly one account; alternatively set `PUBLIC_API_OWNER_EMAIL`. No Authorization header is checked. Blank or unknown countries are saved as `Other`. Duplicate addresses return HTTP 409. Because this route is public, anyone who can reach it can add an address to the selected account.

```json
{
	"email": "example@et.com",
	"country": "united states",
	"ownerEmail": "account@example.com"
}
```

Multipart form-data fields use the same names: `email` and `country`.

## CSV format

Imports require headers named `email` and `country` (header capitalization and surrounding whitespace are ignored). Imported country names must exist in the account's country list. Exports contain one email per row, with no header.

## Configuration

Copy `.env.example` to `.env` and set `MONGODB_URI`, `JWT_SECRET`, and optionally `SIGNUP_CODE` before starting the API. `.env` is ignored by Git. The server exits with a clear error if it cannot connect to MongoDB.

The prior browser-only prototype stored contacts in localStorage; those old records are not automatically migrated. Only the new MongoDB API stores and serves account data. The browser keeps the signed-in JWT and email identifier so it can authenticate API requests.