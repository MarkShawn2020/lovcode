use super::*;

pub(crate) fn command_handler() -> Box<tauri::ipc::InvokeHandler<tauri::Wry>> {
    Box::new(tauri::generate_handler![
        ataru::api::ataru_search,
        cancel_session_stream,
        copy_to_clipboard,
        get_incremental_search_index_sync_status,
        get_search_index_status,
        get_semantic_search_status,
        initialize_semantic_search,
        get_session_messages,
        get_session_source_path,
        list_all_sessions_streamed,
        make_window_nonactivating_panel,
        preview_semantic_search_initialization,
        reveal_session_in_finder,
        search_chats,
        semantic_search_chats,
        set_incremental_search_index_sync_enabled,
        set_semantic_search_enabled,
        start_search_index_build,
    ])
}
