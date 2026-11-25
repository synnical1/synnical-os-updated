use axum::{
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
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

    // Query the live database role and expiry on every request. Never trust a
    // role supplied by the browser or a role cached by a previous connection.
    let row = sqlx::query(
        r#"SELECT u.id AS user_id, u.role AS role
           FROM "Session" s
           INNER JOIN "User" u ON u.id = s.userId
           WHERE s.token = ? AND julianday(s.expiresAt) > julianday('now')
           LIMIT 1"#,
    )
    .bind(token)
    .fetch_optional(db)
    .await
    .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Session validation failed"))?;

    let Some(row) = row else {
        return Err(api_error(StatusCode::UNAUTHORIZED, "Session expired or not found"));
    };

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
    use super::{session_token, valid_session_token};
    use axum::http::{header, HeaderMap, HeaderValue};

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
