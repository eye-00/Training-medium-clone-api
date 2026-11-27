<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Request size limits

JSON and URL-encoded request bodies are limited to 100 KiB (102,400 bytes)
by the body parser. A larger body receives HTTP 413 before DTO validation.
The limit applies to the whole request body read by the parser, including JSON
syntax and other fields; UTF-8 characters can require multiple bytes.

Article `body` has a separate DTO limit of 100,000 characters after trimming.
Meeting that field limit does not guarantee the whole request fits within
100 KiB. Multipart avatar uploads use separate limits: one file of at most
2 MiB, with additional image validation.

## Project setup

```bash
$ pnpm install
```

Copy `.env.example` to `.env` and configure the MySQL connection, `REDIS_URL`,
and `JWT_SECRET` for the intended environment. `JWT_SECRET` must contain at
least 32 characters, have no surrounding whitespace, and differ from the
example placeholders. Use a securely generated secret and keep it private;
the example value is not accepted at startup.

Requests use the `/api` prefix. DTO validation transforms supported inputs and
rejects unknown properties. Malformed JSON receives HTTP 400 with the message
`Invalid JSON payload`; oversized parsed bodies receive HTTP 413.

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov

# static checks
$ pnpm run typecheck:test
$ pnpm run lint
```

### E2E database and coverage

Ask the local MySQL administrator to create an empty `medium_clone_e2e` schema
with `utf8mb4` and `utf8mb4_unicode_ci`, and grant `medium_e2e_user` privileges
only on `medium_clone_e2e.*`. The account needs schema migration privileges and
MySQL's `DROP` privilege on this schema for `TRUNCATE`. Create a local
`.env.e2e` file with the following settings:

```dotenv
NODE_ENV=test
DB_HOST=127.0.0.1
DB_PORT=3307
DB_DATABASE=medium_clone_e2e
DB_USERNAME=medium_e2e_user
DB_PASSWORD=<dedicated account password>
DB_TEST_SERVER_UUID=<value of SELECT @@server_uuid on the local test server>
E2E_TRUNCATE_DATABASE=medium_clone_e2e
REDIS_URL=redis://127.0.0.1:6380/2
JWT_SECRET=<generated test secret of at least 32 characters>
```

```bash
pnpm run build
pnpm run db:migrate:e2e
pnpm run test:e2e
pnpm run test:e2e test/auth-flow.e2e-spec.ts --coverage --coverage.include=src/auth/auth.controller.ts --coverage.include=src/auth/auth.service.ts --coverage.include=src/auth/guards/jwt-auth.guard.ts --coverage.include=src/auth/logout.controller.ts --coverage.reportsDirectory=coverage/e2e-auth
```

The runner uses a single worker and takes a MySQL lock for each suite. The
database name, account, and server UUID are checked before setup and again
before truncation. Existing rows at suite startup cause a failure so an
interrupted run can be investigated. Each test arranges fresh synthetic data
through its setup hook or fixture calls. After each case, the runner truncates
the eight application tables, restores foreign key checks on the same session,
and verifies that the tables are empty. Migration history is retained. The
older `.env.test` configuration is separate from this runner.

Redis DB 2 holds the test revocation keys. Auth tests remove only the keys they
create, and those keys also expire. Avatar tests use a temporary directory and
remove the files generated by each case. The C2 condition matrix and measured
E2E coverage are in [the PR6 E2E report](docs/pr6-e2e-coverage.md).

## Authentication and deployment

Access tokens use HS256 and expire after 15 minutes. Authenticated requests
check token revocation in Redis and fail with HTTP 503 if that check is
unavailable. Losing a blacklist entry through a Redis restart or eviction can
allow a previously revoked token to work again until it expires; plan Redis
persistence and eviction accordingly. The application does not currently
provide login or registration rate limiting; assess protections at the
deployment boundary.

Passwords are limited to 72 UTF-8 bytes for bcrypt. An over-limit registration
receives HTTP 400; login rejects it as invalid credentials with HTTP 401.

## Avatar storage

An avatar upload writes the new file before updating its database metadata. If
the transaction fails before its callback completes, the new file is removed
on a best-effort basis. If the callback completes but the transaction reports an
error, the commit outcome may be unknown; both old and new files are retained
to avoid deleting a file that may be referenced by a committed transaction.
This can leave an orphan file if the transaction actually rolled back, and
requires a separate, careful reconciliation process.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It installs `@nestjs/observe`, wires it into `AppModule` and `main.ts`, and writes the app key and secret into `.env`, which every `nest start` script (`start`, `start:dev`, `start:debug`) then loads. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand:

```bash
$ pnpm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/sdk) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
