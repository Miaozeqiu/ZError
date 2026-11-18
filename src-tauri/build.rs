use std::{fs, io::Cursor, path::Path};

fn prepare_scriptcat() -> Result<(), Box<dyn std::error::Error>> {
    const ARCHIVE: &str = "vendor/scriptcat/scriptcat-v1.5.2-chrome.zip";
    const KEY: &str = "vendor/scriptcat/crx-public-key.txt";
    println!("cargo:rerun-if-changed={ARCHIVE}");
    println!("cargo:rerun-if-changed={KEY}");
    let target = Path::new("target/scriptcat-v1.5.2");
    let bytes = fs::read(ARCHIVE)?;
    let digest = ring::digest::digest(&ring::digest::SHA256, &bytes);
    let hex: String = digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if hex != "72615ddc91aae40d9e4d36b44cf3ae27c69e94a3db81e44857eaa2f168748390" {
        return Err("ScriptCat release checksum mismatch".into());
    }
    println!("cargo:rustc-env=SCRIPTCAT_RELEASE_SHA256={hex}");
    let key = fs::read_to_string(KEY)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
    // Tauri also watches the staged resources. Only rewrite files that changed.
    for index in 0..archive.len() {
        use std::io::Read;
        let mut entry = archive.by_index(index)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry
            .enclosed_name()
            .ok_or("Invalid ScriptCat resource path")?;
        let dest = target.join(name);
        let mut data = Vec::new();
        entry.read_to_end(&mut data)?;
        if dest == target.join("manifest.json") {
            let mut manifest: serde_json::Value = serde_json::from_slice(&data)?;
            manifest["key"] = key.trim().into();
            data = serde_json::to_vec(&manifest)?;
        }
        if fs::read(&dest).ok().as_ref() != Some(&data) {
            fs::create_dir_all(dest.parent().unwrap())?;
            fs::write(dest, data)?;
        }
    }
    Ok(())
}

fn main() {
    prepare_scriptcat().expect("prepare bundled ScriptCat extension");
    tauri_build::build()
}
