# Emulator Console user guide

Emulator Console is a web app for operating the AWS Emulator: browse and edit S3, DynamoDB, SQS, Lambda, SNS and Secrets Manager, run any other operation from generated forms, record what you do as **fixtures**, and replay them when the emulator restarts and loses its state.

![The target overview](images/overview.png#gh-light-mode-only)
![The target overview](images/overview-dark.png#gh-dark-mode-only)

> **Scope.** This is a **local developer companion**: you run it on your own machine, next to your own emulator, while you build and test an application against it. It is not designed to be hosted, shared over a network or exposed to the internet. The emulator keeps everything in memory and is wiped on every restart, so there is nothing to host; the console exists to make that workflow comfortable.

## Where to start

| If you want to…                                               | Read                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Get it running in five minutes                                | [Getting started](getting-started.md)                                                                                                                                                                                                     |
| Understand targets, fixtures and restart recovery | [Concepts](concepts.md)                                                                                                                                                                                                                   |
| Work with a service                                           | [S3](services/s3.md) · [DynamoDB](services/dynamodb.md) · [SQS](services/sqs.md) · [Lambda](services/lambda.md) · [SNS](services/sns.md) · [Secrets Manager](services/secrets-manager.md) · [Everything else](services/other-services.md) |
| Move around quickly                                           | [Command palette](command-palette.md)                                                                                                                                                                                                     |
| Rebuild your emulator after a restart                         | [Fixtures and replay](fixtures.md)                                                                                                                                                                                                        |
| Set up or upgrade the emulator                                | [Emulator setup and versions](emulator-setup.md)                                                                                                          |
| Run and maintain it on your machine                           | [Running it locally](deployment.md) · [Security](security.md) |
| Look something up                                             | [Configuration reference](configuration.md) · [API reference](api.md) · [Troubleshooting](troubleshooting.md)                                                                                                                             |
| Change the code                                               | [Developer guide](developer-guide.md)                                                                                                                                                                                                     |

## The problem it solves

The AWS Emulator keeps everything in memory, so every restart wipes your buckets, tables, queues and functions. Its access keys are regenerated on every start, too. The console gives you three things on top of that:

1. **Screens** for the services you use daily, so you are not typing `aws` commands to see what is in a queue.
2. **A recorder** that turns what you do in the UI into a replayable recipe.
3. **Restart recovery**: the console notices the restart and puts your setup back, automatically or with one click.

## Independent project

Emulator Console is an independent open-source project. It is not affiliated with, endorsed by or sponsored by Amazon Web Services or Amazon.com, Inc. "AWS" and "Amazon Web Services" are trademarks of Amazon.com, Inc. or its affiliates; they are used here only to say what the project works with. The [license](../LICENSE) is MIT.

Emulator Console is maintained by [Seelan Technologies LLC](https://www.seelantech.com). Questions that do not fit an issue: <info@seelantech.com>.
