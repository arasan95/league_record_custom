#[path = "../../src/wad/mod.rs"]
#[allow(dead_code)]
mod wad;

use std::fs;
use std::path::PathBuf;

use wad::updater::{extract_all_champions_to_json, get_league_install_dir};

fn main() {
    let install_dir = match get_league_install_dir() {
        Some(p) => p,
        None => {
            eprintln!("League install directory not found.");
            std::process::exit(1);
        }
    };

    let local_appdata = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .expect("LOCALAPPDATA is not set");
    let cache_dir = local_appdata.join("com.leaguerecord.custom").join("tooltip_cache");
    if let Err(e) = fs::create_dir_all(&cache_dir) {
        eprintln!("Failed to create cache dir: {e}");
        std::process::exit(1);
    }

    let output_path = cache_dir.join("tooltip_variable_fallback.json");
    println!("Rebuilding tooltip cache...");
    println!("  install_dir: {}", install_dir.display());
    println!("  output: {}", output_path.display());

    match extract_all_champions_to_json(&install_dir, &output_path) {
        Ok(()) => {
            println!("Done.");
            println!("  fallback: {}", output_path.display());
            println!("  formulas: {}", output_path.with_file_name("all_calc_formulas.json").display());
            println!("  slots: {}", output_path.with_file_name("champion_spell_slots.json").display());
        }
        Err(e) => {
            eprintln!("Failed: {e}");
            std::process::exit(1);
        }
    }
}
