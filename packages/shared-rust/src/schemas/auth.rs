//! Authentication schemas
//! Port of packages/shared/src/schemas/auth.ts

use serde::{Deserialize, Serialize};

/// Magic link request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MagicLinkRequest {
    pub email: String,
}

/// Magic link response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MagicLinkResponse {
    pub message: String,
    /// In dev mode, we include the token for testing
    #[serde(rename = "devToken", skip_serializing_if = "Option::is_none")]
    pub dev_token: Option<String>,
    /// In dev mode, we include the code for testing
    #[serde(rename = "devCode", skip_serializing_if = "Option::is_none")]
    pub dev_code: Option<String>,
}

/// Verify token request (for GET /verify with full token)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyTokenRequest {
    pub token: String,
}

/// Verify code request (for POST /verify-code with 6-digit code)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyCodeRequest {
    pub email: String,
    pub code: String,
}

/// User info in auth response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    #[serde(rename = "_id")]
    pub id: String,
    pub email: String,
    #[serde(rename = "displayName", skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// Authentication response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    pub user: AuthUser,
}

/// JWT payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwtPayload {
    pub sub: String,
    pub email: String,
    pub iat: i64,
    pub exp: i64,
}

/// Error response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
