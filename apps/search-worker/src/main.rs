mod embedder;
mod error;
mod vectors;

use base64::{engine::general_purpose::STANDARD, Engine};
use embedder::{EmbedderConfig, QueryEmbedder};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;
use vectors::{VectorMatrix, DIM};

const MAX_MESSAGE: usize = 4 * 1024 * 1024;
const MAX_CACHE: usize = 1024 * 1024 * 1024;
struct Owner {
    version: i64,
    vectors: VectorMatrix,
    used: u64,
}
#[derive(Deserialize)]
struct Entry {
    id: String,
    vector: String,
}
#[derive(Deserialize)]
struct Scope {
    owner: String,
    version: i64,
    ids: Vec<String>,
}

fn serve(
    model: &QueryEmbedder,
    mut input: impl BufRead,
    output: &mut impl Write,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut owners: HashMap<String, Owner> = HashMap::new();
    let mut clock: u64 = 0;
    loop {
        // Bounded reads: an invalid peer cannot make us allocate an unbounded line.
        let mut bytes = Vec::new();
        let mut take = input.by_ref().take((MAX_MESSAGE + 1) as u64);
        let count = take.read_until(b'\n', &mut bytes)?;
        if count == 0 {
            break;
        }
        if count > MAX_MESSAGE {
            return Err("search request exceeds protocol limit".into());
        }
        let request: Value = serde_json::from_slice(&bytes)?;
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        clock += 1;
        let response = (|| -> Result<Value, Box<dyn std::error::Error>> {
            match request["op"].as_str().unwrap_or("") {
                "ping" => Ok(
                    json!({"protocol":1,"dimensions":DIM,"generation":"bge-m3-5617a9f-cls-l2-512-v1"}),
                ),
                "chunks" => Ok(
                    json!({"chunks":model.chunks(request["header"].as_str().unwrap_or(""), request["text"].as_str().unwrap_or(""))?}),
                ),
                "embed" => {
                    let text = request["text"].as_str().ok_or("text is required")?;
                    if text.len() > 100_000 {
                        return Err("embedding input too large".into());
                    }
                    let vector = model.embed(text)?;
                    let bytes: Vec<u8> = vector.iter().flat_map(|n| n.to_le_bytes()).collect();
                    Ok(json!({"vector":STANDARD.encode(bytes)}))
                }
                "begin" => {
                    let owner = request["owner"]
                        .as_str()
                        .ok_or("owner required")?
                        .to_owned();
                    owners.insert(
                        owner,
                        Owner {
                            version: -1,
                            vectors: VectorMatrix::default(),
                            used: clock,
                        },
                    );
                    Ok(json!({"ok":true}))
                }
                "load" => {
                    let key = request["owner"].as_str().ok_or("owner required")?;
                    let entries: Vec<Entry> = serde_json::from_value(request["entries"].clone())?;
                    if entries.len() > 128 {
                        return Err("vector load batch exceeds 128".into());
                    }
                    let incoming = entries.len() * DIM * 4;
                    while owners
                        .values()
                        .map(|v| v.vectors.len() * DIM * 4)
                        .sum::<usize>()
                        + incoming
                        > MAX_CACHE
                    {
                        let victim = owners
                            .iter()
                            .filter(|(name, _)| name.as_str() != key)
                            .min_by_key(|(_, value)| value.used)
                            .map(|(name, _)| name.clone());
                        if let Some(victim) = victim {
                            owners.remove(&victim);
                        } else {
                            owners.remove(key);
                            return Err("owner exceeds vector cache budget".into());
                        }
                    }
                    let owner = owners.get_mut(key).ok_or("cache load has not begun")?;
                    for entry in entries {
                        let raw = STANDARD.decode(entry.vector)?;
                        if raw.len() != DIM * 4 {
                            return Err("invalid vector byte length".into());
                        }
                        let values: Vec<f32> = raw
                            .chunks_exact(4)
                            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                            .collect();
                        if values.iter().any(|n| !n.is_finite()) {
                            return Err("non-finite vector".into());
                        }
                        owner.vectors.upsert(&entry.id, &values)?;
                    }
                    owner.used = clock;
                    Ok(json!({"ok":true}))
                }
                "finish" => {
                    let owner = owners
                        .get_mut(request["owner"].as_str().ok_or("owner required")?)
                        .ok_or("cache missing")?;
                    owner.version = request["version"].as_i64().ok_or("version required")?;
                    Ok(json!({"ok":true}))
                }
                "search" => {
                    let scopes: Vec<Scope> = serde_json::from_value(request["scopes"].clone())?;
                    if scopes.len() > 100 {
                        return Err("too many owner scopes".into());
                    }
                    let k = request["limit"].as_u64().unwrap_or(100).min(1000) as usize;
                    let query = model.embed(request["text"].as_str().ok_or("query required")?)?;
                    let mut hits = Vec::new();
                    for scope in scopes {
                        let owner = owners.get_mut(&scope.owner).ok_or("cache_missing")?;
                        if owner.version != scope.version {
                            return Err("cache_version".into());
                        }
                        owner.used = clock;
                        let allowed: HashSet<String> = scope.ids.into_iter().collect();
                        hits.extend(owner.vectors.nearest_allowed(&query, k, &allowed)?);
                    }
                    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
                    hits.truncate(k);
                    Ok(
                        json!({"hits":hits.iter().map(|h|json!({"id":h.id,"score":h.score})).collect::<Vec<_>>()}),
                    )
                }
                _ => Err("unknown operation".into()),
            }
        })();
        let wire = match response {
            Ok(value) => json!({"id":id,"value":value}),
            Err(err) => json!({"id":id,"error":err.to_string()}),
        };
        writeln!(output, "{}", serde_json::to_string(&wire)?)?;
        output.flush()?;
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let threads = std::env::var("SEARCH_THREADS")
        .unwrap_or_else(|_| "2".into())
        .parse::<usize>()?;
    if threads == 0 || threads > 16 {
        return Err("SEARCH_THREADS must be between 1 and 16".into());
    }
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build_global()?;
    let model = QueryEmbedder::open(&EmbedderConfig {
        model_cache_dir: PathBuf::from(
            std::env::var("SEARCH_MODEL_CACHE").unwrap_or_else(|_| "./storage/models".into()),
        ),
        ort_dylib_path: std::env::var_os("ORT_DYLIB_PATH").map(PathBuf::from),
        intra_threads: Some(threads),
    })?;
    eprintln!("Just Maple search model ready (protocol 1, bge-m3, 1024 dimensions)");
    #[cfg(unix)]
    if let Some(path) = std::env::var_os("SEARCH_WORKER_SOCKET") {
        use std::os::unix::fs::{FileTypeExt, PermissionsExt};
        use std::os::unix::net::{UnixListener, UnixStream};
        let path = PathBuf::from(path);
        if path.exists() {
            if UnixStream::connect(&path).is_ok() {
                return Err("search socket already active".into());
            }
            if !std::fs::symlink_metadata(&path)?.file_type().is_socket() {
                return Err("search socket path is not a socket".into());
            }
            std::fs::remove_file(&path)?;
        }
        let listener = UnixListener::bind(&path)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        for stream in listener.incoming() {
            let mut stream = stream?;
            let reader = io::BufReader::new(stream.try_clone()?);
            if serve(&model, reader, &mut stream).is_err() {
                eprintln!("search connection closed");
            }
        }
        return Ok(());
    }
    serve(&model, io::stdin().lock(), &mut io::stdout().lock())
}
