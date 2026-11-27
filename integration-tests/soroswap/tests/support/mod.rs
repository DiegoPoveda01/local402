use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

// Restore the code entries from the WASMs fetched by ledger hash with Stellar CLI.
pub(super) fn soroswap_snapshot() -> NamedTempFile {
    let mut state: Value = serde_json::from_str(include_str!("../../fixtures/soroswap.json"))
        .expect("valid frozen ledger");
    let wasm_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
    let entries = state["ledger_snapshot"]["ledger_entries"]
        .as_array_mut()
        .unwrap();
    for code in entries
        .iter_mut()
        .filter_map(|entry| entry.pointer_mut("/entry/data/contract_code"))
    {
        let hash = code["hash"].as_str().expect("contract code hash");
        let mut expected = [0; 32];
        hex::decode_to_slice(hash, &mut expected).expect("32-byte WASM hash");
        let path = wasm_dir.join(format!("{hash}.wasm"));
        let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        assert_eq!(
            Sha256::digest(&bytes)[..],
            expected,
            "WASM hash mismatch: {hash}"
        );
        code["code"] = Value::String(hex::encode(bytes));
    }
    let file = NamedTempFile::new().expect("temporary snapshot");
    serde_json::to_writer(file.as_file(), &state).expect("write local snapshot");
    file
}
