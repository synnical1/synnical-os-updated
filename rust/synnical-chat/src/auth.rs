use axum::{
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::json;
use sqlx::{Row, SqlitePool};

use crate::roles::is_owner;

#[derive(Debug, Clone)]
pub struct Actor {
    pub user_id: String,
    pub role: String,
}

fn api_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn valid_session_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_session_expiry(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
        .or_else(|| {
            DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f%:z")
                .ok()
                .map(|value| value.with_timezone(&Utc))
        })
        .or_else(|| {
            DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%:z")
                .ok()
                .map(|value| value.with_timezone(&Utc))
        })
        .or_else(|| {
            DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f%:z")
                .ok()
                .map(|value| value.with_timezone(&Utc))
        })
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f")
                .ok()
                .map(|value| value.and_utc())
        })
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|value| value.and_utc())
        })
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers.get(header::AUTHORIZATION) {
        let value = value.to_str().ok()?.trim();
        let mut parts = value.split_ascii_whitespace();
        if !parts.next()?.eq_ignore_ascii_case("Bearer") {
            return None;
        }
        let token = parts.next()?;
        if parts.next().is_some() {
            return None;
        }
        return valid_session_token(token).then(|| token.to_ascii_lowercase());
    }

    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie_header.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        if name != "stratus_session" {
            return None;
        }
        let token = value.trim();
        valid_session_token(token).then(|| token.to_ascii_lowercase())
    })
}

pub async fn require_owner(headers: &HeaderMap, db: &SqlitePool) -> Result<Actor, Response> {
    let token = session_token(headers)
        .ok_or_else(|| api_error(StatusCode::UNAUTHORIZED, "Unauthorized"))?;

    // First resolve the exact token against the live SQLite session table.
    // Expiry is parsed in Rust because Prisma's SQLite DateTime text format
    // varies between RFC3339 and SQLite's "YYYY-MM-DD HH:MM:SS.sss" form.
    let row = sqlx::query(
        r#"SELECT u.id AS user_id, u.role AS role, s.expiresAt AS expires_at
           FROM "Session" s
           INNER JOIN "User" u ON u.id = s.userId
           WHERE s.token = ?
           LIMIT 1"#,
    )
    .bind(token)
    .fetch_optional(db)
    .await
    .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Session validation failed"))?;

    let Some(row) = row else {
        let session_count = sqlx::query_scalar::<_, i64>(r#"SELECT COUNT(*) FROM "Session""#)
            .fetch_one(db)
            .await
            .unwrap_or(-1);
        tracing::warn!(sessions_in_database = session_count, "No database session matched the supplied Synnical token");
        return Err(api_error(StatusCode::UNAUTHORIZED, "Session expired or not found"));
    };

    let expires_at: String = row
        .try_get("expires_at")
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Session expiry is invalid"))?;
    let Some(expiry) = parse_session_expiry(&expires_at) else {
        tracing::warn!(expires_at = %expires_at, "Unrecognized Prisma SQLite session expiry format");
        return Err(api_error(StatusCode::INTERNAL_SERVER_ERROR, "Session expiry is invalid"));
    };
    if expiry <= Utc::now() {
        return Err(api_error(StatusCode::UNAUTHORIZED, "Session expired or not found"));
    }

    let actor = Actor {
        user_id: row
            .try_get("user_id")
            .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Session data is invalid"))?,
        role: row
            .try_get("role")
            .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Session data is invalid"))?,
    };

    if !is_owner(&actor.role) {
        return Err(api_error(StatusCode::FORBIDDEN, "Chat is available only to the owner"));
    }
    Ok(actor)
}

#[cfg(test)]
mod tests {
    use super::{parse_session_expiry, session_token, valid_session_token};
    use axum::http::{header, HeaderMap, HeaderValue};

    #[test]
    fn parses_prisma_sqlite_and_rfc3339_expiry_values() {
        assert!(parse_session_expiry("2026-11-25 10:23:09.123").is_some());
        assert!(parse_session_expiry("2026-11-25T10:23:09.123Z").is_some());
        assert!(parse_session_expiry("2026-11-25 10:23:09.123+00:00").is_some());
        assert!(parse_session_expiry("2026-11-25 10:23:09+00:00").is_some());
        assert!(parse_session_expiry("not-a-date").is_none());
    }

    #[test]
    fn accepts_only_the_synnical_64_character_session_token() {
        assert!(valid_session_token(&"a".repeat(64)));
        assert!(!valid_session_token(&"g".repeat(64)));
        assert!(!valid_session_token(&"a".repeat(63)));
        assert!(!valid_session_token(&"a".repeat(65)));
    }

    #[test]
    fn reads_the_existing_synnical_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("theme=dark; stratus_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
        assert_eq!(session_token(&headers), Some("a".repeat(64)));
    }

    #[test]
    fn bearer_auth_matches_the_existing_svg_session_contract() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
        );
        assert_eq!(session_token(&headers), Some("b".repeat(64)));
    }

    #[test]
    fn malformed_authorization_does_not_fall_back_to_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Basic invalid"));
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("stratus_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
        assert_eq!(session_token(&headers), None);
    }
}
