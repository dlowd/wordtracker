# wordtracker

Word tracker for NaNoWriMo and other writing sprints.

## Development

The app now runs as a Vite project located in `wordtracker-vite/`.

```bash
cd wordtracker-vite
npm install
npm run dev
```

By default the dev server runs on `http://localhost:5173`.

### Environment variables

Create a `.env.local` file based on `.env.example` to configure Supabase:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

The app will gracefully fall back to local-only mode when Supabase is not configured.

## Build

```
npm run build
```

Outputs a static bundle in `wordtracker-vite/dist/`.
