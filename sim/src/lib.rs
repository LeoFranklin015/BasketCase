//! 60-day community simulator for a basket-backed memecoin.
//!
//! All model arithmetic is integer (raw 1e18-scaled u128, via `curve-math`), so a seed gives the
//! same bytes on every platform. Floats appear only when numbers are written out for charts.

pub mod coin;
mod doc;
pub mod params;
pub mod report;
pub mod scenario;
