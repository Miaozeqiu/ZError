fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        build_linux_documents();
    }
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri 默认只给应用程序嵌入清单，库测试因此无法加载 Common Controls v6。
        // 统一由链接器嵌入同一份清单，覆盖应用、CLI 和测试，避免重复资源。
        let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    tauri_build::try_build(attributes).expect("build Tauri application resources");
}

fn build_linux_documents() {
    let source = "src/linux_documents/extension.c";
    println!("cargo:rerun-if-changed={source}");
    let library = pkg_config::Config::new()
        .cargo_metadata(false)
        .atleast_version("2.40")
        .probe("webkit2gtk-web-extension-4.1")
        .expect("Linux document support requires libwebkit2gtk-4.1-dev (>= 2.40)");
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
        .join("libzerror-documents.so");
    let mut build = cc::Build::new();
    build.includes(&library.include_paths);
    let mut command = build.get_compiler().to_command();
    command.args([
        "-shared",
        "-fPIC",
        "-fvisibility=hidden",
        "-Wall",
        "-Wextra",
        "-Werror",
    ]);
    for path in &library.include_paths {
        command.arg("-I").arg(path);
    }
    for (key, value) in &library.defines {
        command.arg(match value {
            Some(value) => format!("-D{key}={value}"),
            None => format!("-D{key}"),
        });
    }
    command.arg(source).arg("-o").arg(&output);
    for path in &library.link_paths {
        command.arg("-L").arg(path);
    }
    for name in &library.libs {
        command.arg(format!("-l{name}"));
    }
    assert!(
        command
            .status()
            .expect("compile Linux document extension")
            .success(),
        "Linux document extension compilation failed"
    );
}
