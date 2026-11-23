fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        build_linux_documents();
    }
    tauri_build::build()
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
