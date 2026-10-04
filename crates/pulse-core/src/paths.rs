//! Onde o Core guarda seus dados.
//!
//! Padrão: `%LOCALAPPDATA%\Pulse\data` (produção) ou `%LOCALAPPDATA%\Pulse-dev\data`
//! (desenvolvimento). `PULSE_DATA_DIR` sobrescreve. Nunca dentro do repositório.

use std::path::PathBuf;

use anyhow::{Context, Result};

pub fn data_dir(dev: bool) -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os("PULSE_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .context("variável LOCALAPPDATA não definida")?;
    let app = if dev { "Pulse-dev" } else { "Pulse" };
    Ok(base.join(app).join("data"))
}
