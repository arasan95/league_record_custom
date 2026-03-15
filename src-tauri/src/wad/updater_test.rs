use std::path::PathBuf;
use crate::wad::updater::extract_all_champions_to_json;

#[test]
fn test_extractor() {
    let install_dir = PathBuf::from(r"C:\Riot Games\League of Legends");
    let output_path = std::env::temp_dir().join("tooltip_variable_fallback.json");
    extract_all_champions_to_json(&install_dir, &output_path).unwrap();
}
