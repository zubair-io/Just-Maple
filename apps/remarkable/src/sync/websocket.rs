//! Bounded delivery of realtime events; uses the same channel envelopes as the web client.
use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, watch, RwLock};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

#[derive(Debug)]
pub enum RealtimeEvent {
    Connected,
    Chat(Value),
    Sync { page_id: String, event: Value },
    App(Value),
    Error(String),
    Disconnected,
}
fn decode(value: Value) -> Option<RealtimeEvent> {
    let event = value.get("event").unwrap_or(&value);
    let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
    if kind == "error" {
        return Some(RealtimeEvent::Error(
            event.get("message")?.as_str()?.to_owned(),
        ));
    }
    match value.get("channel").and_then(Value::as_str) {
        Some("system") if kind == "connected" => Some(RealtimeEvent::Connected),
        Some("chat") => Some(RealtimeEvent::Chat(event.clone())),
        Some("app") => Some(RealtimeEvent::App(event.clone())),
        Some("memo") => Some(RealtimeEvent::Sync {
            page_id: value.get("pageId")?.as_str()?.to_owned(),
            event: event.clone(),
        }),
        // Compatibility with older servers, without logging message content.
        None if kind == "chat" => Some(RealtimeEvent::Chat(value.get("data")?.clone())),
        None if kind == "sync" => Some(RealtimeEvent::Sync {
            page_id: value.get("data")?.get("pageId")?.as_str()?.to_owned(),
            event: value.get("data")?.clone(),
        }),
        _ => None,
    }
}

pub struct WebSocketClient {
    tx: mpsc::Sender<Value>,
    inbox: Mutex<mpsc::Receiver<RealtimeEvent>>,
    shutdown: watch::Sender<bool>,
    is_connected: Arc<RwLock<bool>>,
}
impl WebSocketClient {
    pub async fn connect(url: &str, token: &str) -> Result<Self> {
        let url = if url.trim_end_matches('/').ends_with("/ws") {
            format!("{}/realtime", url.trim_end_matches('/'))
        } else {
            url.to_owned()
        };
        // The server accepts query authentication but does not negotiate the JWT
        // as a WebSocket subprotocol (tungstenite correctly rejects that handshake).
        let mut endpoint = reqwest::Url::parse(&url)?;
        endpoint.query_pairs_mut().append_pair("token", token);
        let request = endpoint.as_str().into_client_request()?;
        let (stream, _) = connect_async(request).await?;
        let (mut write, mut read) = stream.split();
        let (tx, mut outgoing) = mpsc::channel::<Value>(100);
        let (events, inbox) = mpsc::channel(100);
        let (shutdown, mut stop) = watch::channel(false);
        let is_connected = Arc::new(RwLock::new(true));
        let connected = is_connected.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _=stop.changed()=> {let _=write.send(Message::Close(None)).await; break;},
                    next=outgoing.recv()=>match next {
                        Some(value)=>if write.send(Message::Text(value.to_string())).await.is_err() {break;},
                        None=>break,
                    },
                    incoming=read.next()=>match incoming {
                        Some(Ok(Message::Text(text)))=> {
                            if let Ok(value)=serde_json::from_str::<Value>(&text) {
                                let event=value.get("event").unwrap_or(&value);
                                if event.get("type").and_then(Value::as_str)==Some("ping") {
                                    let pong=if value.get("channel").is_some() {json!({"channel":"system","action":"pong"})} else {json!({"type":"pong"})};
                                    if write.send(Message::Text(pong.to_string())).await.is_err() {break;}
                                } else if let Some(event)=decode(value) {
                                    // Backpressure is bounded, and shutdown remains interruptible.
                                    tokio::select! { result=events.send(event)=>if result.is_err(){break;}, _=stop.changed()=>break }
                                }
                            } else {tracing::warn!("Ignoring malformed realtime message");}
                        },
                        Some(Ok(Message::Ping(bytes)))=>if write.send(Message::Pong(bytes)).await.is_err(){break;},
                        Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,
                        _=>{},
                    }
                }
            }
            *connected.write().await = false;
            let _ = events.try_send(RealtimeEvent::Disconnected);
        });
        Ok(Self {
            tx,
            inbox: Mutex::new(inbox),
            shutdown,
            is_connected,
        })
    }
    pub async fn is_connected(&self) -> bool {
        *self.is_connected.read().await
    }
    pub fn drain(&self) -> Vec<RealtimeEvent> {
        let mut events = Vec::new();
        let mut inbox = self.inbox.lock().unwrap();
        while let Ok(event) = inbox.try_recv() {
            events.push(event);
        }
        events
    }
    pub async fn subscribe(&self, pages: Vec<String>) -> Result<()> {
        for page in pages {
            self.tx
                .send(json!({"channel":"memo","action":"join","pageId":page}))
                .await?;
        }
        Ok(())
    }
    pub async fn unsubscribe(&self, pages: Vec<String>) -> Result<()> {
        for page in pages {
            self.tx
                .send(json!({"channel":"memo","action":"leave","pageId":page}))
                .await?;
        }
        Ok(())
    }
    pub async fn close(&self) {
        let _ = self.shutdown.send(true);
        *self.is_connected.write().await = false;
    }
}
impl Drop for WebSocketClient {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn dispatches_supported_events_answers_ping_and_disconnects() -> Result<()> {
        use tokio::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            for text in [
                r#"{"channel":"system","event":{"type":"connected"}}"#,
                "bad json",
                r#"{"channel":"future","event":{"type":"unknown"}}"#,
                r#"{"channel":"chat","event":{"action":"message","data":{"_id":"one"},"notebookId":"notebook"}}"#,
                r#"{"channel":"memo","pageId":"board","event":{"type":"ydoc-update","data":{"update":"AAA="}}}"#,
                r#"{"channel":"app","event":{"type":"page.updated","pageId":"one"}}"#,
                r#"{"channel":"system","event":{"type":"error","message":"Denied"}}"#,
                r#"{"channel":"system","event":{"type":"ping"}}"#,
            ] {
                ws.send(Message::Text(text.into())).await.unwrap();
            }
            let reply = ws.next().await.unwrap().unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(reply.to_text().unwrap()).unwrap(),
                json!({"channel":"system","action":"pong"})
            );
            ws.close(None).await.unwrap();
        });
        let client = WebSocketClient::connect(&format!("ws://{address}"), "test-token").await?;
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while client.is_connected().await {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await?;
        let events = client.drain();
        assert!(matches!(events[0], RealtimeEvent::Connected));
        assert_eq!(events.len(), 6);
        assert!(matches!(events[1], RealtimeEvent::Chat(_)));
        assert!(matches!(events[2], RealtimeEvent::Sync { .. }));
        assert!(matches!(events[3], RealtimeEvent::App(_)));
        assert!(matches!(events[4], RealtimeEvent::Error(_)));
        assert!(matches!(events[5], RealtimeEvent::Disconnected));
        server.await?;
        Ok(())
    }
    #[tokio::test]
    async fn close_stops_the_actual_connection() -> Result<()> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            assert!(matches!(ws.next().await, Some(Ok(Message::Close(_)))));
        });
        let client = WebSocketClient::connect(&format!("ws://{address}"), "test").await?;
        client.close().await;
        tokio::time::timeout(std::time::Duration::from_secs(3), server).await??;
        Ok(())
    }
}
