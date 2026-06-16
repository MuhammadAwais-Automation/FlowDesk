# Contributing

Thanks for helping improve FlowDesk.

## Development

```bash
npm install
npm run dev
```

## Quality Checks

Run these before opening a pull request:

```bash
npm test
npm run build
```

## Local-First Rule

FlowDesk should work without a hosted database or required cloud account. New
features should default to local storage and make any networked service optional.

## Security Rule

Do not commit secrets, `.env` files, cookies, tokens, or user data. Keep remote
content isolated behind Electron's preload bridge.

## Pull Requests

- Keep changes focused.
- Include tests for data helpers, business logic, and risky behavior.
- Update docs when user-facing behavior changes.
- Mention any migration impact for existing local data.
