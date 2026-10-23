# ADR 0144: Linux process cleanup with a parent-mounted procfs

Status: accepted, 2026-10-23.

The chat reaper normally uses `ps` on Unix. In a Linux PID namespace whose `/proc` was mounted by a parent namespace,
procps can fail with `fatal library error, lookup self`: its own local PID differs from the IDs in procfs. Closing a
chat then leaves its background tools running, and both process-cleanup manager tests time out.

When `ps` fails on Linux, read procfs directly. Include only processes whose PID namespace device/inode matches our
own. Validate `NSpid` and `NSpgid` against the procfs IDs and our namespace depth before translating IDs. Preserve
live parent relationships; a missing parent is not evidence that a process belongs to a closed chat. The namespace's
init may adopt an orphan, whose original process group retains ownership. Existing creation-time and tools-only
guards still decide what to kill, including protection for every descendant of a user program.

Creation times use the kernel's clock-tick frequency and uptime; executable basenames identify runtimes whose main
thread renamed `comm`. Re-read identity fields to reject processes that changed during collection. Unknown or
ambiguous metadata fails closed. Windows and successful `ps` enumeration remain unchanged; no dependencies added.
