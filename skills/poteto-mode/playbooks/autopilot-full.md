### Autopilot-full

> **Pi status:** Unavailable in this port.

The upstream workflow requires Graphite, cloud-agent lifecycle primitives, autonomous merges, and external mutations that conflict with this Pi setup. Do not select it.

Use the Feature or Multi-phase plan playbook with local `job` workers. Use Babysit for checks. Stop for explicit approval before every push, PR mutation, merge, deployment, or external message.
