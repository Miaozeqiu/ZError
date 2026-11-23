//! crypto implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn seal(key: &[u8], name: &str, value: &[u8]) -> Result<String, String> {
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| "加密密钥无效")?,
    );
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "安全随机源不可用")?;
    let mut bytes = value.to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(name.as_bytes()),
        &mut bytes,
    )
    .map_err(|_| "加密失败")?;
    let mut output = nonce.to_vec();
    output.extend(bytes);
    Ok(format!("{}{}", PREFIX, STANDARD.encode(output)))
}

pub(super) fn open(key: &[u8], name: &str, value: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let mut bytes = Zeroizing::new(
        STANDARD
            .decode(value.strip_prefix(PREFIX).ok_or("不是安全存储格式")?)
            .map_err(|_| "密文格式错误")?,
    );
    if bytes.len() < 28 {
        return Err("密文已损坏".into());
    }
    let nonce = aead::Nonce::try_assume_unique_for_key(&bytes[..12]).map_err(|_| "密文已损坏")?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| "加密密钥无效")?,
    );
    let plain = key
        .open_in_place(nonce, aead::Aad::from(name.as_bytes()), &mut bytes[12..])
        .map_err(|_| "解密校验失败，原数据已保留")?;
    Ok(Zeroizing::new(plain.to_vec()))
}

pub(super) fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("存储路径无效")?;
    std::fs::create_dir_all(parent).map_err(|_| "无法创建安全存储目录")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护存储目录")?;
    }
    let tmp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&tmp).map_err(|_| "无法写入安全存储")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "安全存储写入失败")?;
        std::fs::rename(&tmp, path).map_err(|_| "无法替换安全存储文件")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result
}
