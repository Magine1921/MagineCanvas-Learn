async function apiCall<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/agent/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  return (await res.json().catch(() => ({}))) as T;
}

export async function platformReadFile(
  filePath: string,
  offset?: number,
  limit?: number
): Promise<{ success: boolean; content?: string; error?: string }> {
  return apiCall('read_file', { file_path: filePath, offset, limit });
}

export async function platformWriteFile(
  filePath: string,
  content: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  return apiCall('write_file', { file_path: filePath, content });
}

export async function platformEditFile(
  filePath: string,
  oldString: string,
  newString: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  return apiCall('edit_file', { file_path: filePath, old_string: oldString, new_string: newString });
}

export async function platformGlobSearch(
  pattern: string,
  searchPath?: string
): Promise<{ success: boolean; files?: string[]; error?: string }> {
  return apiCall('glob_search', { pattern, path: searchPath });
}

export async function platformGrepSearch(
  pattern: string,
  searchPath?: string,
  include?: string
): Promise<{ success: boolean; matches?: Array<{ file: string; line: number; content: string }>; error?: string }> {
  return apiCall('grep_search', { pattern, path: searchPath, include });
}

export async function platformShellExec(
  command: string,
  cwd?: string
): Promise<{ success: boolean; stdout?: string; stderr?: string; message?: string; error?: string }> {
  return apiCall('bash', { command, cwd });
}
