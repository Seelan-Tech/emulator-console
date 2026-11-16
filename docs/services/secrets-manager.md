# Secrets Manager

![Secrets](../images/secret-detail.png#gh-light-mode-only)
![Secrets](../images/secret-detail-dark.png#gh-dark-mode-only)

## Secrets

**Secrets Manager** lists secrets with their last-changed time. Names may contain slashes (`app/db-password`). **Create secret** takes a name, a description and the **Secret value**. Secrets scheduled for deletion are hidden unless you switch on **Show secrets scheduled for deletion**.

## A secret

Open one to see its description, **Tags** and **Versions** with their **Stages** (`AWSCURRENT`, `AWSPREVIOUS`).

- **Reveal value** fetches the value and shows it; the value stays hidden until you ask. If it is JSON it is pretty-printed.
- **New version** stores a new value. The previous one becomes `AWSPREVIOUS`.
- **Tags** can be added and removed.

## Deleting and restoring

**Delete** offers two choices, each confirmed first:

- **Schedule deletion** with a recovery window in days. The secret shows as scheduled for deletion and cannot be read or changed until you press **Restore secret**.
- **Delete immediately** (force), with no recovery.

Secret values are never written to the activity log, and creating a secret in the console records the call as a fixture step _with the value in it_; see [Security](../security.md#fixtures-can-contain-secrets).
