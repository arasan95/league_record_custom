use std::{env, io, num::ParseIntError, result};

pub type Result<T> = result::Result<T, Error>;

#[cfg(not(target_os = "windows"))]
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Riot API is currently not available")]
    ApiNotRunning,
    #[error("blocking wait for Riot API ran into timeout")]
    Timeout,
}

#[cfg(target_os = "windows")]
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Riot API is currently not available")]
    ApiNotRunning,
    #[error("blocking wait for Riot API ran into timeout")]
    Timeout,
    #[error("unable to parse credentials")]
    ParseCredentials,
    #[error("unable to parse credential port")]
    ParseCredentialsPort(#[from] ParseIntError),
    #[error("unable to read file")]
    Io(#[from] io::Error),
    #[error("unable to get path to lockfile")]
    LockfilePath(#[from] env::VarError),
    #[error("unable to get install info from Riot API")]
    InstallInfoReq(#[from] Box<ureq::Error>),
    #[error("unable to get parse install info from Riot API")]
    InstallInfoParse(io::Error),
}
