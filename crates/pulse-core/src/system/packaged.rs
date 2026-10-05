//! Apps da Microsoft Store (MSIX) ficam em `...\WindowsApps\<pacote>\` e não devem
//! ser executados direto pelo `.exe`: o Windows exige abrir pelo ID do app
//! (AUMID, `NomeDaFamília!IdDoApp`) via `shell:AppsFolder`. Além disso, a pasta
//! do pacote muda de nome a cada atualização (versão no nome); o AUMID não.

use std::path::Path;

pub const SHELL_PREFIX: &str = r"shell:AppsFolder\";

/// `Claude_2.19675.0.0_x64__pzs8sxrjxfjjc` → (`Claude`, `pzs8sxrjxfjjc`).
fn split_package_folder(folder: &str) -> Option<(&str, &str)> {
    let (left, publisher) = folder.rsplit_once("__")?;
    let name = left.split('_').next()?;
    (!name.is_empty() && !publisher.is_empty()).then_some((name, publisher))
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(" {name}=\"");
    let start = tag.find(&key)? + key.len();
    let end = tag[start..].find('"')?;
    Some(&tag[start..start + end])
}

/// Id da `<Application>` cujo `Executable` é `relative_exe` (sem diferenciar maiúsculas).
pub fn app_id_from_manifest(manifest: &str, relative_exe: &str) -> Option<String> {
    let want = relative_exe.replace('/', "\\").to_ascii_lowercase();
    let mut rest = manifest;
    while let Some(i) = rest.find("<Application ") {
        let tag_end = rest[i..].find('>')? + i;
        let tag = &rest[i..tag_end];
        if let (Some(id), Some(exe)) = (attr(tag, "Id"), attr(tag, "Executable")) {
            if exe.replace('/', "\\").to_ascii_lowercase() == want {
                return Some(id.to_owned());
            }
        }
        rest = &rest[tag_end..];
    }
    None
}

/// Se `exe` é de um app da Store, devolve o AUMID; senão `None`.
pub fn aumid_for(exe: &Path) -> Option<String> {
    let s = exe.to_str()?;
    let lower = s.to_ascii_lowercase();
    let marker = "\\windowsapps\\";
    let at = lower.find(marker)? + marker.len();
    let after = &s[at..];
    let (folder, relative) = after.split_once('\\')?;
    let (name, publisher) = split_package_folder(folder)?;
    let manifest_path = Path::new(&s[..at]).join(folder).join("AppxManifest.xml");
    let manifest = std::fs::read_to_string(manifest_path).ok()?;
    let id = app_id_from_manifest(&manifest, relative)?;
    Some(format!("{name}_{publisher}!{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"<?xml version="1.0"?>
<Package><Applications>
  <Application Id="Claude" Executable="app\Claude.exe" EntryPoint="Windows.FullTrustApplication">
  </Application>
  <Application Id="SshProxy" Executable="app\resources\claude-ssh-proxy.exe">
  </Application>
</Applications></Package>"#;

    #[test]
    fn finds_app_id_by_executable() {
        assert_eq!(
            app_id_from_manifest(MANIFEST, r"app\claude.exe").as_deref(),
            Some("Claude")
        );
        assert_eq!(
            app_id_from_manifest(MANIFEST, "app/resources/claude-ssh-proxy.exe").as_deref(),
            Some("SshProxy")
        );
        assert_eq!(app_id_from_manifest(MANIFEST, r"app\outro.exe"), None);
    }

    #[test]
    fn splits_package_folder() {
        assert_eq!(
            split_package_folder("Claude_2.19675.0.0_x64__pzs8sxrjxfjjc"),
            Some(("Claude", "pzs8sxrjxfjjc"))
        );
        assert_eq!(split_package_folder("SemPublisher"), None);
    }

    /// Só leitura: se houver algum app da Store instalado (ex.: Claude), resolve o AUMID.
    #[test]
    fn resolves_installed_store_app_if_present() {
        let Ok(out) = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "(Get-AppxPackage -Name '*Claude*' | Select-Object -First 1).InstallLocation",
            ])
            .output()
        else {
            return;
        };
        let dir = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        if dir.is_empty() {
            return; // máquina sem o pacote: nada a verificar
        }
        let exe = Path::new(&dir).join("app").join("claude.exe");
        let aumid = aumid_for(&exe).expect("deveria resolver o AUMID do pacote instalado");
        assert!(aumid.ends_with("!Claude"), "{aumid}");
        assert!(!aumid.contains('.'), "AUMID não leva a versão: {aumid}");
    }

    #[test]
    fn regular_programs_are_not_packaged() {
        assert_eq!(aumid_for(Path::new(r"C:\Program Files\App\app.exe")), None);
    }
}
