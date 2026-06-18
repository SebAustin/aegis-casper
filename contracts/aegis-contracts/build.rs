//! Odra contract build script. Uses the `ODRA_MODULE` env var to set the
//! `odra_module` cfg flag so the selected contract's wasm/schema is generated.
pub fn main() {
    odra_build::build();
}
