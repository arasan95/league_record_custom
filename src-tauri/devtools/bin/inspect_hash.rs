use std::collections::HashMap;

fn fnv1a_32(s: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn main() {
    let words = vec![
        "e0",
        "e1",
        "e2",
        "e3",
        "e4",
        "e5",
        "e6",
        "e7",
        "e8",
        "e9",
        "e10",
        "Effect1Amount",
        "Effect2Amount",
        "Effect3Amount",
        "Effect4Amount",
        "Effect5Amount",
        "Effect6Amount",
        "Effect7Amount",
        "Effect8Amount",
        "Effect9Amount",
        "Effect10Amount",
        "mEffect1Amount",
        "mEffect2Amount",
        "mEffect3Amount",
        "mEffect4Amount",
        "mEffect5Amount",
        "mEffect6Amount",
        "mEffect7Amount",
        "mEffect8Amount",
        "mEffect9Amount",
        "mEffect10Amount",
    ];

    for w in words {
        println!("{}: {{{:08x}}}", w, fnv1a_32(&w.to_lowercase()));
    }
}
