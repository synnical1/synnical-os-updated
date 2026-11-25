mod auth;
mod chat;
mod roles;

use anyhow::{Context, Result};
use axum::{routing::get, Json, Router};
use serde_json::json;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{env, str::FromStr, time::Duration};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
}

fn sqlx_database_url(value: &str) -> Result<String> {
    if value.starts_with("sqlite:") {
        return Ok(value.to_owned());
    }
    if let Some(path) = value.strip_prefix("file:") {
        if path.is_empty() {
            anyhow::bail!("DATABASE_URL file path is empty");
        }
        return Ok(format!("sqlite://{path}"));
    }
    anyhow::bail!("DATABASE_URL must use the Prisma SQLite file: or SQLx sqlite: format");
}

async fn health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .map_err(|_| axum::http::StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(json!({
        "ok": true,
        "service": "synnical-rust-chat",
        "version": env!("CARGO_PKG_VERSION")
    })))
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with_target(false)
        .try_init()
        .ok();

    let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let connect_url = sqlx_database_url(&database_url)?;
    let options = SqliteConnectOptions::from_str(&connect_url)
        .context("DATABASE_URL is not a valid SQLite URL")?
        .create_if_missing(false)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .min_connections(1)
        .connect_with(options)
        .await
        .context("could not connect to the existing Synnical SQLite database")?;

    let bind_address = env::var("SYNNICAL_RUST_CHAT_BIND")
        .unwrap_or_else(|_| "127.0.0.1:4401".to_owned());
    let listener = TcpListener::bind(&bind_address)
        .await
        .with_context(|| format!("could not bind Rust chat service to {bind_address}"))?;

    let state = AppState { db };
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/chat/channels", get(chat::channels))
        .route("/v1/chat/messages", get(chat::messages))
        .with_state(state);

    tracing::info!(address = %bind_address, "Synnical Rust chat service listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("Rust chat HTTP server stopped unexpectedly")?;
    Ok(())
}
