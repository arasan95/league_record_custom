use byteorder::{LittleEndian, ReadBytesExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Cursor, Read};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BinValue {
    Empty(Vec<u16>),
    Bool(bool),
    U8(u8),
    I8(i8),
    U16(u16),
    I16(i16),
    U32(u32),
    I32(i32),
    U64(u64),
    I64(i64),
    Float(f32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
    Mtx44([[f32; 4]; 4]),
    Rgba { r: u8, g: u8, b: u8, a: u8 },
    String(String),
    Hash(String), // resolved hash or raw formatted string
    Path(String),
    Flag(u8),
    Link(String),
    List(Vec<BinValue>),
    Struct(HashMap<String, BinValue>),
    Embedded(HashMap<String, BinValue>),
    Option(Option<Box<BinValue>>),
    Map(HashMap<String, BinValue>),
}

pub struct BinReader<'a> {
    pub cursor: Cursor<&'a [u8]>,
    pub db: &'a HashMap<u32, String>,
}

impl<'a> BinReader<'a> {
    pub fn new(data: &'a [u8], db: &'a HashMap<u32, String>) -> Self {
        Self { cursor: Cursor::new(data), db }
    }

    pub fn hash_name(&self, h: u32) -> String {
        self.db.get(&h).cloned().unwrap_or_else(|| {
            // For known hashes like fnv1a_32, we just return the hex if unknown
            format!("{{{:08x}}}", h)
        })
    }

    pub fn path_name(&self, h: u64) -> String {
        format!("{{{:016x}}}", h)
    }

