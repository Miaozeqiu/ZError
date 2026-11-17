//! File-keychain access is noninteractive for all background operations.
//! A blocked legacy key may be migrated only by the user's explicit recovery action.
use security_framework::{os::macos::keychain::SecKeychain, passwords::get_generic_password};
use zeroize::Zeroizing;

const CURRENT: &str = "vault-master-v2";
const LEGACY: &str = "vault-master-v1";
pub const AUTH_REQUIRED: &str =
    "SECURE_STORAGE_AUTHORIZATION_REQUIRED: 安全存储的旧版授权需要更新，请主动恢复授权";
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Background,
    UserRecovery,
}
#[derive(Debug, PartialEq, Eq)]
enum Failure {
    Missing,
    Denied,
    Other(i32),
}
fn status(code: i32) -> Failure {
    match code {
        -25300 => Failure::Missing,
        -25308 | -25315 | -25293 | -128 | -67050 => Failure::Denied,
        other => Failure::Other(other),
    }
}
trait Backend {
    fn read(&self, account: &str, access: Access) -> Result<Zeroizing<Vec<u8>>, Failure>;
    fn add(&self, account: &str, value: &[u8]) -> Result<(), Failure>;
}
struct Keychain<'a>(&'a str);
fn noninteractive<T>(
    operation: impl FnOnce() -> Result<T, security_framework::base::Error>,
) -> Result<T, Failure> {
    // Preserve an existing noninteractive setting. The vault's master-key mutex
    // serializes these short operations and the explicit recovery path.
    let allowed = SecKeychain::user_interaction_allowed().map_err(|e| status(e.code()))?;
    let _guard = if allowed {
        Some(SecKeychain::disable_user_interaction().map_err(|e| status(e.code()))?)
    } else {
        None
    };
    operation().map_err(|e| status(e.code()))
}
impl Backend for Keychain<'_> {
    fn read(&self, account: &str, access: Access) -> Result<Zeroizing<Vec<u8>>, Failure> {
        let value = if access == Access::Background {
            noninteractive(|| get_generic_password(self.0, account))?
        } else {
            get_generic_password(self.0, account).map_err(|e| status(e.code()))?
        };
        Ok(Zeroizing::new(value))
    }
    fn add(&self, account: &str, value: &[u8]) -> Result<(), Failure> {
        // Add-only: never overwrite another process's key or update an old ACL.
        noninteractive(|| SecKeychain::default()?.add_generic_password(self.0, account, value))
    }
}
fn message(error: Failure) -> String {
    match error {
        Failure::Denied => AUTH_REQUIRED.into(),
        Failure::Missing => "安全存储密钥缺失，原数据已保留".into(),
        Failure::Other(code) => format!("系统安全存储不可用（状态 {}），原数据已保留", code),
    }
}
fn load_from(
    backend: &impl Backend,
    create: bool,
    access: Access,
    random: impl FnOnce() -> Result<Vec<u8>, String>,
    validate: impl Fn(&[u8]) -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    // Reading the new item is always silent, including during recovery. Only the
    // specific legacy/blocked item may display a keychain permission dialog.
    match backend.read(CURRENT, Access::Background) {
        Ok(key) => {
            validate(&key)?;
            return Ok(key.to_vec());
        }
        Err(Failure::Missing) => {}
        Err(Failure::Denied) if access == Access::UserRecovery => {
            let key = backend
                .read(CURRENT, Access::UserRecovery)
                .map_err(message)?;
            validate(&key)?;
            return Ok(key.to_vec());
        }
        Err(error) => return Err(message(error)),
    }
    let key = match backend.read(LEGACY, access) {
        Ok(key) => key,
        Err(Failure::Missing) if create => Zeroizing::new(random()?),
        Err(error) => return Err(message(error)),
    };
    validate(&key)?;
    match backend.add(CURRENT, &key) {
        Ok(()) => Ok(key.to_vec()),
        // Another instance won creation. Read and validate its key; never replace it.
        Err(Failure::Other(-25299)) => {
            let winner = backend.read(CURRENT, Access::Background).map_err(message)?;
            validate(&winner)?;
            if !create && winner.as_slice() != key.as_slice() {
                return Err("安全存储密钥冲突，原数据已保留".into());
            }
            Ok(winner.to_vec())
        }
        Err(error) => Err(message(error)),
    }
}
pub fn load(
    service: &str,
    create: bool,
    access: Access,
    random: impl FnOnce() -> Result<Vec<u8>, String>,
    validate: impl Fn(&[u8]) -> Result<(), String>,
) -> Result<Vec<u8>, String> {
    use security_framework::os::macos::code_signing::{Flags, SecCode, SecRequirement};
    // An ad-hoc build has a different designated requirement after every rebuild.
    // Never let such a process create/migrate the durable keychain item.
    let requirement: SecRequirement =
        r#"identifier "com.zerror.app" and certificate leaf[subject.CN] exists"#
            .parse()
            .map_err(|_| "无法校验软件签名")?;
    let signed = SecCode::for_self(Flags::NONE)
        .and_then(|code| code.check_validity(Flags::NONE, &requirement));
    if signed.is_err() {
        return Err("SECURE_STORAGE_SIGNING_REQUIRED: 当前开发程序需要稳定签名，请通过 npm run tauri:dev 重新启动；原数据已保留".into());
    }
    load_from(&Keychain(service), create, access, random, validate)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    struct Fake {
        current: RefCell<Option<Vec<u8>>>,
        blocked: bool,
        reads: RefCell<Vec<(String, bool)>>,
        additions: RefCell<usize>,
    }
    impl Backend for Fake {
        fn read(&self, account: &str, access: Access) -> Result<Zeroizing<Vec<u8>>, Failure> {
            self.reads
                .borrow_mut()
                .push((account.into(), access == Access::UserRecovery));
            if account == CURRENT {
                return self
                    .current
                    .borrow()
                    .clone()
                    .map(Zeroizing::new)
                    .ok_or(Failure::Missing);
            }
            if self.blocked && access == Access::Background {
                Err(Failure::Denied)
            } else {
                Ok(Zeroizing::new(vec![7; 32]))
            }
        }
        fn add(&self, _: &str, key: &[u8]) -> Result<(), Failure> {
            *self.additions.borrow_mut() += 1;
            *self.current.borrow_mut() = Some(key.to_vec());
            Ok(())
        }
    }
    fn fake() -> Fake {
        Fake {
            current: RefCell::new(None),
            blocked: true,
            reads: RefCell::new(vec![]),
            additions: RefCell::new(0),
        }
    }
    fn valid(key: &[u8]) -> Result<(), String> {
        if key.len() == 32 {
            Ok(())
        } else {
            Err("bad key".into())
        }
    }
    #[test]
    fn background_access_never_prompts_or_replaces_an_inaccessible_key() {
        let backend = fake();
        assert!(load_from(
            &backend,
            false,
            Access::Background,
            || panic!("must not generate"),
            valid
        )
        .unwrap_err()
        .starts_with("SECURE_STORAGE_AUTHORIZATION_REQUIRED"));
        assert!(backend
            .reads
            .borrow()
            .iter()
            .all(|(_, interactive)| !interactive));
        assert_eq!(*backend.additions.borrow(), 0);
    }
    #[test]
    fn explicit_recovery_migrates_once_and_future_background_reads_are_silent() {
        let backend = fake();
        assert_eq!(
            load_from(&backend, false, Access::UserRecovery, || panic!(), valid).unwrap(),
            vec![7; 32]
        );
        assert_eq!(
            backend
                .reads
                .borrow()
                .iter()
                .filter(|(_, interactive)| *interactive)
                .count(),
            1
        );
        backend.reads.borrow_mut().clear();
        assert_eq!(
            load_from(&backend, false, Access::Background, || panic!(), valid).unwrap(),
            vec![7; 32]
        );
        assert!(backend
            .reads
            .borrow()
            .iter()
            .all(|(_, interactive)| !interactive));
        assert_eq!(*backend.additions.borrow(), 1);
    }
    #[test]
    fn invalid_or_unrecoverable_key_is_not_replaced() {
        let backend = fake();
        assert!(load_from(
            &backend,
            false,
            Access::UserRecovery,
            || panic!(),
            |_| Err("vault integrity failed".into())
        )
        .is_err());
        assert_eq!(*backend.additions.borrow(), 0);
    }
}
