//! Debounce foreground transitions independently of WebView2 focus events.

#[derive(Default)]
pub(crate) struct ForegroundGuard {
    outside_samples: u8,
}

impl ForegroundGuard {
    /// `None` means Windows has no foreground window during a transition.
    pub(crate) fn should_hide(&mut self, panel_is_foreground: Option<bool>) -> bool {
        if panel_is_foreground == Some(false) {
            self.outside_samples = self.outside_samples.saturating_add(1);
        } else {
            self.outside_samples = 0;
        }
        self.outside_samples >= 2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_handoff_does_not_hide_panel() {
        let mut guard = ForegroundGuard::default();
        for sample in [Some(true), Some(false), None, Some(false), Some(true)] {
            assert!(!guard.should_hide(sample));
        }
    }

    #[test]
    fn sustained_switch_to_another_window_hides_panel() {
        let mut guard = ForegroundGuard::default();
        assert!(!guard.should_hide(Some(true)));
        assert!(!guard.should_hide(Some(false)));
        assert!(guard.should_hide(Some(false)));
    }

    #[test]
    fn returning_to_panel_resets_pending_hide() {
        let mut guard = ForegroundGuard::default();
        assert!(!guard.should_hide(Some(false)));
        assert!(!guard.should_hide(Some(true)));
        assert!(!guard.should_hide(Some(false)));
    }
}
