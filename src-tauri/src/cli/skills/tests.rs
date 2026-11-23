use super::*;
use package::{hash, Package, SkillFile};
use std::{fs, path::PathBuf};

struct Fixture {
    root: PathBuf,
    store: store::Store,
    target: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("zerror-skill-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("skills")).unwrap();
        let store = store::Store::at(root.join("registry")).unwrap();
        let target = root.join("skills/zerror");
        Self {
            root,
            store,
            target,
        }
    }
    fn backup(&self) -> PathBuf {
        self.root.join(format!(
            ".zerror-{}-previous",
            &hash(self.target.to_string_lossy().as_bytes())[..16]
        ))
    }
    fn install(&self, package: &Package) -> Result<Receipt, String> {
        self.store
            .install(&self.target, DEFAULT_SOURCE, package, true)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn file(path: &str, content: &str) -> SkillFile {
    SkillFile {
        path: path.into(),
        bytes: content.len(),
        sha256: hash(content.as_bytes()),
        content: content.into(),
    }
}
fn seal(p: &mut Package) {
    let mut files = p.files.iter().collect::<Vec<_>>();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut identity = format!(
        "zerror-agent-skill:1\n{}\n{}\n{}\n",
        p.name, p.version, p.cli_protocol
    );
    for f in files {
        identity.push_str(&format!("{}\t{}\t{}\n", f.path, f.bytes, f.sha256));
    }
    p.revision = hash(identity.as_bytes());
}
fn package(version: &str) -> Package {
    let mut p = Package {
        schema_version: 1,
        name: "zerror".into(),
        version: version.into(),
        cli_protocol: 1,
        revision: String::new(),
        files: vec![
            file(
                "SKILL.md",
                &format!("---\nname: zerror\ndescription: CLI helper\n---\nVersion {version}"),
            ),
            file("references/cli.md", "CLI reference"),
        ],
    };
    seal(&mut p);
    p
}
#[test]
fn accepts_verified_package() {
    assert!(package("1.0.0").validate().is_ok());
}
#[test]
fn rejects_content_and_manifest_tampering() {
    let mut p = package("1.0.0");
    p.files[0].content.push('!');
    assert!(p.validate().is_err());
    let mut p = package("1.0.0");
    p.version = "1.0.1".into();
    assert!(p.validate().is_err());
    let mut p = package("1.0.0");
    p.cli_protocol = 2;
    seal(&mut p);
    assert!(p.validate().is_err());
}
#[test]
fn rejects_unsafe_cross_platform_paths() {
    for path in [
        "../bad",
        "/absolute",
        "foo\\bar",
        "CON.txt",
        "a//b",
        "a/../b",
        "a.",
        ".ZERROR-SKILL.JSON",
        ".zerror-skill.json/file",
    ] {
        let mut p = package("1.0.0");
        p.files.push(file(path, "bad"));
        seal(&mut p);
        assert!(p.validate().is_err(), "{path}");
    }
}
#[test]
fn rejects_file_directory_and_case_collisions() {
    for paths in [
        ["references", "references/a.md"],
        ["References/a.md", "references/b.md"],
        ["skill.md", "SKILL.md"],
    ] {
        let mut p = package("1.0.0");
        p.files.extend(paths.iter().map(|p| file(p, "bad")));
        seal(&mut p);
        assert!(p.validate().is_err());
    }
}
#[test]
fn limits_package_size_and_version() {
    for version in ["1", "1.0", "1.0.0.0", "1.x.0", "-1.0.0", "100000000.0.0"] {
        assert!(package::version(version).is_err());
    }
    let mut p = package("1.0.0");
    p.files[0] = file("SKILL.md", &"x".repeat(package::LIMIT + 1));
    seal(&mut p);
    assert!(p.validate().is_err());
}
#[test]
fn source_requires_https_or_loopback_without_credentials() {
    for source in [
        "https://open.zerrorai.com/",
        "http://127.0.0.1:1234",
        "http://[::1]:1234",
    ] {
        assert!(source_url(source).is_ok());
    }
    for source in [
        "http://example.com",
        "file:///tmp/skill",
        "https://user:pass@example.com",
        "https://example.com/?token=secret",
        "https://example.com/#token",
    ] {
        assert!(source_url(source).is_err());
    }
}
#[test]
fn installs_upgrades_and_registers_one_target() {
    let f = Fixture::new();
    let first = f.install(&package("1.0.0")).unwrap();
    assert_eq!(first.version, "1.0.0");
    assert!(f.target.join("references/cli.md").is_file());
    f.install(&package("1.0.0")).unwrap();
    f.install(&package("1.0.1")).unwrap();
    let rows = f.store.installations().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].path, f.target);
    assert!(rows[0].automatic);
    assert_eq!(store::receipt(&f.target).unwrap().version, "1.0.1");
    assert!(!f.backup().exists());
}
#[test]
fn prevents_downgrade_and_mutable_published_version() {
    let f = Fixture::new();
    f.install(&package("1.0.1")).unwrap();
    assert!(f.install(&package("1.0.0")).is_err());
    let mut changed = package("1.0.1");
    changed.files.push(file("new.md", "new"));
    seal(&mut changed);
    assert!(f.install(&changed).is_err());
    assert!(!f.target.join("new.md").exists());
}
#[test]
fn preserves_modified_files_extra_files_and_empty_directories() {
    for extra in ["modified", "extra-file", "empty-dir"] {
        let f = Fixture::new();
        f.install(&package("1.0.0")).unwrap();
        match extra {
            "modified" => fs::write(f.target.join("SKILL.md"), "my changes").unwrap(),
            "extra-file" => fs::write(f.target.join("notes.txt"), "mine").unwrap(),
            _ => fs::create_dir(f.target.join("empty")).unwrap(),
        }
        assert!(f.install(&package("1.0.1")).is_err());
        assert_eq!(store::receipt(&f.target).unwrap().version, "1.0.0");
        assert!(f.target.exists());
    }
}
#[test]
fn refuses_unrelated_skill_but_adopts_exact_official_files() {
    let f = Fixture::new();
    fs::create_dir(&f.target).unwrap();
    fs::write(f.target.join("SKILL.md"), "another skill").unwrap();
    assert!(f.install(&package("1.0.0")).is_err());
    assert_eq!(
        fs::read_to_string(f.target.join("SKILL.md")).unwrap(),
        "another skill"
    );
    fs::remove_dir_all(&f.target).unwrap();
    let p = package("1.0.0");
    for file in &p.files {
        let path = f.target.join(&file.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, &file.content).unwrap();
    }
    assert!(f.install(&p).is_ok());
}
#[test]
fn source_change_does_not_overwrite() {
    let f = Fixture::new();
    f.install(&package("1.0.0")).unwrap();
    assert!(f
        .store
        .install(&f.target, "https://other.example", &package("1.0.1"), true)
        .is_err());
    assert_eq!(store::receipt(&f.target).unwrap().source, DEFAULT_SOURCE);
}
#[test]
fn recovers_interrupted_swap_without_network() {
    let f = Fixture::new();
    f.install(&package("1.0.0")).unwrap();
    fs::rename(&f.target, f.backup()).unwrap();
    f.store.recover(&f.target, DEFAULT_SOURCE).unwrap();
    assert!(f.target.join("SKILL.md").exists());
    assert!(!f.backup().exists());
}
#[test]
fn preserves_modified_backup() {
    let f = Fixture::new();
    f.install(&package("1.0.0")).unwrap();
    fs::rename(&f.target, f.backup()).unwrap();
    fs::write(f.backup().join("SKILL.md"), "backup edits").unwrap();
    assert!(f.store.recover(&f.target, DEFAULT_SOURCE).is_err());
    assert_eq!(
        fs::read_to_string(f.backup().join("SKILL.md")).unwrap(),
        "backup edits"
    );
}
#[test]
fn registry_failure_rolls_back_files() {
    let f = Fixture::new();
    f.install(&package("1.0.0")).unwrap();
    let lock = f.store.lock("registry").unwrap();
    assert!(f.install(&package("1.0.1")).is_err());
    drop(lock);
    assert_eq!(store::receipt(&f.target).unwrap().version, "1.0.0");
    assert!(!f.backup().exists());
}
#[test]
fn waits_for_a_brief_lock_without_removing_or_replacing_it() {
    let f = Fixture::new();
    let guard = f.store.lock("registry").unwrap();
    let release = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(30));
        drop(guard);
    });
    let acquired = f.store.lock("registry").unwrap();
    release.join().unwrap();
    assert!(f.store.lock("registry").is_err());
    drop(acquired);
    assert!(f.store.lock("registry").is_ok());
}
#[test]
fn target_lock_blocks_concurrent_install_and_releases_on_drop() {
    let f = Fixture::new();
    let lock = f.store.lock(&f.target.to_string_lossy()).unwrap();
    assert!(f.install(&package("1.0.0")).is_err());
    drop(lock);
    assert!(f.install(&package("1.0.0")).is_ok());
}
#[test]
fn manual_update_preference_is_persisted() {
    let f = Fixture::new();
    f.store
        .install(&f.target, DEFAULT_SOURCE, &package("1.0.0"), false)
        .unwrap();
    assert!(!store::receipt(&f.target).unwrap().automatic);
    assert!(!f.store.installations().unwrap()[0].automatic);
}
#[cfg(unix)]
#[test]
fn rejects_symlinks_without_touching_destination() {
    let f = Fixture::new();
    let dest = f.root.join("external");
    fs::write(&dest, "mine").unwrap();
    fs::create_dir(&f.target).unwrap();
    std::os::unix::fs::symlink(&dest, f.target.join("SKILL.md")).unwrap();
    assert!(f.install(&package("1.0.0")).is_err());
    assert_eq!(fs::read_to_string(dest).unwrap(), "mine");
}
#[test]
fn parses_explicit_install_targets_and_rejects_ambiguous_options() {
    for args in [
        vec!["install"],
        vec!["install", "--agent", "codex", "--dir", "/tmp"],
        vec!["update", "--source", "http://unsafe.example"],
        vec!["install", "--agent"],
    ] {
        assert!(parse(&args.into_iter().map(String::from).collect::<Vec<_>>()).is_err());
    }
    let o = parse(&["install", "--agent", "codex", "--no-auto-update"].map(String::from)).unwrap();
    assert!(o.manual);
    assert_eq!(o.agent.as_deref(), Some("codex"));
}

#[test]
fn unchanged_release_does_not_rewrite_skill_files() {
    let f = Fixture::new();
    f.install(&package("1.0.0")).unwrap();
    let before = fs::metadata(f.target.join("SKILL.md"))
        .unwrap()
        .modified()
        .unwrap();
    f.install(&package("1.0.0")).unwrap();
    assert_eq!(
        fs::metadata(f.target.join("SKILL.md"))
            .unwrap()
            .modified()
            .unwrap(),
        before
    );
}
