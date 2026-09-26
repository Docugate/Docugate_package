import { loadCredentials, saveCredentials } from './auth.js'

/** Module-level default, captured at import time (used by CLI commands). */
export const BASE_URL = process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'

const ERROR_MESSAGES: Record<string, string> = {
  pro_required_sources: 'Connecting more than one repository to a space needs DocuGate Pro',
}

function friendlyError(code: string): string {
  return ERROR_MESSAGES[code] ?? `DocuGate said: ${code}`
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const creds = loadCredentials()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (creds) {
    headers['Authorization'] = `Bearer ${creds.token}`
  }

  // Re-read the env at call time so tests that set DOCUGATE_URL after import work.
  const base = process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'
  const res = await fetch(`${base}${path}`, { ...init, headers })

  // Renew token if the server sent a fresh one.
  const renewed = res.headers.get('x-docugate-token')
  if (renewed) saveCredentials(renewed)

  if (res.status === 401) {
    throw new Error('Run docugate login')
  }

  if (!res.ok) {
    let code: string | undefined
    try {
      const body = await res.clone().json() as unknown
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const b = body as Record<string, unknown>
        if (typeof b.error === 'string') code = b.error
      }
    } catch {
      // ignore JSON parse failure
    }
    if (code) throw new Error(friendlyError(code))
    throw new Error(`DocuGate request failed with status ${res.status}`)
  }

  return res
}

// ---------------------------------------------------------------------------
// Typed wrappers
// ---------------------------------------------------------------------------

export interface DocugateUser {
  githubLogin: string
  name: string
  email: string
  plan: string
}

export interface SessionResponse {
  user: DocugateUser | null
}

export interface Space {
  id: string
  owner: string
  slug: string
  name: string
}

export interface SpacesResponse {
  spaces: Space[]
}

export async function getSession(): Promise<SessionResponse> {
  const res = await apiFetch('/api/auth/session')
  return res.json() as Promise<SessionResponse>
}

export async function getSpaces(): Promise<SpacesResponse> {
  const res = await apiFetch('/api/spaces/mine')
  return res.json() as Promise<SpacesResponse>
}

export async function connectRepo(spaceId: string, repo: string, docsDir: string): Promise<void> {
  await apiFetch(`/api/spaces/${spaceId}/sources`, {
    method: 'POST',
    body: JSON.stringify({ repo, docsDir }),
  })
}
