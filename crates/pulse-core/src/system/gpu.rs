//! Uso de GPU pelos contadores de desempenho do Windows (`GPU Engine`), o mesmo
//! dado que o Gerenciador de Tarefas mostra: o motor mais ocupado do adaptador.

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;

    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
        PDH_MORE_DATA,
    };

    pub struct GpuSampler {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
    }

    // SAFETY: os handles PDH são usados por um único dono (a tarefa de métricas).
    unsafe impl Send for GpuSampler {}

    impl GpuSampler {
        pub fn new() -> Option<Self> {
            // SAFETY: chamadas PDH com handles válidos; liberados no Drop.
            unsafe {
                let mut query = PDH_HQUERY::default();
                if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                    return None;
                }
                let mut counter = PDH_HCOUNTER::default();
                if PdhAddEnglishCounterW(
                    query,
                    w!(r"\GPU Engine(*)\Utilization Percentage"),
                    0,
                    &mut counter,
                ) != 0
                {
                    let _ = PdhCloseQuery(query);
                    return None;
                }
                // Primeira coleta serve de base para a taxa.
                let _ = PdhCollectQueryData(query);
                Some(Self { query, counter })
            }
        }

        /// Percentual 0–100, ou `None` se o contador não estiver disponível.
        pub fn sample(&mut self) -> Option<f32> {
            // SAFETY: buffer dimensionado pela própria API na primeira chamada.
            unsafe {
                if PdhCollectQueryData(self.query) != 0 {
                    return None;
                }
                let mut size = 0u32;
                let mut count = 0u32;
                let status = PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut size,
                    &mut count,
                    None,
                );
                if status != PDH_MORE_DATA {
                    return None;
                }
                let mut buf = vec![0u8; size as usize];
                let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
                if PdhGetFormattedCounterArrayW(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    &mut size,
                    &mut count,
                    Some(items),
                ) != 0
                {
                    return None;
                }
                let items = std::slice::from_raw_parts(items, count as usize);
                // Soma por (adaptador, tipo de motor) e pega o maior.
                let mut by_engine: HashMap<String, f64> = HashMap::new();
                for it in items {
                    let name = it.szName.to_string().unwrap_or_default();
                    let key = engine_key(&name);
                    *by_engine.entry(key).or_default() += it.FmtValue.Anonymous.doubleValue;
                }
                let max = by_engine.values().copied().fold(0.0, f64::max);
                Some(max.clamp(0.0, 100.0) as f32)
            }
        }
    }

    /// `pid_1234_luid_0x0_0x1_phys_0_eng_3_engtype_3D` → `luid_0x0_0x1|3D`.
    fn engine_key(instance: &str) -> String {
        let luid = instance
            .find("luid_")
            .map(|i| &instance[i..])
            .and_then(|s| s.find("_phys").map(|j| &s[..j]))
            .unwrap_or("");
        let kind = instance
            .rsplit_once("engtype_")
            .map(|(_, t)| t)
            .unwrap_or("");
        format!("{luid}|{kind}")
    }

    impl Drop for GpuSampler {
        fn drop(&mut self) {
            // SAFETY: query aberta em `new`.
            unsafe {
                let _ = PdhCloseQuery(self.query);
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn groups_engines_by_adapter_and_type() {
            assert_eq!(
                engine_key("pid_1234_luid_0x00000000_0x0000D1C5_phys_0_eng_3_engtype_3D"),
                "luid_0x00000000_0x0000D1C5|3D"
            );
            assert_eq!(engine_key("estranho"), "|");
        }

        #[test]
        fn sampler_does_not_crash() {
            // Em máquinas sem GPU/contador, `new` devolve None; ambos são válidos.
            if let Some(mut g) = GpuSampler::new() {
                std::thread::sleep(std::time::Duration::from_millis(200));
                if let Some(v) = g.sample() {
                    assert!((0.0..=100.0).contains(&v));
                }
            }
        }
    }
}

#[cfg(windows)]
pub use imp::GpuSampler;

#[cfg(not(windows))]
pub struct GpuSampler;

#[cfg(not(windows))]
impl GpuSampler {
    pub fn new() -> Option<Self> {
        None
    }
    pub fn sample(&mut self) -> Option<f32> {
        None
    }
}
