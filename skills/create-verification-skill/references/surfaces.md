# Verification surfaces on Pi

Choose only a recipe supported by the project. Never claim a surface was verified through an unavailable driver.

## CLI and TUI

Prefer an existing expect, PTY, snapshot, or integration harness. Otherwise create a deterministic project-local PTY helper that:

1. starts the exact executable with isolated environment and data paths;
2. waits for a specific prompt or readiness pattern;
3. sends named inputs rather than timing-dependent key spam;
4. captures an unwrapped transcript, exit status, and produced files;
5. terminates only the child process group it created.

Use Herdr to drive a real terminal only when the user explicitly requests Herdr and `HERDR_ENV=1`; then follow the Herdr skill. Do not make a generated verification skill depend on the current focused pane.

## Browser, Electron, and web UI

Prefer the repository's Playwright, Cypress, Webdriver, or CDP harness. Launch an isolated profile and port, wait on a real readiness condition, use stable selectors, and capture both the action and resulting state. If no supported browser driver exists, report the gap and propose the smallest project-local harness; do not substitute HTTP calls for UI proof.

## HTTP service

Start an isolated server through a managed background shell job. Doctor it with a read-only health/version request. Drive the public HTTP contract with curl or the project's client. Capture request inputs, status, response body, relevant logs, and durable side effects. Stop the exact managed job during cleanup.

## Mobile or simulator

Use an existing project simulator harness and isolated device/profile. If required SDKs, images, credentials, or control tools are absent, report the concrete prerequisite. Simulator deletion and runtime cleanup require explicit approval.

## Proof contract

Every generated verification skill defines:

- **Launch:** exact command, isolation, readiness, and owned process identity.
- **Doctor:** read-only health and ownership check.
- **Drive:** real user-surface actions with stable handles.
- **Evidence:** action plus result, logs, exit status, and side effects.
- **Cleanup:** owned processes and scratch state only; evidence survives.

One driver owns shared mutable application state. Parallel source readers are fine; parallel drivers are not unless instances are fully isolated.
