# Source provenance

The embedder and exact-vector implementation are adapted from the owner's `_Maple`
repository, commit `320381dcfe`, `src/raw-pipeline/maple-search`. That workspace
identifies its source as Proprietary. This extraction retains that designation;
it does not relicense the source or publish it as an open-source package.

`vendor/fastembed` is fastembed 5.8.0 under Apache-2.0, including `_Maple`'s
thread-count patch. Its original LICENSE and MAPLE-PATCH.md are retained.

ONNX Runtime and model weights are downloaded separately from their upstream
publishers. Runtime/model versions and checksums belong in the deployment manifest.
