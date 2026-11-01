pub mod capture;
pub mod listener;
pub mod set;

/// A parsed clipboard snapshot, already classified into one of our clip kinds.
#[derive(Debug, Clone)]
pub enum ClipContent {
    Text { text: String, html: Option<String> },
    Link { text: String, html: Option<String> },
    Color { text: String },
    Image { png: Vec<u8> },
    Files { paths: Vec<String> },
}
