# Failed deployment drill 2026-10-27T05:22:58.778Z

- [x] current release: /health 200 and /ready 200
- [x] new release without a database: process alive (/health 200)
- [x] new release without a database: NOT ready (/ready 503), so no traffic is switched
- [x] the 503 reveals no host, port, user or password
- [x] meanwhile the current release keeps serving (/ready 200)
- [x] new release missing a required variable exits at start (exit code 1) and never listens
- [x] and the current release is still ready

Result: PASSED
