pub fn fnv1a_32(s: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    let s_lower = s.to_lowercase();
    for b in s_lower.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

pub fn fnv1a_64(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    let s_lower = s.to_lowercase();
    for b in s_lower.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

// In case memory hashes are needed early
use std::collections::HashMap;

pub fn build_basic_hash_db() -> HashMap<u32, String> {
    let mut db = HashMap::new();
    // We can populate basic fields if needed,
    // but the actual .bin parser can just rely on the fallback structure and resolving IDs.
    // We will populate this from resource files later if advanced mapping is needed.
    db
}