    pub fn read_string(&mut self) -> Result<String, anyhow::Error> {
        let length = self.cursor.read_u16::<LittleEndian>()?;
        let mut buf = vec![0u8; length as usize];
        self.cursor.read_exact(&mut buf)?;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    pub fn read_value(&mut self, t: u8) -> Result<BinValue, anyhow::Error> {
        match t {
            0 => {
                // EMPTY
                let mut buf = vec![0u16; 3];
                for i in 0..3 {
                    buf[i] = self.cursor.read_u16::<LittleEndian>()?;
                }
                Ok(BinValue::Empty(buf))
            }
            1 => Ok(BinValue::Bool(self.cursor.read_u8()? != 0)),
            2 => Ok(BinValue::I8(self.cursor.read_i8()?)),
            3 => Ok(BinValue::U8(self.cursor.read_u8()?)),
            4 => Ok(BinValue::I16(self.cursor.read_i16::<LittleEndian>()?)),
            5 => Ok(BinValue::U16(self.cursor.read_u16::<LittleEndian>()?)),
            6 => Ok(BinValue::I32(self.cursor.read_i32::<LittleEndian>()?)),
            7 => Ok(BinValue::U32(self.cursor.read_u32::<LittleEndian>()?)),
            8 => Ok(BinValue::I64(self.cursor.read_i64::<LittleEndian>()?)),
            9 => Ok(BinValue::U64(self.cursor.read_u64::<LittleEndian>()?)),
            10 => Ok(BinValue::Float(self.cursor.read_f32::<LittleEndian>()?)),
            11 => {
                // VEC2
                let x = self.cursor.read_f32::<LittleEndian>()?;
                let y = self.cursor.read_f32::<LittleEndian>()?;
                Ok(BinValue::Vec2([x, y]))
            }
            12 => {
                // VEC3
                let x = self.cursor.read_f32::<LittleEndian>()?;
                let y = self.cursor.read_f32::<LittleEndian>()?;
                let z = self.cursor.read_f32::<LittleEndian>()?;
                Ok(BinValue::Vec3([x, y, z]))
            }
            13 => {
                // VEC4
                let x = self.cursor.read_f32::<LittleEndian>()?;
                let y = self.cursor.read_f32::<LittleEndian>()?;
                let z = self.cursor.read_f32::<LittleEndian>()?;
                let w = self.cursor.read_f32::<LittleEndian>()?;
                Ok(BinValue::Vec4([x, y, z, w]))
            }
            14 => {
                // MTX44
                let mut m = [[0f32; 4]; 4];
                for i in 0..4 {
                    for j in 0..4 {
                        m[i][j] = self.cursor.read_f32::<LittleEndian>()?;
                    }
                }
                Ok(BinValue::Mtx44(m))
            }
            15 => {
                // RGBA
                Ok(BinValue::Rgba {
                    r: self.cursor.read_u8()?,
                    g: self.cursor.read_u8()?,
                    b: self.cursor.read_u8()?,
                    a: self.cursor.read_u8()?,
                })
            }
            16 => Ok(BinValue::String(self.read_string()?)),
            17 => {
                // HASH
                let h = self.cursor.read_u32::<LittleEndian>()?;
                Ok(BinValue::Hash(self.hash_name(h)))
            }
            18 => {
                // PATH
                let h = self.cursor.read_u64::<LittleEndian>()?;
                Ok(BinValue::Path(self.path_name(h)))
            }
            0x80 | 0x81 => {
                // LIST / LIST2
                let vtype = self.cursor.read_u8()?;
                let _size = self.cursor.read_u32::<LittleEndian>()?;
                let count = self.cursor.read_u32::<LittleEndian>()?;
                if count > 100_000 {
                    return Err(anyhow::anyhow!("List count too large: {}", count));
                }
                let mut arr = Vec::with_capacity(count as usize);
                for _ in 0..count {
                    arr.push(self.read_value(vtype)?);
                }
                Ok(BinValue::List(arr))
            }
            0x82 => {
                // STRUCT
                let htype = self.cursor.read_u32::<LittleEndian>()?;
                if htype == 0 {
                    return Ok(BinValue::Struct(HashMap::new()));
                }
                let _size = self.cursor.read_u32::<LittleEndian>()?;
                let count = self.cursor.read_u16::<LittleEndian>()?;
                let mut obj = HashMap::new();
                obj.insert("__type".to_string(), BinValue::Hash(self.hash_name(htype)));
                for _ in 0..count {
                    let (k, v) = self.read_field()?;
                    obj.insert(k, v);
                }
                Ok(BinValue::Struct(obj))
            }
            0x83 => {
                // EMBEDDED
                let htype = self.cursor.read_u32::<LittleEndian>()?;
                let _size = self.cursor.read_u32::<LittleEndian>()?;
                let count = self.cursor.read_u16::<LittleEndian>()?;
                let mut obj = HashMap::new();
                obj.insert("__type".to_string(), BinValue::Hash(self.hash_name(htype)));
                for _ in 0..count {
                    let (k, v) = self.read_field()?;
                    obj.insert(k, v);
                }
                Ok(BinValue::Embedded(obj))
            }
            0x84 => {
                // LINK
                let h = self.cursor.read_u32::<LittleEndian>()?;
                Ok(BinValue::Link(self.hash_name(h)))
            }
            0x85 => {
                // OPTION
                let vtype = self.cursor.read_u8()?;
                let has_value = self.cursor.read_u8()? != 0;
                if has_value {
                    Ok(BinValue::Option(Some(Box::new(self.read_value(vtype)?))))
                } else {
                    Ok(BinValue::Option(None))
                }
            }
            0x86 => {
                // MAP
                let ktype = self.cursor.read_u8()?;
                let vtype = self.cursor.read_u8()?;
                let _size = self.cursor.read_u32::<LittleEndian>()?;
                let count = self.cursor.read_u32::<LittleEndian>()?;
                if count > 100_000 {
                    return Err(anyhow::anyhow!("Map count too large: {}", count));
                }
                let mut m = HashMap::new();
                for _ in 0..count {
                    let k = self.read_value(ktype)?;
                    let v = self.read_value(vtype)?;
                    // Keys in map are typically strings or hashes
                    let k_str = match k {
                        BinValue::String(s) => s,
                        BinValue::Hash(s) => s,
                        BinValue::U32(n) => n.to_string(),
                        BinValue::I32(n) => n.to_string(),
                        BinValue::U8(n) => n.to_string(),
                        BinValue::Path(p) => p,
                        _ => format!("{:?}", k),
                    };
                    m.insert(k_str, v);
                }
                Ok(BinValue::Map(m))
            }
            0x87 => Ok(BinValue::Flag(self.cursor.read_u8()?)),
            _ => Err(anyhow::anyhow!("Unknown type: 0x{:02x}", t)),
        }
    }

    pub fn read_field(&mut self) -> Result<(String, BinValue), anyhow::Error> {
        let hname = self.cursor.read_u32::<LittleEndian>()?;
        let ftype = self.cursor.read_u8()?;
        let name = self.hash_name(hname);
        let value = self.read_value(ftype)?;
        Ok((name, value))
    }

    pub fn read_entry(&mut self, htype: u32) -> Result<(String, BinValue), anyhow::Error> {
        let _length = self.cursor.read_u32::<LittleEndian>()?;
        let hpath = self.cursor.read_u32::<LittleEndian>()?;
        let count = self.cursor.read_u16::<LittleEndian>()?;

        let mut fields = HashMap::new();
        fields.insert("__type".to_string(), BinValue::Hash(self.hash_name(htype)));
        for _ in 0..count {
            let (k, v) = self.read_field()?;
            fields.insert(k, v);
        }

        let entry_key = self.hash_name(hpath);
        Ok((entry_key, BinValue::Struct(fields)))
    }
}

pub fn parse_prop(data: &[u8], db: &HashMap<u32, String>) -> Result<HashMap<String, BinValue>, anyhow::Error> {
    let mut reader = BinReader::new(data, db);

    let mut magic = [0u8; 4];
    reader.cursor.read_exact(&mut magic)?;
    let is_patch = magic == *b"PTCH";

    if is_patch {
        let _ = reader.cursor.read_u32::<LittleEndian>()?;
        let _ = reader.cursor.read_u32::<LittleEndian>()?;
        reader.cursor.read_exact(&mut magic)?;
    }

    if magic != *b"PROP" {
        return Err(anyhow::anyhow!("Invalid PROP magic: {:?}", magic));
    }

    let version = reader.cursor.read_u32::<LittleEndian>()?;
    let mut linked = Vec::new();
    if version >= 2 {
        let count = reader.cursor.read_u32::<LittleEndian>()?;
        for _ in 0..count {
            linked.push(reader.read_string()?);
        }
    }

    let entry_count = reader.cursor.read_u32::<LittleEndian>()?;
    let mut entry_types = Vec::with_capacity(entry_count as usize);
    for _ in 0..entry_count {
        entry_types.push(reader.cursor.read_u32::<LittleEndian>()?);
    }

    let mut result = HashMap::new();
    for htype in entry_types {
        match reader.read_entry(htype) {
            Ok((key, fields)) => {
                result.insert(key, fields);
            }
            Err(e) => {
                // Log and break? The Python script breaks.
                log::warn!("PROP parse error midway: {:?}", e);
                break;
            }
        }
    }

    if !linked.is_empty() {
        let linked_vals: Vec<BinValue> = linked.into_iter().map(BinValue::String).collect();
        result.insert("__linked".to_string(), BinValue::List(linked_vals));
    }

    Ok(result)
}
