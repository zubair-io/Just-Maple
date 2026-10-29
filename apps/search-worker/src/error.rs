#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("ONNX Runtime is unavailable: {0}")]
    RuntimeUnavailable(String),
    #[error("embedding failed: {0}")]
    Embedding(String),
    #[error("invalid vector bytes: {bytes}, expected {expected} ({rows} x {dim})")]
    VectorShape {
        bytes: usize,
        expected: usize,
        rows: usize,
        dim: usize,
    },
    #[error("vector dimensions {got}, expected {expected}")]
    Dimension { got: usize, expected: usize },
    #[error("duplicate vector id {0}")]
    DuplicateId(String),
    #[error("invalid configuration: {0}")]
    Config(String),
}
pub type Result<T> = std::result::Result<T, SearchError>;
