//! Local Y.js snapshots compatible with the web whiteboard's elements/layers maps.
use anyhow::{bail, Context, Result};
use maple_shared::{ShapeElement, StrokeElement, TextElement, WhiteboardElement};
use serde_json::Value;
use std::collections::HashSet;
use yrs::{
    types::ToJson, updates::decoder::Decode, Any, Array, ArrayPrelim, Doc, In, Map, MapPrelim, Out,
    ReadTxn, StateVector, Transact, Update,
};

fn document(bytes: Option<&[u8]>) -> Result<Doc> {
    let doc = Doc::new();
    doc.get_or_insert_map("elements");
    doc.get_or_insert_map("metadata");
    doc.get_or_insert_array("layers");
    if let Some(bytes) = bytes {
        doc.transact_mut()
            .apply_update(Update::decode_v1(bytes).context("Invalid whiteboard snapshot")?)?;
    }
    Ok(doc)
}

fn json(value: Any) -> Result<Value> {
    let mut text = String::new();
    value.to_json(&mut text);
    Ok(serde_json::from_str(&text)?)
}

pub fn elements(bytes: &[u8]) -> Result<Vec<WhiteboardElement>> {
    let doc = document(Some(bytes))?;
    let map = doc.get_or_insert_map("elements");
    let layers = doc.get_or_insert_array("layers");
    let txn = doc.transact();
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    for layer in layers.iter(&txn) {
        let layer = json(layer.to_json(&txn))?;
        let visible = layer
            .get("visible")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        if let Some(order) = layer.get("elements").and_then(Value::as_array) {
            for id in order.iter().filter_map(Value::as_str) {
                // Hidden-layer members remain accounted for so the orphan fallback
                // cannot accidentally reveal them.
                if seen.insert(id.to_owned()) && visible {
                    ids.push(id.to_owned());
                }
            }
        }
    }
    let mut unlayered: Vec<_> = map
        .keys(&txn)
        .filter(|id| !seen.contains(*id))
        .map(str::to_owned)
        .collect();
    unlayered.sort();
    ids.extend(unlayered);
    let mut result = Vec::new();
    for id in ids {
        let Some(value) = map.get(&txn, &id) else {
            continue;
        };
        let value = json(value.to_json(&txn))?;
        // Decode the concrete variant: the shared structs also carry their own type field.
        let element = match value.get("type").and_then(Value::as_str) {
            Some("stroke") => {
                WhiteboardElement::Stroke(serde_json::from_value::<StrokeElement>(value)?)
            }
            Some("shape") => {
                WhiteboardElement::Shape(serde_json::from_value::<ShapeElement>(value)?)
            }
            Some("text") => WhiteboardElement::Text(serde_json::from_value::<TextElement>(value)?),
            _ => continue, // Future element types stay in the original document on save.
        };
        result.push(element);
    }
    Ok(result)
}

fn input(value: Value) -> Result<In> {
    Ok(match value {
        Value::Object(fields) => In::Map(
            fields
                .into_iter()
                .map(|(k, v)| Ok((k, input(v)?)))
                .collect::<Result<MapPrelim>>()?,
        ),
        Value::Array(items) => In::Array(
            items
                .into_iter()
                .map(|v| Ok(In::Any(Any::from_json(&v.to_string())?)))
                .collect::<Result<ArrayPrelim>>()?,
        ),
        other => In::Any(Any::from_json(&other.to_string())?),
    })
}

