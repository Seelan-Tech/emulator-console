# The AWS Emulator, installed from AWS's RPM at a pinned version. `uname -m` is aarch64 or x86_64, exactly the
# suffix AWS uses in the package name, so one Dockerfile builds for Apple Silicon and for x86_64 CI runners.
#
# EMULATOR_VERSION is the only place the version lives. The "Emulator update" workflow opens a PR when AWS
# releases a newer one; CI (including every e2e suite) must pass before it is merged. See docs/emulator-setup.md.
ARG EMULATOR_VERSION=1.0.624

# Download the RPM and check AWS's detached GPG signature against the published key fingerprint.
FROM public.ecr.aws/amazonlinux/amazonlinux:2023 AS verify
ARG EMULATOR_VERSION
ARG AWS_KEY_FINGERPRINT="98BCF336A3BE53B734E967C52E5BF49BD940F624"
WORKDIR /pkg
RUN dnf install -y --setopt=install_weak_deps=False gnupg2-minimal \
    && dnf clean all
RUN set -eux; \
    base=https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS; \
    rpm="aws-emulator-${EMULATOR_VERSION}-1-$(uname -m).rpm"; \
    curl -fsSLO "$base/$rpm"; \
    curl -fsSLO "$base/$rpm.sig"; \
    curl -fsSLo key.asc https://downloads.aws.com/keys/gpg/current.asc; \
    gpg --batch --no-autostart --import key.asc; \
    gpg --batch --with-colons --fingerprint | grep -q "^fpr:::::::::${AWS_KEY_FINGERPRINT}:"; \
    gpg --batch --verify "$rpm.sig" "$rpm"; \
    mv "$rpm" aws-emulator.rpm

FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal
ARG EMULATOR_VERSION
COPY --from=verify /pkg/aws-emulator.rpm /tmp/aws-emulator.rpm
RUN rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm \
    && rpm -q aws-emulator | grep -F "aws-emulator-${EMULATOR_VERSION}-" \
    && mkdir -p /home/emulator && chown 1000 /home/emulator
LABEL aws-emulator.version="${EMULATOR_VERSION}"
COPY --chmod=0755 emulator-entrypoint.sh /usr/local/bin/emulator-entrypoint
USER 1000
ENV HOME=/home/emulator
EXPOSE 9297
ENTRYPOINT ["emulator-entrypoint", "-b", "0.0.0.0"]
