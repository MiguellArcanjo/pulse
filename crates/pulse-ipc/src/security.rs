//! Segurança do pipe: descobrir o SID do usuário atual e montar uma DACL que
//! concede acesso somente a ele.

use std::ffi::c_void;
use std::io;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
use windows::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{
    GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
    TOKEN_USER,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

fn win_err(e: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error(e.code().0 & 0xFFFF)
}

/// SID do usuário dono deste processo, no formato `S-1-5-21-...`.
pub fn current_user_sid() -> io::Result<String> {
    // SAFETY: chamadas Win32 com buffers dimensionados pela própria API; handles
    // e memória alocada pelo sistema são liberados antes de retornar.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(win_err)?;

        let mut len = 0u32;
        // Primeira chamada só descobre o tamanho; falha com ERROR_INSUFFICIENT_BUFFER.
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
        let mut buf = vec![0u8; len as usize];
        let res = GetTokenInformation(
            token,
            TokenUser,
            Some(buf.as_mut_ptr() as *mut c_void),
            len,
            &mut len,
        );
        let _ = CloseHandle(token);
        res.map_err(win_err)?;

        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut sid_str = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid_str).map_err(win_err)?;
        let out = sid_str.to_string().map_err(io::Error::other);
        let _ = LocalFree(Some(HLOCAL(sid_str.0 as *mut c_void)));
        out
    }
}

/// SECURITY_ATTRIBUTES com DACL protegida: acesso total só para o usuário atual.
pub struct OwnerOnly {
    sa: SECURITY_ATTRIBUTES,
    sd: PSECURITY_DESCRIPTOR,
}

impl OwnerOnly {
    pub fn new() -> io::Result<Self> {
        let sid = current_user_sid()?;
        // D:P = DACL protegida (sem herança); A;;GA;;;<sid> = Allow GenericAll.
        let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})\0").encode_utf16().collect();
        let mut sd = PSECURITY_DESCRIPTOR::default();
        // SAFETY: `sddl` é UTF-16 terminado em zero; `sd` é liberado no Drop.
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl.as_ptr()),
                SDDL_REVISION_1,
                &mut sd,
                None,
            )
            .map_err(win_err)?;
        }
        Ok(Self {
            sa: SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: sd.0,
                bInheritHandle: false.into(),
            },
            sd,
        })
    }

    pub fn as_mut_ptr(&mut self) -> *mut c_void {
        &mut self.sa as *mut SECURITY_ATTRIBUTES as *mut c_void
    }
}

impl Drop for OwnerOnly {
    fn drop(&mut self) {
        // SAFETY: `sd` foi alocado por ConvertStringSecurityDescriptor... (LocalAlloc).
        unsafe {
            let _ = LocalFree(Some(HLOCAL(self.sd.0)));
        }
    }
}
