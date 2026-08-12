// Compatibility entry point for installations and scripts that still invoke
// the pre-Ataru binary name. New callers should use `ataru`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ataru_lib::run()
}
