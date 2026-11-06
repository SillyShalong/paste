//! Place a panel within the selected monitor's usable work area.

pub(crate) fn panel_bounds(area: (i32, i32, i32, i32), scale: f64, position: &str) -> (i32, i32, u32, u32) {
    let (x, y, width, height) = area;
    let margin = ((12.0 * scale).round() as i32).clamp(0, (height - 1).max(0) / 2);
    let panel_height = ((440.0 * scale).round() as i32).clamp(1, (height - 2 * margin).max(1));
    let top = match position {
        "top" => y + margin,
        "bottom" => y + height - panel_height - margin,
        _ => y + (height - panel_height) / 2,
    };
    (x, top, width.max(1) as u32, panel_height as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bottom_panel_stays_above_taskbar() {
        // A 1080px display with a 48px taskbar has a 1032px work area.
        let (_, y, _, height) = panel_bounds((0, 0, 1920, 1032), 1.0, "bottom");
        assert_eq!(y + height as i32, 1020);
    }

    #[test]
    fn placement_respects_secondary_monitor_and_side_taskbar() {
        for position in ["top", "bottom", "center"] {
            let (x, y, width, height) = panel_bounds((-1860, -200, 1860, 1040), 1.25, position);
            assert_eq!(x, -1860);
            assert_eq!(width, 1860);
            assert!(y >= -200);
            assert!(y + height as i32 <= 840);
        }
    }

    #[test]
    fn high_dpi_panel_fits_short_work_area() {
        let (_, y, _, height) = panel_bounds((0, 0, 1280, 600), 2.0, "bottom");
        assert!(y >= 0);
        assert_eq!(y + height as i32, 576);
    }
}
