# Getting started

## Requirements

- Docker with Compose v2. The stack runs the emulator (a pinned release, see [Emulator setup](emulator-setup.md)), and the console.
- About 2 GB of free disk for images. Rebuilding adds Docker build cache; see [Troubleshooting](troubleshooting.md#no-space-left-on-device).
- To develop on the console itself you also need Node.js 24 and npm; see the [developer guide](developer-guide.md).

## Run it

```sh
git clone https://github.com/Seelan-Tech/emulator-console.git
cd emulator-console
docker compose up -d --build
```

Open <http://127.0.0.1:3000>. There is no login, and a target called **Local emulator** is ready.

| Port | What                                                                       | Override with   |
| ---- | -------------------------------------------------------------------------- | --------------- |
| 3000 | The console                                                                | `CONSOLE_PORT` |
| 9297 | The emulator (HTTPS, SigV4)                                                | `EMU_PORT`      |

Every port is published on `127.0.0.1` only. Set `APP_SECRET` to your own long random value before you store anything you care about; the default in `compose.yaml` is for local use.

## Stop, reset and uninstall

- **Stop:** `docker compose down`. Your targets and fixtures survive (they live in the `console-data` volume); the emulator's contents do not, which is what [fixtures](fixtures.md) are for.
- **Start again:** `docker compose up -d`.
- **Update:** `git pull`, then `docker compose up -d --build`. This rebuilds both images and recreates the emulator, so its state is reset; see [Running it locally](deployment.md#upgrading) to rebuild only the console.
- **Reset the console** (forget all targets and fixtures): `docker compose down -v`.
- **Uninstall:** `docker compose down -v --rmi local`, then delete the folder. The emulator also keeps its credentials and a version file in `~/.aws/emulator/`; delete that folder if you no longer need it.

## Who can reach it

The console has no login: it is a tool for your own machine. Every port is published on `127.0.0.1` only, and the console refuses requests whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]` (this defeats DNS-rebinding attacks from a web page). Its target reads the emulator's own credential files. See [Security](security.md).

## A first five minutes

1. **Look around.** The [overview](concepts.md#targets) shows the connection and which of the emulator's 16 services answered.
2. **Create something.** Open **S3**, choose **Create bucket**, name it `demo-assets`, and drop a file onto the page. See [S3](services/s3.md).
3. **Watch the recorder.** The bar at the bottom of every target page now says **1 step**. It captured the bucket you created.
4. **Save it as a fixture.** Press **Save as fixture**, call it `demo-setup`.
5. **Break it on purpose.** Restart the emulator: `docker compose restart emulator`. The bucket is gone, and a banner appears at the top.
6. **Put it back.** Open the target's settings (the gear in the header), choose `demo-setup` as the **baseline fixture**, and press **Replay** in the banner. Better, switch on **Replay automatically after a restart** and restart again; the bucket returns without you touching anything.

![The restart banner](images/restart-banner.png#gh-light-mode-only)
![The restart banner](images/restart-banner-dark.png#gh-dark-mode-only)

## Using the AWS CLI alongside the console

The emulator writes its credentials, CA and AWS config to `~/.aws/emulator/9297/` on your machine. Point the CLI at it:

```sh
export AWS_ENDPOINT_URL=https://127.0.0.1:9297 \
  AWS_SHARED_CREDENTIALS_FILE=~/.aws/emulator/9297/emulator_credentials \
  AWS_CONFIG_FILE=~/.aws/emulator/9297/config \
  AWS_CA_BUNDLE=~/.aws/emulator/9297/ca.pem \
  AWS_EC2_METADATA_DISABLED=true AWS_DISABLE_HOST_PREFIX_INJECTION=true \
  AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
aws s3 ls
```

Anything you create with the CLI shows up in the console, and the other way round. The CLI is not recorded, though; only actions taken in the console are.