/// Add newly drawn elements without replacing existing CRDT state or unknown fields.
/// This screen currently creates strokes; it does not edit/delete existing elements.
pub fn append(bytes: Option<&[u8]>, additions: &[WhiteboardElement]) -> Result<Vec<u8>> {
    let doc = document(bytes)?;
    let map = doc.get_or_insert_map("elements");
    let layers = doc.get_or_insert_array("layers");
    let metadata = doc.get_or_insert_map("metadata");
    {
        let mut txn = doc.transact_mut();
        if layers.len(&txn) == 0 {
            let id = uuid::Uuid::new_v4().to_string();
            layers.push_back(
                &mut txn,
                MapPrelim::from([
                    ("id", In::from(id.clone())),
                    ("name", In::from("Layer 1")),
                    ("visible", In::from(true)),
                    ("locked", In::from(false)),
                    ("opacity", In::from(1.0)),
                    ("elements", In::Any(Any::from_json("[]")?)),
                ]),
            );
            metadata.insert(&mut txn, "activeLayerId", id);
            if !metadata.contains_key(&txn, "camera") {
                metadata.insert(
                    &mut txn,
                    "camera",
                    Any::from_json(r#"{"x":0,"y":0,"zoom":1}"#)?,
                );
            }
        }
        let active = metadata
            .get(&txn, "activeLayerId")
            .context("Whiteboard has no active layer")?;
        let active = json(active.to_json(&txn))?;
        let layer = layers
            .iter(&txn)
            .find_map(|v| match v {
                Out::YMap(layer)
                    if layer
                        .get(&txn, "id")
                        .and_then(|v| json(v.to_json(&txn)).ok())
                        .as_ref()
                        == Some(&active) =>
                {
                    Some(layer)
                }
                _ => None,
            })
            .context("Whiteboard active layer is unavailable")?;
        if layer
            .get(&txn, "locked")
            .and_then(|v| json(v.to_json(&txn)).ok())
            == Some(Value::Bool(true))
        {
            bail!("The active whiteboard layer is locked");
        }
        let mut order = match layer.get(&txn, "elements") {
            Some(v) => json(v.to_json(&txn))?
                .as_array()
                .cloned()
                .context("Invalid layer element order")?,
            None => Vec::new(),
        };
        for element in additions {
            let value = serde_json::to_value(element)?;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .context("Whiteboard element has no identity")?
                .to_owned();
            if map.contains_key(&txn, &id) {
                continue;
            } // Idempotent retry; retain latest cached values.
            map.insert(&mut txn, id.clone(), input(value)?);
            order.push(Value::String(id));
        }
        layer.insert(
            &mut txn,
            "elements",
            Any::from_json(&serde_json::to_string(&order)?)?,
        );
    }
    let result = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::LocalStorage;
    use maple_shared::{BaseElement, StrokePoint, StrokeStyle, Transform};
    const WEB: &[u8] = include_bytes!("../../tests/fixtures/web-whiteboard.bin");

    pub fn stroke(id: &str) -> WhiteboardElement {
        WhiteboardElement::Stroke(StrokeElement {
            base: BaseElement {
                id: id.into(),
                created_by: "test-user".into(),
                created_at: 1,
                updated_at: 2,
                transform: Transform::default(),
                locked: None,
            },
            element_type: "stroke".into(),
            points: vec![
                StrokePoint {
                    x: 1.,
                    y: 2.,
                    pressure: 0.7,
                },
                StrokePoint {
                    x: 3.,
                    y: 4.,
                    pressure: 0.9,
                },
            ],
            style: StrokeStyle::default(),
        })
    }

    #[test]
    fn reads_web_document_in_layer_order_and_preserves_unknown_content() -> Result<()> {
        let loaded = elements(WEB)?;
        let values: Vec<_> = loaded
            .iter()
            .map(serde_json::to_value)
            .collect::<std::result::Result<_, _>>()?;
        assert_eq!(
            values
                .iter()
                .map(|v| v["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["web-text", "web-stroke", "web-shape"]
        );
        assert_eq!(values[1]["points"][0]["pressure"], 0.7);
        assert_eq!(values[1]["transform"]["rotation"], 0.2);
        let saved = append(Some(WEB), &[stroke("new-stroke")])?;
        let doc = document(Some(&saved))?;
        let map = doc.get_or_insert_map("elements");
        let metadata = doc.get_or_insert_map("metadata");
        let layers = doc.get_or_insert_array("layers");
        let txn = doc.transact();
        let value = json(map.to_json(&txn))?;
        assert_eq!(value["web-stroke"]["futureField"], "preserve");
        assert_eq!(value["future"]["data"], "keep me");
        assert_eq!(json(metadata.to_json(&txn))?["camera"]["zoom"], 2);
        assert_eq!(json(metadata.to_json(&txn))?["future-setting"], "keep");
        assert_eq!(
            json(layers.to_json(&txn))?[0]["elements"],
            serde_json::json!([
                "web-text",
                "web-stroke",
                "web-shape",
                "future",
                "new-stroke"
            ])
        );
        assert_eq!(elements(&saved)?.len(), 4);
        if let Ok(path) = std::env::var("MAPLE_INTEROP_OUTPUT") {
            std::fs::write(path, saved)?;
        }
        Ok(())
    }

    #[test]
    fn hidden_layers_stay_hidden_and_are_preserved_on_save() -> Result<()> {
        let doc = document(Some(WEB))?;
        let layers = doc.get_or_insert_array("layers");
        {
            let mut txn = doc.transact_mut();
            let Out::YMap(layer) = layers.get(&txn, 0).unwrap() else {
                panic!("layer map")
            };
            layer.insert(&mut txn, "visible", false);
        }
        let bytes = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        assert!(elements(&bytes)?.is_empty());
        let saved = append(Some(&bytes), &[])?;
        let reopened = document(Some(&saved))?;
        let original_map = doc.get_or_insert_map("elements");
        let reopened_map = reopened.get_or_insert_map("elements");
        assert_eq!(
            json(original_map.to_json(&doc.transact()))?,
            json(reopened_map.to_json(&reopened.transact()))?
        );
        assert!(elements(&saved)?.is_empty());
        Ok(())
    }

    #[test]
    fn retries_do_not_duplicate_elements_or_layer_entries() -> Result<()> {
        let first = append(None, &[stroke("one")])?;
        let second = append(Some(&first), &[stroke("one"), stroke("two")])?;
        let third = append(Some(&second), &[stroke("one"), stroke("two")])?;
        assert_eq!(elements(&third)?.len(), 2);
        let doc = document(Some(&third))?;
        let layers = doc.get_or_insert_array("layers");
        assert_eq!(
            json(layers.to_json(&doc.transact()))?[0]["elements"],
            serde_json::json!(["one", "two"])
        );
        Ok(())
    }

    #[test]
    fn refuses_corrupt_documents_and_locked_layers() -> Result<()> {
        assert!(elements(b"not a Y.js update").is_err());
        assert!(append(Some(b"corrupt"), &[stroke("one")]).is_err());
        let doc = document(Some(WEB))?;
        let layers = doc.get_or_insert_array("layers");
        let mut txn = doc.transact_mut();
        let Out::YMap(layer) = layers.get(&txn, 0).unwrap() else {
            panic!("layer map")
        };
        layer.insert(&mut txn, "locked", true);
        drop(txn);
        let bytes = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        assert!(append(Some(&bytes), &[stroke("one")]).is_err());
        Ok(())
    }

    #[test]
    fn save_survives_storage_close_and_reopen_and_keeps_corrupt_bytes() -> Result<()> {
        let path = std::env::temp_dir().join(format!("maple-whiteboard-{}", uuid::Uuid::new_v4()));
        {
            let storage = LocalStorage::new(&path)?;
            storage.store_document("board", WEB)?;
            storage.save_whiteboard("board", &[stroke("saved")])?;
            storage.store_document("broken", b"corrupt")?;
            assert!(storage
                .save_whiteboard("broken", &[stroke("unsaved")])
                .is_err());
            assert_eq!(storage.get_document("broken")?.unwrap(), b"corrupt");
        }
        {
            let storage = LocalStorage::new(&path)?;
            assert_eq!(elements(&storage.get_document("board")?.unwrap())?.len(), 4);
            assert_eq!(storage.get_document("broken")?.unwrap(), b"corrupt");
        }
        std::fs::remove_dir_all(path)?;
        Ok(())
    }
}
