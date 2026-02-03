use crate::credentials::*;
use crate::error::*;
use std::path::Path;
use std::time::{Duration, Instant};
use std::{env, fs, thread};

pub fn try_get_credentials() -> Result<Credentials> {
    let lockfile =
        Path::new(&env::var("LOCALAPPDATA")?).join("Riot Games/Riot Client/Config/lockfile");
    if lockfile.exists() {
        let lockfile_content = fs::read_to_string(&lockfile)?;
        // the lockfile gets created and then after a short time written to
        if !lockfile_content.is_empty() {
            return Credentials::try_from(lockfile_content);
        }
    }

    Err(Error::ApiNotRunning)
}

pub fn get_credentials_blocking() -> Result<Credentials> {
    get_credentials_interal(None)
}

pub fn get_credentials_timeout(timeout: Duration) -> Result<Credentials> {
    get_credentials_interal(Some(timeout))
}

fn get_credentials_interal(timeout: Option<Duration>) -> Result<Credentials> {
    let timeout = timeout.unwrap_or(Duration::MAX);

    let now = Instant::now();
    while now.elapsed() < timeout {
        match try_get_credentials() {
            Err(Error::ApiNotRunning) => {}
            result => return result,
        }

        thread::sleep(Duration::from_secs(1));
    }

    Err(Error::Timeout)
}
