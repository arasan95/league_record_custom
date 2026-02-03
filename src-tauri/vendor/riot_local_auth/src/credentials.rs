use crate::error::Error;
use base64::prelude::*;
use std::result;

#[derive(Debug, Clone)]
pub struct Credentials {
    pub token: String,
    pub port: u16,
}

impl Credentials {
    pub fn basic_auth(&self) -> String {
        format!(
            "Basic {}",
            BASE64_STANDARD.encode(format!("riot:{}", self.token))
        )
    }
}

impl TryFrom<String> for Credentials {
    type Error = Error;

    fn try_from(value: String) -> result::Result<Self, Self::Error> {
        let mut parts = value.splitn(5, ':');
        let _pname = parts.next().ok_or(Error::ParseCredentials)?;
        let _pid = parts.next().ok_or(Error::ParseCredentials)?;
        let port = parts
            .next()
            .ok_or(Error::ParseCredentials)
            .and_then(|port| port.parse::<u16>().map_err(Error::ParseCredentialsPort))?;
        let token = parts.next().ok_or(Error::ParseCredentials)?.to_string();
        let _protocol = parts.next().ok_or(Error::ParseCredentials)?;
        Ok(Self { token, port })
    }
}
