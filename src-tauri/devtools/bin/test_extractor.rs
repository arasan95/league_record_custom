use std::path::PathBuf;
#[path = "../wad/mod.rs"]
mod wad;

use wad::updater::extract_all_champions_to_json;

fn main() {
    let install_dir = PathBuf::from(r"C:\Riot Games\League of Legends");
    let output_path = std::env::temp_dir().join("tooltip_variable_fallback.json");
    
    match extract_all_champions_to_json(&install_dir, &output_path) {
        Ok(_) => println!("Successfully extracted champion JSONs!"),
        Err(e) => println!("Error: {}", e),
    }
}

