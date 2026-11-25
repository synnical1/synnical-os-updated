use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::{auth::require_owner, AppState};

fn api_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn channel_decode_error(field: &'static str, error: sqlx::Error) -> Response {
    tracing::warn!(field, error = %error, "Could not decode Rust chat channel row");
    api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid")
}

fn message_decode_error(field: &'static str, error: sqlx::Error) -> Response {
    tracing::warn!(field, error = %error, "Could not decode Rust chat message row");
    api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid")
}

fn parse_allowed_roles(stored: &str) -> Vec<String> {
    const PUBLIC_ROLES: [&str; 5] = ["OWNER", "HEAD_ADMIN", "ADMIN", "MOD", "MEMBER"];
    if stored.trim().is_empty() {
        return PUBLIC_ROLES.iter().map(|role| (*role).to_owned()).collect();
    }
    serde_json::from_str::<Vec<String>>(stored).unwrap_or_default()
}

pub async fn channels(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, Response> {
    let _actor = require_owner(&headers, &state.db).await?;

    let rows = sqlx::query(
        r#"SELECT
             c.id, c.name,
             CAST(c.isDM AS INTEGER) AS isDM,
             CAST(c.isGroup AS INTEGER) AS isGroup,
             CAST(c.isAnnouncement AS INTEGER) AS isAnnouncement,
             CAST(c.allowedRoles AS TEXT) AS allowedRoles,
             c.creatorId,
             c.slowModeSeconds,
             CAST(c.createdAt AS TEXT) AS createdAt,
             COUNT(m.id) AS messageCount
           FROM "Channel" c
           LEFT JOIN "Message" m ON m.channelId = c.id
           WHERE c.isDM = 0 AND c.isGroup = 0
           GROUP BY c.id
           ORDER BY c.isAnnouncement DESC, c.createdAt ASC"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Could not load chat channels"))?;

    let mut channels = Vec::with_capacity(rows.len());
    for row in rows {
        let allowed_roles: String = row
            .try_get("allowedRoles")
            .map_err(|error| channel_decode_error("allowedRoles", error))?;
        let audience = if parse_allowed_roles(&allowed_roles)
            .iter()
            .any(|role| role == "MEMBER")
        {
            "MEMBERS"
        } else {
            "STAFF"
        };
        let message_count: i64 = row
            .try_get("messageCount")
            .map_err(|error| channel_decode_error("messageCount", error))?;

        channels.push(json!({
            "id": row.try_get::<String, _>("id").map_err(|error| channel_decode_error("id", error))?,
            "name": row.try_get::<String, _>("name").map_err(|error| channel_decode_error("name", error))?,
            "isDM": row.try_get::<i64, _>("isDM").map_err(|error| channel_decode_error("isDM", error))? != 0,
            "isGroup": row.try_get::<i64, _>("isGroup").map_err(|error| channel_decode_error("isGroup", error))? != 0,
            "isAnnouncement": row.try_get::<i64, _>("isAnnouncement").map_err(|error| channel_decode_error("isAnnouncement", error))? != 0,
            "allowedRoles": parse_allowed_roles(&allowed_roles),
            "audience": audience,
            "creatorId": row.try_get::<Option<String>, _>("creatorId").map_err(|error| channel_decode_error("creatorId", error))?,
            "slowModeSeconds": row.try_get::<i64, _>("slowModeSeconds").map_err(|error| channel_decode_error("slowModeSeconds", error))?,
            "createdAt": row.try_get::<String, _>("createdAt").map_err(|error| channel_decode_error("createdAt", error))?,
            "_count": { "messages": message_count }
        }));
    }

    Ok(Json(json!({ "channels": channels })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageQuery {
    channel_id: String,
    before: Option<String>,
}

pub async fn messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Value>, Response> {
    let actor = require_owner(&headers, &state.db).await?;
    let channel_id = query.channel_id.trim();
    if channel_id.is_empty() || channel_id.len() > 128 {
        return Err(api_error(StatusCode::BAD_REQUEST, "Invalid channelId"));
    }

    if let Some(before) = query.before.as_deref() {
        if chrono::DateTime::parse_from_rfc3339(before).is_err() {
            return Err(api_error(StatusCode::BAD_REQUEST, "Invalid cursor"));
        }
    }

    let channel = sqlx::query(
        r#"SELECT isDM, isGroup FROM "Channel" WHERE id = ? LIMIT 1"#,
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Could not check channel access"))?;

    let Some(channel) = channel else {
        return Err(api_error(StatusCode::NOT_FOUND, "Channel not found"));
    };
    let is_dm = channel
        .try_get::<i64, _>("isDM")
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))? != 0;
    let is_group = channel
        .try_get::<i64, _>("isGroup")
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))? != 0;

    if is_dm || is_group {
        let member = sqlx::query_scalar::<_, i64>(
            r#"SELECT 1 FROM "Membership" WHERE channelId = ? AND userId = ? LIMIT 1"#,
        )
        .bind(channel_id)
        .bind(&actor.user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Could not check channel membership"))?;
        if member.is_none() {
            return Err(api_error(StatusCode::FORBIDDEN, "You are not a member of this conversation"));
        }
    }

    let rows = sqlx::query(
        r#"SELECT
             m.id, m.channelId, m.userId, m.username, m.content, m.clientNonce,
             m.mentionedUserIds,
             CAST(m.deleted AS INTEGER) AS deleted,
             CAST(m.edited AS INTEGER) AS edited,
             CAST(m.editedAt AS TEXT) AS editedAt,
             m.gifUrl, m.imageUrl, m.voiceUrl, m.voiceTranscript, m.messageType,
             m.threadRootId, m.replyToId, m.replyToName, m.replyToContent,
             m.spoilerMediaType, m.spoilerMediaId, m.spoilerTitle,
             m.spoilerSeason, m.spoilerEpisode,
             CAST(m.spoilerUntil AS TEXT) AS spoilerUntil,
             CAST(m.createdAt AS TEXT) AS createdAt
           FROM "Message" m
           WHERE m.channelId = ? AND m.deleted = 0
             AND (? IS NULL OR julianday(m.createdAt) < julianday(?))
           ORDER BY m.createdAt DESC
           LIMIT 50"#,
    )
    .bind(channel_id)
    .bind(query.before.as_deref())
    .bind(query.before.as_deref())
    .fetch_all(&state.db)
    .await
    .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Could not load message history"))?;

    let mut messages = Vec::with_capacity(rows.len());
    for row in rows {
        let message = json!({
            "id": row.try_get::<String, _>("id").map_err(|error| message_decode_error("id", error))?,
            "channelId": row.try_get::<String, _>("channelId").map_err(|error| message_decode_error("channelId", error))?,
            "userId": row.try_get::<Option<String>, _>("userId").map_err(|error| message_decode_error("userId", error))?,
            "username": row.try_get::<String, _>("username").map_err(|error| message_decode_error("username", error))?,
            "content": row.try_get::<String, _>("content").map_err(|error| message_decode_error("content", error))?,
            "clientNonce": row.try_get::<Option<String>, _>("clientNonce").map_err(|error| message_decode_error("clientNonce", error))?,
            "mentionedUserIds": row.try_get::<String, _>("mentionedUserIds").map_err(|error| message_decode_error("mentionedUserIds", error))?,
            "deleted": row.try_get::<i64, _>("deleted").map_err(|error| message_decode_error("deleted", error))? != 0,
            "edited": row.try_get::<i64, _>("edited").map_err(|error| message_decode_error("edited", error))? != 0,
            "editedAt": row.try_get::<Option<String>, _>("editedAt").map_err(|error| message_decode_error("editedAt", error))?,
            "gifUrl": row.try_get::<Option<String>, _>("gifUrl").map_err(|error| message_decode_error("gifUrl", error))?,
            "imageUrl": row.try_get::<Option<String>, _>("imageUrl").map_err(|error| message_decode_error("imageUrl", error))?,
            "voiceUrl": row.try_get::<Option<String>, _>("voiceUrl").map_err(|error| message_decode_error("voiceUrl", error))?,
            "voiceTranscript": row.try_get::<Option<String>, _>("voiceTranscript").map_err(|error| message_decode_error("voiceTranscript", error))?,
            "messageType": row.try_get::<String, _>("messageType").map_err(|error| message_decode_error("messageType", error))?,
            "threadRootId": row.try_get::<Option<String>, _>("threadRootId").map_err(|error| message_decode_error("threadRootId", error))?,
            "replyToId": row.try_get::<Option<String>, _>("replyToId").map_err(|error| message_decode_error("replyToId", error))?,
            "replyToName": row.try_get::<Option<String>, _>("replyToName").map_err(|error| message_decode_error("replyToName", error))?,
            "replyToContent": row.try_get::<Option<String>, _>("replyToContent").map_err(|error| message_decode_error("replyToContent", error))?,
            "spoilerMediaType": row.try_get::<Option<String>, _>("spoilerMediaType").map_err(|error| message_decode_error("spoilerMediaType", error))?,
            "spoilerMediaId": row.try_get::<Option<String>, _>("spoilerMediaId").map_err(|error| message_decode_error("spoilerMediaId", error))?,
            "spoilerTitle": row.try_get::<Option<String>, _>("spoilerTitle").map_err(|error| message_decode_error("spoilerTitle", error))?,
            "spoilerSeason": row.try_get::<Option<i64>, _>("spoilerSeason").map_err(|error| message_decode_error("spoilerSeason", error))?,
            "spoilerEpisode": row.try_get::<Option<i64>, _>("spoilerEpisode").map_err(|error| message_decode_error("spoilerEpisode", error))?,
            "spoilerUntil": row.try_get::<Option<String>, _>("spoilerUntil").map_err(|error| message_decode_error("spoilerUntil", error))?,
            "createdAt": row.try_get::<String, _>("createdAt").map_err(|error| message_decode_error("createdAt", error))?
        });
        messages.push(message);
    }
    messages.reverse();

    Ok(Json(json!({ "messages": messages })))
}

#[cfg(test)]
mod tests {
    use super::parse_allowed_roles;

    #[test]
    fn malformed_channel_visibility_fails_closed() {
        assert!(parse_allowed_roles("not-json").is_empty());
        assert!(parse_allowed_roles("[]").is_empty());
    }

    #[test]
    fn legacy_empty_visibility_keeps_the_synnical_public_default() {
        let roles = parse_allowed_roles("");
        assert!(roles.contains(&"OWNER".to_owned()));
        assert!(roles.contains(&"MEMBER".to_owned()));
    }
}
