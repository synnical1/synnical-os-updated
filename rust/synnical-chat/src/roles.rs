pub fn canonical_role(role: &str) -> &str {
    match role {
        "OWNER" => "OWNER",
        "ADMIN" | "HEAD_ADMIN" => "ADMIN",
        "MOD" => "MOD",
        _ => "MEMBER",
    }
}

pub fn is_owner(role: &str) -> bool {
    canonical_role(role) == "OWNER"
}

#[cfg(test)]
mod tests {
    use super::{canonical_role, is_owner};

    #[test]
    fn legacy_head_admin_is_not_owner() {
        assert_eq!(canonical_role("HEAD_ADMIN"), "ADMIN");
        assert!(!is_owner("HEAD_ADMIN"));
    }

    #[test]
    fn only_the_owner_role_can_open_chat() {
        for role in ["MEMBER", "MOD", "ADMIN", "HEAD_ADMIN", "UNKNOWN"] {
            assert!(!is_owner(role), "{role} must not receive owner chat access");
        }
        assert!(is_owner("OWNER"));
    }
}
