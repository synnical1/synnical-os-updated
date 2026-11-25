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
             c.id, c.name, c.isDM, c.isGroup, c.isAnnouncement,
             c.allowedRoles, c.creatorId, c.slowModeSeconds, c.createdAt,
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
            .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))?;
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
            .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))?;

        channels.push(json!({
            "id": row.try_get::<String, _>("id").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))?,
            "name": row.try_get::<String, _>("name").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))?,
            "isDM": row.try_get::<i64, _>("isDM").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))? != 0,
            "isGroup": row.try_get::<i64, _>("isGroup").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))? != 0,
            "isAnnouncement": row.try_get::<i64, _>("isAnnouncement").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))? != 0,
            "allowedRoles": parse_allowed_roles(&allowed_roles),
            "audience": audience,
            "creatorId": row.try_get::<Option<String>, _>("creatorId").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))?,
            "slowModeSeconds": row.try_get::<i64, _>("slowModeSeconds").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))?,
            "createdAt": row.try_get::<String, _>("createdAt").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Channel data is invalid"))?,
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
             m.mentionedUserIds, m.deleted, m.edited, m.editedAt, m.gifUrl,
             m.imageUrl, m.voiceUrl, m.voiceTranscript, m.messageType,
             m.threadRootId, m.replyToId, m.replyToName, m.replyToContent,
             m.spoilerMediaType, m.spoilerMediaId, m.spoilerTitle,
             m.spoilerSeason, m.spoilerEpisode, m.spoilerUntil, m.createdAt
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
            "id": row.try_get::<String, _>("id").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "channelId": row.try_get::<String, _>("channelId").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "userId": row.try_get::<Option<String>, _>("userId").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "username": row.try_get::<String, _>("username").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "content": row.try_get::<String, _>("content").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "clientNonce": row.try_get::<Option<String>, _>("clientNonce").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "mentionedUserIds": row.try_get::<String, _>("mentionedUserIds").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "deleted": row.try_get::<i64, _>("deleted").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))? != 0,
            "edited": row.try_get::<i64, _>("edited").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))? != 0,
            "editedAt": row.try_get::<Option<String>, _>("editedAt").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "gifUrl": row.try_get::<Option<String>, _>("gifUrl").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "imageUrl": row.try_get::<Option<String>, _>("imageUrl").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "voiceUrl": row.try_get::<Option<String>, _>("voiceUrl").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "voiceTranscript": row.try_get::<Option<String>, _>("voiceTranscript").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "messageType": row.try_get::<String, _>("messageType").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "threadRootId": row.try_get::<Option<String>, _>("threadRootId").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "replyToId": row.try_get::<Option<String>, _>("replyToId").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "replyToName": row.try_get::<Option<String>, _>("replyToName").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "replyToContent": row.try_get::<Option<String>, _>("replyToContent").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "spoilerMediaType": row.try_get::<Option<String>, _>("spoilerMediaType").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "spoilerMediaId": row.try_get::<Option<String>, _>("spoilerMediaId").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "spoilerTitle": row.try_get::<Option<String>, _>("spoilerTitle").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "spoilerSeason": row.try_get::<Option<i64>, _>("spoilerSeason").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "spoilerEpisode": row.try_get::<Option<i64>, _>("spoilerEpisode").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "spoilerUntil": row.try_get::<Option<String>, _>("spoilerUntil").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?,
            "createdAt": row.try_get::<String, _>("createdAt").map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Message data is invalid"))?
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
