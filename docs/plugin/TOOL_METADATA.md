# MCP Tool Metadata and Review Justifications

Portal Scan Tools must show the same values as this file. The server remains authoritative.

| Tool | OAuth scope | Read-only | Destructive | Open world | Justification |
|---|---|---:|---:|---:|---|
| `light_remote_connection_helper` | `remote:read` | true | false | false | Reads the authenticated account topology, product capability catalog, onboarding boundary, Main/Fleet state, and effective device permissions without changing runtime state. |
| `light_remote_inspect_device` | `remote:read` | true | false | false | Reads one owned device's sanitized role, routing, policy, connection, compatibility, and update status. |
| `light_remote_recent_activity` | `remote:read` | true | false | false | Reads account-scoped sanitized activity; credentials, transport identifiers, cryptographic material, raw commands, and internal IDs are omitted. |
| `light_remote_set_main_device` | `remote:write` | false | false | false | Changes which eligible owned device holds Main/Fleet authority. The action is reversible by selecting another eligible Main. |
| `light_remote_revoke_device` | `remote:write` | false | true | false | Revokes an owned non-integrated device and terminates its remote authority; re-enrollment is required to restore access. |
| `light_remote_remove_device` | `remote:write` | false | true | false | Permanently removes an owned non-integrated device record and enrollment binding. |
| `light_remote_list_devices` | `remote:read` | true | false | false | Reads only account-scoped device summaries and effective capabilities. |
| `light_remote_open_session` | `remote:write` | false | false | false | Creates/reuses a durable session but does not itself alter user files or external systems. |
| `light_remote_list_sessions` | `remote:read` | true | false | false | Reads durable-session state for the current OAuth-derived agent identity. |
| `light_remote_close_session` | `remote:write` | false | false | false | Changes session lifecycle state and does not delete user data. |
| `light_remote_list_files` | `remote:read` | true | false | false | Lists filesystem metadata without modifying content. |
| `light_remote_read_file` | `remote:read` | true | false | false | Reads a bounded text range without modifying content. |
| `light_remote_search_files` | `remote:read` | false | false | false | Start/cancel modes mutate an internal managed search handle, so the tool is not strictly read-only. |
| `light_remote_write_file` | `remote:write` | false | true | false | Can overwrite or append user-controlled file content. |
| `light_remote_edit_file` | `remote:write` | false | true | false | Replaces exact text in a file and can irreversibly change local content. |
| `light_remote_exec` | `remote:execute` | false | true | true | A command can modify local state and can affect external/public systems through network-capable programs. |
| `light_remote_process` | `remote:execute` | false | true | true | Start/input/stop can cause local or external side effects; the tool is annotated for its worst-case mode. |
| `light_remote_terminal` | `remote:terminal` | false | true | true | PTY/ConPTY input is equivalent to interactive command execution and may have irreversible or external effects. |
| `light_remote_job` | `remote:read` | true | false | false | Reads durable job state without repeating or modifying the operation. |
| `light_remote_output` | `remote:read` | true | false | false | Reads bounded stdout/stderr by offset without altering the job. |

The first six tools make Light Remote's governed-product surface visible to the reviewer without exposing private maintenance credentials or bypassing Local Wall policy. The remaining fourteen are the existing execution/recovery surface.
