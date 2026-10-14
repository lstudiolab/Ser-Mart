# Ser mart

Ser mart is a minimalist storefront and seller dashboard built with HTML, CSS, JavaScript, and a Rust/Axum backend.

- Storefront: `/`
- Seller dashboard: `/admin` (password required; default for this deployment is configured as `password1`)
- Health check: `/api/health`

## Render

The service supports `DATABASE_URL` for PostgreSQL. Without it, it uses a local SQLite database for preview/testing; files on a free Render web service are ephemeral, so configure a persistent managed database before taking real orders. Never commit database credentials. `ADMIN_PASSWORD` is read from the environment.

## Local development

Install Rust stable, then run `cargo run`. By default the app creates `ser-mart.db` in its working directory. Set `DATABASE_URL` to a PostgreSQL URL for durable storage.
