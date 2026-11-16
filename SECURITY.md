# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Report it privately through GitHub's *Report a vulnerability* button on this repository's **Security** tab (private vulnerability reporting), or email <info@seelantech.com>. Include what you found, how to reproduce it and the impact you expect. You can expect an acknowledgement within a few days and a fix or a decision within a reasonable time after that.

## Supported versions

Only the latest release receives security fixes.

## Scope

Emulator Console is a **local developer tool**, not a hosted service:

- It has **no login** by design. It is meant to run on your own machine, publishes its port on loopback only, and refuses requests whose `Host` header is not local (a DNS-rebinding defence). Exposing it to a network is unsupported, and reports that depend on doing so are out of scope.
- Target secrets are encrypted at rest with a key derived from `APP_SECRET`; set your own value.
- Fixtures are stored as plain JSON and can contain values you typed (for example a secret created through the console). Treat them like code.

In scope: anything that lets a web page or another local user reach, bypass or abuse those protections, that leaks stored credentials, or that is a flaw in how the console talks to the emulator.

The AWS Emulator itself is a separate AWS project; report problems with it to AWS (see its repository).
