# MCP Tool Metadata and Review Justifications

Portal Scan Tools must show the same values as this file. The server remains authoritative.

| Tool | OAuth scope | Read-only | Destructive | Open world | Justification |
|---|---|---:|---:|---:|---|
| `light_remote_list_devices` | `remote:read` | true | false | false | Reads only account-scoped device summaries and effective capabilities. |
| `light_remote_open_session` | `remote:write` | false | false | false | Creates/reuses a durable session but does not alter user files or external systems. |
| `light_remote_list_sessions` | `remote:read` | true | false | false | Reads durable-session state for the current OAuth-derived agent identity. |
| `light_remote_close_session` | `remote:write` | false | false | false | Changes session lifecycle state; refuses to close a session with active jobs and does not delete user data. |
| `light_remote_list_files` | `remote:read` | true | false | false | Lists filesystem metadata without modifying content. |
| `light_remote_read_file` | `remote:read` | true | false | false | Reads a bounded text range without modifying content. |
| `light_remote_search_files` | `remote:read` | false | false | false | Start/cancel modes create or mutate an internal managed search handle, so the tool is not strictly read-only. |
| `light_remote_write_file` | `remote:write` | false | true | false | Can overwrite or append user-controlled file content. |
| `light_remote_edit_file` | `remote:write` | false | true | false | Replaces exact text in a file and therefore can irreversibly change local content. |
| `light_remote_exec` | `remote:execute` | false | true | true | A command can modify local state and can affect external/public systems through network-capable programs. |
| `light_remote_process` | `remote:execute` | false | true | true | Start/input/stop can cause local or external side effects; the single tool is annotated for its worst-case mode. |
| `light_remote_terminal` | `remote:terminal` | false | true | true | PTY/ConPTY input is equivalent to interactive command execution and may have irreversible or external effects. |
| `light_remote_job` | `remote:read` | true | false | false | Reads durable job state without repeating or modifying the operation. |
| `light_remote_output` | `remote:read` | true | false | false | Reads bounded stdout/stderr by offset without altering the job. |
