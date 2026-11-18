# 📚 ao1code's SemesterOS

A student planning app that brings syllabi, assignments, study sessions, grades,
and workload into one semester plan.

---

## Features

* Upload PDF syllabi and review extracted course and assignment details
* Track assignments, exams, due dates, grade weights, and milestones
* See upcoming work and a suggested next step on the overview
* Plan study sessions around deadlines and personal availability
* View busy and lighter weeks in a semester workload heatmap
* Explore schedule changes with the What If simulator
* Track course grades when enough grading information is available
* Ask questions about saved course information
* Import and export calendar files in `.ics` format
* Use a public demo without authentication, a database, or provider keys

Notifications are deferred from the initial release and remain disabled.

---

## Tech Stack

**Frontend**

* React and TypeScript
* Vite
* Wouter routing
* Lucide icons and custom CSS

**Backend and data**

* Node.js and Express
* PostgreSQL with Drizzle ORM
* Clerk authentication for private accounts
* Zod schemas for request and response validation

**AI and documents**

* Gemini for syllabus extraction and signed-in syllabus questions
* Server-side PDF text extraction

**Tooling**

* pnpm workspace
* TypeScript checks and Node test runner

---

## Installation

### Prerequisites

* Node.js **22.18+** or **24 LTS**
* pnpm **10**
* PostgreSQL **16+** for private account features

### Run the demo

From the project root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://localhost:5173**. The public demo works without a database or
API credentials. Demo changes stay in the current browser.

### Enable private accounts and AI

Copy `.env.example` to `.env` and add your own provider settings. Never commit
`.env` or put server secrets in frontend code.

For private accounts, configure a PostgreSQL database and your own Clerk
application. For a fresh, empty local database, set
`CLERK_DATA_MIGRATION=empty-new-tenant` and apply the schema:

```bash
pnpm db:push
```

Add `GEMINI_API_KEY` to enable AI features. Google Calendar is optional and
requires its own OAuth setup. See [SETUP.md](SETUP.md) for environment variables,
database setup, OAuth callbacks, and hosting instructions.

---

## Useful Commands

```bash
pnpm test       # Run frontend and API tests
pnpm typecheck  # Type-check workspace packages
pnpm build      # Build the web app and API
pnpm start      # Run the production server
pnpm smoke      # Run isolated portability checks
```

The production server serves the web app and API together on port **3001** by
default. Set `PORT` to use a different port.
