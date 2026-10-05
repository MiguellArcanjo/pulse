//! Captura da tela principal, reduzida e em JPEG para caber bem no celular.

use std::io::Cursor;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::{imageops::FilterType, DynamicImage};
use pulse_protocol::control::Screenshot;

use super::OpResult;

const MAX_WIDTH: u32 = 1600;
const JPEG_QUALITY: u8 = 70;

pub fn capture_primary() -> OpResult<Screenshot> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("monitores indisponíveis: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or(monitors.first())
        .ok_or("nenhum monitor encontrado")?;
    let rgba = monitor
        .capture_image()
        .map_err(|e| format!("falha ao capturar a tela: {e}"))?;
    encode(DynamicImage::ImageRgba8(rgba))
}

fn encode(img: DynamicImage) -> OpResult<Screenshot> {
    let img = if img.width() > MAX_WIDTH {
        img.resize(MAX_WIDTH, u32::MAX, FilterType::Triangle)
    } else {
        img
    };
    // JPEG não tem canal alfa.
    let rgb = DynamicImage::ImageRgb8(img.to_rgb8());
    let mut out = Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    rgb.write_with_encoder(encoder)
        .map_err(|e| format!("falha ao codificar a imagem: {e}"))?;
    Ok(Screenshot {
        mime: "image/jpeg".into(),
        base64: STANDARD.encode(out.into_inner()),
        width: rgb.width(),
        height: rgb.height(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_downscales() {
        let img = DynamicImage::new_rgba8(3200, 1800);
        let shot = encode(img).unwrap();
        assert_eq!(shot.width, MAX_WIDTH);
        assert_eq!(shot.height, 900);
        assert_eq!(shot.mime, "image/jpeg");
        let bytes = STANDARD.decode(&shot.base64).unwrap();
        assert_eq!(&bytes[..2], &[0xFF, 0xD8], "assinatura JPEG");
    }
}
