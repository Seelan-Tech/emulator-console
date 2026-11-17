# Emulator Console

A local web console for use with the [AWS Emulator](https://github.com/aws/aws-emulator): browse and change resources through native screens for S3, DynamoDB, SQS, Lambda, SNS and Secrets Manager, run any operation of 16 services from generated forms, **record** what you do as *fixtures*, and **replay** them to rebuild state. An *activity log* shows what changed.

![The target overview](docs/images/overview.png#gh-light-mode-only)
![The target overview](docs/images/overview-dark.png#gh-dark-mode-only)

**The problem.** The emulator keeps everything in memory: every restart wipes your resources, and its credentials change too.
**The answer.** Record your setup once. After a restart the console notices and replays a *baseline* fixture automatically, or with one click.

> **Scope.** Emulator Console is a developer tool for your own machine, next to your own emulator, while you build and test an application. It is not designed to be hosted, shared over a network or exposed to the internet.

## Quick start

You need Docker with Compose v2.

```sh
git clone https://github.com/Seelan-Tech/emulator-console.git
cd emulator-console
docker compose up -d --build     # builds and starts the emulator and the console
open http://127.0.0.1:3000       # the "Local emulator" target is ready
```

There is no login: every port is published on `127.0.0.1` only, and requests with any other `Host` header are refused. Set your own `APP_SECRET` before you store anything you care about. Press **Ctrl/Cmd+K** anywhere to jump to a page, resource or operation.

The stack builds the emulator image from AWS's own signed package at a pinned version (it is downloaded when you build, never redistributed here), and starts it with the emulator's anonymous telemetry **off**; see [Emulator setup](docs/emulator-setup.md#telemetry) to change that.

## Documentation

The full **[user guide](docs/index.md)** (these pages describe the latest release; `main` may be ahead). To read the guide for the version you run, open the repository at that release's tag (`https://github.com/Seelan-Tech/emulator-console/tree/v<version>/docs`); the **Help** button in the app does exactly that:

- [Getting started](docs/getting-started.md) and [concepts](docs/concepts.md)
- Service guides: [S3](docs/services/s3.md), [DynamoDB](docs/services/dynamodb.md), [SQS](docs/services/sqs.md), [Lambda](docs/services/lambda.md), [SNS](docs/services/sns.md), [Secrets Manager](docs/services/secrets-manager.md) and [the rest](docs/services/other-services.md)
- [Fixtures and replay](docs/fixtures.md) and [the command palette](docs/command-palette.md)
- [Emulator setup, versions and telemetry](docs/emulator-setup.md), [running it locally](docs/deployment.md) and [security](docs/security.md)
- [Configuration](docs/configuration.md), [API](docs/api.md) and [troubleshooting](docs/troubleshooting.md)
- [Developer guide](docs/developer-guide.md)

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and the [code of conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md).

```sh
npm ci && cp .env.example .env     # set APP_SECRET
npm run dev                        # the SQLite database is created in ./data
npm run verify                     # lint, format, types, tests, build
```

## License

[MIT](LICENSE), copyright Seelan Technologies LLC. The AWS Emulator is a separate project with its own license; this repository does not contain it.

## Disclaimer

Emulator Console is an independent open-source project. It is not affiliated with, endorsed by or sponsored by Amazon Web Services or Amazon.com, Inc. "AWS" and "Amazon Web Services" are trademarks of Amazon.com, Inc. or its affiliates; they are used here only to say what the project works with.

---

Maintained by [Seelan Technologies LLC](https://www.seelantech.com).
