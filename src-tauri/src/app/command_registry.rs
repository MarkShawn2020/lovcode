use super::*;

pub(crate) fn command_handler() -> Box<tauri::ipc::InvokeHandler<tauri::Wry>> {
    Box::new(tauri::generate_handler![
        ataru::api::ataru_search,
        cancel_session_stream,
        copy_to_clipboard,
        get_search_index_status,
        get_session_messages,
        list_all_sessions_streamed,
        make_window_nonactivating_panel,
        search_chats,
        semantic_search_chats,
        start_search_index_build,
    ])
}
