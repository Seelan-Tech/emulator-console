# Running it locally

Emulator Console is a **local developer companion**: you run it on your own machine, next to your own emulator, while you build and test an application against it. It is not designed to be hosted, shared over a network or exposed to the internet. The emulator keeps everything in memory and is wiped on every restart, so there is nothing to host; the console exists to make that workflow comfortable.

This page covers what runs, health, the database file, upgrades and housekeeping.

## What runs

| Part | Notes |
| --- | --- |
| `console` | The console: one Node.js container with the pages and the JSON API. Its only state is one SQLite file on the `console-data` volume. |
| `emulator` | The AWS Emulator, a pinned and signature-checked release (built from `docker/emulator.Dockerfile`; see [Emulator setup](emulator-setup.md)). |

## Health

`GET /api/health` answers `200` when the app and its database are up, and `503` when the database cannot be used. The container image has a health check that uses it.

## Database

The console stores its targets, fixtures, run history and activity log in one SQLite file, `emulator-console.db`, in `DATA_DIR` (`/data` in the container, on the Compose volume `aws-emu_console-data`).

- **Migrations** are applied automatically the first time the console opens the database (the files are in `db/migrations`, numbered; the database records how far it got in `PRAGMA user_version`).
- **Backups.** The emulator's contents are not part of the database; they are rebuilt from fixtures. To keep a copy of your targets and fixtures, copy the file while the console is idle, or ask SQLite for a consistent copy:

  ```sh
  docker compose exec console node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/emulator-console.db').exec(\"vacuum into '/data/backup.db'\")"
  docker compose cp console:/data/backup.db ./emulator-console-backup.db
  ```

  Restore by stopping the console and putting the file back at `/data/emulator-console.db`.
- **Looking inside.** Copy the file out (as above) and open it in IntelliJ, DBeaver or `sqlite3`. Avoid writing to a copy that the console is using.
- **Retention.** The activity log keeps the newest 50,000 calls; older rows are dropped automatically.
- **Using your own folder.** Set `DATA_DIR` (and mount a volume or folder there) to put the file somewhere else.

## Upgrading

```sh
git pull
docker compose up -d --build
```

The new container applies any new migrations before it starts serving. Tagged releases are also published as multi-arch images at `ghcr.io/seelan-tech/emulator-console`; use `image:` instead of `build:` to run one.

Note that `docker compose up` recreates a container whose configuration changed. If the **emulator** container is recreated it loses its in-memory state, which is what [fixtures](fixtures.md) exist for. Rebuild only the console with `docker compose up -d --build --no-deps console`. The emulator version is pinned and upgraded deliberately: see [Emulator setup and versions](emulator-setup.md).

## Housekeeping jobs

One timer runs inside the console: the restart watcher (every 5 seconds, only for credential-files targets). It also makes sure the **Local emulator** target exists.
